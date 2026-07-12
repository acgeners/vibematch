import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { createHash } from "node:crypto"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { SONNET_MODEL } from "@/lib/ai/models"
import { hasLeakedMarkup, sanitizeReviewText } from "./digest-integrity"
import type { ReviewDigest, ReviewDigestTrait } from "./types"

export const REVIEW_SUMMARIZER_MODEL = "claude-haiku-4-5-20251001"
export const REVIEW_SUMMARIZER_PROMPT_VERSION = "v2"

// Limites pra manter o prompt barato mesmo quando há 100+ reviews: amostra as
// mais longas (mais informativas) e trunca cada uma.
const MAX_REVIEWS = 40
const MAX_CHARS_PER_REVIEW = 1500

const SYSTEM_PROMPT = `Você é um editor que resume as reviews de leitores de uma obra (manhwa, anime, manga) em um único parágrafo de consenso.

REGRAS:
- Saída: ~80-150 palavras em português brasileiro, texto corrido (sem listas, sem markdown, sem headers).
- Capture o consenso: pontos fortes mais citados, críticas recorrentes e o tom geral (recepção positiva/mista/negativa).
- Priorize o que ajuda a avaliar os atributos/critérios da obra: história e ritmo, originalidade, protagonistas (presença e carisma da FL/ML) e desenvolvimento dos personagens, romance e dinâmica do casal, humor, drama/tragédia, ação/aventura, arte/visual, conteúdo adulto e impacto/imersão. Ignore comentários que não ajudem a entender esses aspectos.
- Se há divergência clara entre leitores, diga isso ("opiniões se dividem sobre X").
- Não cite fontes nem números de review (nada de "[R1]", "segundo a AniList", etc.).
- Sem spoilers profundos — fale da experiência de leitura, não de reviravoltas específicas.
- Não invente — só resuma o que está nas reviews.
- Retorne APENAS o resumo. Sem prefixo "Resumo:", sem aspas envolvendo o texto.`

export interface ReviewSummaryInput {
  text: string
  userRating?: number | null
}

export interface ConsolidateReviewsResult {
  summary: string
  model: string
  promptVersion: string
  tokensIn: number
  tokensOut: number
}

/** Status detalhado para o caller decidir se interrompe lotes em falhas em série. */
export type ConsolidateReviewsStatus =
  | { kind: "ok"; result: ConsolidateReviewsResult }
  | { kind: "skipped"; reason: "no_content" | "no_api_key" }
  | { kind: "api_failed"; error: string }

export interface ConsolidateReviewsOptions {
  workId?: string | null
}

/**
 * Pega as reviews de uma obra e devolve um resumo de consenso via Haiku.
 * Espelha `consolidateSynopsis`. Wrapper retro-compatível que retorna o result
 * ou null.
 */
export async function consolidateReviews(
  reviews: ReviewSummaryInput[],
  opts: ConsolidateReviewsOptions = {},
): Promise<ConsolidateReviewsResult | null> {
  const status = await consolidateReviewsDetailed(reviews, opts)
  return status.kind === "ok" ? status.result : null
}

export async function consolidateReviewsDetailed(
  reviews: ReviewSummaryInput[],
  opts: ConsolidateReviewsOptions = {},
): Promise<ConsolidateReviewsStatus> {
  if (!process.env.ANTHROPIC_API_KEY) return { kind: "skipped", reason: "no_api_key" }

  const cleaned = reviews
    .map((r) => ({ text: (r.text ?? "").trim(), userRating: r.userRating ?? null }))
    .filter((r) => r.text.length >= 40) // descarta reviews minúsculas (1-2 palavras)
  if (cleaned.length === 0) return { kind: "skipped", reason: "no_content" }

  // Amostra as mais longas e trunca — controla custo sem perder os reviews mais
  // ricos. Reviews de uma obra podem passar de 100.
  const sampled = [...cleaned]
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, MAX_REVIEWS)

  const numbered = sampled
    .map((r, i) => {
      const rating = r.userRating != null ? ` (nota ${r.userRating}/10)` : ""
      return `[R${i + 1}]${rating}\n${r.text.slice(0, MAX_CHARS_PER_REVIEW)}`
    })
    .join("\n\n---\n\n")

  const userPrompt = `Resuma o consenso das ${sampled.length} review(s) de leitores abaixo em um único parágrafo em PT-BR.\n\n${numbered}`

  try {
    // maxRetries baixo (3) porque o caller do backfill em lote já tem early-exit
    // em falhas consecutivas e o save de reviews não pode travar a UI.
    const client = getAnthropicClient({ maxRetries: 3 })
    const { message } = await createLoggedMessage(
      client,
      {
        model: REVIEW_SUMMARIZER_MODEL,
        max_tokens: 700,
        temperature: 0.2,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      },
      {
        operation: "review_summarizer",
        promptVersion: REVIEW_SUMMARIZER_PROMPT_VERSION,
        workId: opts.workId ?? null,
        metadata: { nReviews: sampled.length },
      },
    )

    const text = message.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim()

    if (!text) return { kind: "skipped", reason: "no_content" }

    return {
      kind: "ok",
      result: {
        summary: text,
        model: REVIEW_SUMMARIZER_MODEL,
        promptVersion: REVIEW_SUMMARIZER_PROMPT_VERSION,
        tokensIn: message.usage.input_tokens,
        tokensOut: message.usage.output_tokens,
      },
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[review-summarizer] falhou:", msg)
    return { kind: "api_failed", error: msg }
  }
}

/**
 * Hash determinístico dos textos das reviews (ordenados) — detecta se o conjunto
 * mudou desde o último resumo e evita re-rodar. Considera TODAS as reviews (não
 * só a amostra enviada ao modelo) pra que qualquer mudança invalide o cache.
 */
export function hashReviewInputs(reviews: ReviewSummaryInput[]): string {
  const normalized = reviews
    .map((r) => (r.text ?? "").trim())
    .filter((t) => t.length > 0)
    .sort()
    .join("|")
  return createHash("sha256").update(normalized).digest("hex")
}

/**
 * Empacota hash + contagem de reviews num único campo de texto
 * (`works.review_summary_inputs_hash`) como `"<sha256>:<n>"`. Evita uma migration
 * só pra guardar o count usado pelo gate de materialidade (Item C, Passe 1).
 * O sha256 é hex puro (sem ":"), então o split é inequívoco.
 */
export function packReviewSummaryMeta(hash: string, n: number): string {
  return `${hash}:${n}`
}

/**
 * Lê o campo empacotado. Linha legada (só o hash, sem ":<n>") devolve `n: null`
 * — o gate trata isso como material e re-resume uma vez, repovoando o count.
 */
export function parseReviewSummaryMeta(stored: string | null | undefined): {
  hash: string
  n: number | null
} {
  if (!stored) return { hash: "", n: null }
  const idx = stored.lastIndexOf(":")
  if (idx === -1) return { hash: stored, n: null }
  const nStr = stored.slice(idx + 1)
  if (!/^\d+$/.test(nStr)) return { hash: stored, n: null }
  return { hash: stored.slice(0, idx), n: parseInt(nStr, 10) }
}

/**
 * Gate de materialidade do re-resumo (Item C, Passe 1): re-resumir custa Haiku,
 * então só vale a pena quando o conjunto CRESCEU o suficiente. Biblioteca pequena
 * re-roda com +2; grande ignora +1..+N. `prevN == null` (cold/legado) é sempre
 * material. Edição pura (mesmo count, texto diferente) NÃO é material — fica pro
 * botão de regenerar manual.
 */
export function isMaterialReviewChange(prevN: number | null, nowN: number): boolean {
  if (prevN == null) return true
  return nowN - prevN >= Math.max(2, Math.ceil(nowN * 0.2))
}

// ============================================================
// Item C, Passe 2 — DIGEST ESTRUTURADO via Sonnet 4.6.
// Saída preference-agnostic (consensus/divergence/salient_traits/
// content_warnings/execution) consumida pelo consultor LLM. NÃO substitui o
// `review_summary` (texto Haiku da UI). Custo único por obra, amortizado:
// re-roda só com mudança material (gate em review_digest_n/version no caller).
// ============================================================
export const REVIEW_DIGEST_MODEL = SONNET_MODEL
export const REVIEW_DIGEST_VERSION = "digest-v1"

// Amostragem ESTRATIFICADA por fonte (não "as 40 mais longas" — isso reintroduz
// o viés MAL/AniList, que escrevem ensaios). Round-robin entre fontes, mais
// longas primeiro DENTRO de cada fonte, com tetos por-fonte e total.
const DIGEST_TOTAL_CAP = 40
const DIGEST_PER_SOURCE_CAP = 8
const DIGEST_MAX_CHARS_PER_REVIEW = 1200
// 2000 era exatamente o orçamento estimado em contracts.ts — truncar era rotina, e
// resposta truncada = tool-call meio-serializado (a origem do texto vazado).
const DIGEST_MAX_TOKENS = 3000
const DIGEST_MAX_ATTEMPTS = 2

export interface ReviewDigestInput {
  text: string
  source: string
  userRating?: number | null
}

export interface ConsolidateDigestResult {
  digest: ReviewDigest
  model: string
  promptVersion: string
  tokensIn: number
  tokensOut: number
}

export type ConsolidateDigestStatus =
  | { kind: "ok"; result: ConsolidateDigestResult }
  | { kind: "skipped"; reason: "no_content" | "no_api_key" }
  | { kind: "api_failed"; error: string }

const DIGEST_SYSTEM_PROMPT = `Você é um analista que destila as reviews de leitores de uma obra (manhwa, anime, manga) num DIGEST ESTRUTURADO, em português brasileiro.

REGRA CENTRAL — NEUTRALIDADE: o digest é AGNÓSTICO às preferências de qualquer usuário. Descreva o que o CONSENSO dos leitores enxerga, NÃO se "é bom pra você". Ex.: se os leitores adoram que a protagonista é cruel, registre o traço "protagonista cruel" com polarity="positive" (é como o consenso o vê) — quem decide se isso é bom ou ruim pro usuário é outra camada, depois.

CAMPOS (use a tool \`submit_review_digest\`):
- \`consensus\`: 1–3 frases com o que a maioria concorda (pontos fortes/fracos recorrentes, tom geral).
- \`divergence\`: 1–2 frases com onde as opiniões se DIVIDEM ("uns acham o ending fraco, outros amam"). Se não há divergência clara, diga isso.
- \`salient_traits\`: 3–8 traços recorrentes que MOVEM a percepção. Pra cada um: \`trait\` (curto, específico — "protagonista vingativa e calculista", "ritmo arrastado no meio"), \`polarity\` ("positive"/"negative"/"mixed" — como o CONSENSO vê, não o usuário), \`axis\` (eixo: moralidade, tom, ritmo, arte, romance, personagens, originalidade, mundo). Evite traços genéricos ("é um manhwa").
- \`content_warnings\`: 0–4 alertas de conteúdo objetivos (violência gráfica, abuso, etc.). Vazio se nenhum.
- \`execution\`: 1–2 frases sobre a QUALIDADE de execução (arte/visual, ritmo, escrita) segundo os leitores.

PRINCÍPIOS:
- Não invente — só destile o que está nas reviews.
- Não cite fontes nem IDs ("[R1]", "segundo a AniList"). Não dê spoilers profundos.
- Priorize traços de moralidade, tom, ritmo, romance/casal, personagens — os que ajudam a decidir se a obra encaixa num gosto.`

const REVIEW_DIGEST_TOOL: Anthropic.Messages.Tool = {
  name: "submit_review_digest",
  description: "Submete o digest estruturado e preference-agnostic das reviews da obra.",
  input_schema: {
    type: "object",
    properties: {
      consensus: { type: "string" },
      divergence: { type: "string" },
      salient_traits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            trait: { type: "string" },
            polarity: { type: "string", enum: ["positive", "negative", "mixed"] },
            axis: { type: "string" },
          },
          required: ["trait", "polarity", "axis"],
        },
      },
      content_warnings: { type: "array", items: { type: "string" } },
      execution: { type: "string" },
    },
    required: ["consensus", "divergence", "salient_traits", "content_warnings", "execution"],
  },
}

function sampleStratifiedBySource(reviews: ReviewDigestInput[]): ReviewDigestInput[] {
  const bySource = new Map<string, ReviewDigestInput[]>()
  for (const r of reviews) {
    const list = bySource.get(r.source) ?? []
    list.push(r)
    bySource.set(r.source, list)
  }
  for (const list of bySource.values()) list.sort((a, b) => b.text.length - a.text.length)
  const sources = [...bySource.keys()]
  const out: ReviewDigestInput[] = []
  const taken = new Map<string, number>()
  let progressed = true
  while (out.length < DIGEST_TOTAL_CAP && progressed) {
    progressed = false
    for (const s of sources) {
      if (out.length >= DIGEST_TOTAL_CAP) break
      const n = taken.get(s) ?? 0
      if (n >= DIGEST_PER_SOURCE_CAP) continue
      const list = bySource.get(s)!
      if (n < list.length) {
        out.push(list[n])
        taken.set(s, n + 1)
        progressed = true
      }
    }
  }
  return out
}

export type DigestRejection = "not_an_object" | "no_consensus" | "no_traits" | "leaked_markup"

export const DIGEST_REJECTION_MSG: Record<DigestRejection, string> = {
  not_an_object: "input da tool não é um objeto",
  no_consensus: "campo `consensus` vazio",
  no_traits: "nenhum `salient_traits` válido",
  leaked_markup: "markup de tool-call vazou pra dentro de um campo de texto",
}

export type DigestValidation = { ok: true; digest: ReviewDigest } | { ok: false; reason: DigestRejection }

/** Coage + VALIDA o input da tool. Rejeita (em vez de persistir) quando o
 *  tool-call veio mal-serializado. */
export function validateDigest(input: unknown): DigestValidation {
  if (!input || typeof input !== "object") return { ok: false, reason: "not_an_object" }
  const o = input as Record<string, unknown>
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "")
  const traits: ReviewDigestTrait[] = Array.isArray(o.salient_traits)
    ? (o.salient_traits as unknown[])
        .map((t) => {
          const tr = (t ?? {}) as Record<string, unknown>
          const pol = str(tr.polarity)
          return {
            trait: str(tr.trait),
            polarity: (pol === "positive" || pol === "negative" || pol === "mixed" ? pol : "mixed") as ReviewDigestTrait["polarity"],
            axis: str(tr.axis),
          }
        })
        .filter((t) => t.trait.length > 0)
    : []
  const warnings = Array.isArray(o.content_warnings)
    ? (o.content_warnings as unknown[]).map(str).filter((s) => s.length > 0)
    : []
  const consensus = str(o.consensus)
  const divergence = str(o.divergence)
  const execution = str(o.execution)

  if (hasLeakedMarkup(consensus, divergence, execution, ...traits.map((t) => t.trait), ...warnings)) {
    return { ok: false, reason: "leaked_markup" }
  }
  if (!consensus) return { ok: false, reason: "no_consensus" }
  // A tool declara salient_traits como obrigatório: chegar vazio significa que o
  // bloco se perdeu na serialização, não que a obra não tem traços.
  if (traits.length === 0) return { ok: false, reason: "no_traits" }

  return {
    ok: true,
    digest: { consensus, divergence, salient_traits: traits, content_warnings: warnings, execution },
  }
}

export async function consolidateReviewsDigestDetailed(
  reviews: ReviewDigestInput[],
  opts: ConsolidateReviewsOptions = {},
): Promise<ConsolidateDigestStatus> {
  if (!process.env.ANTHROPIC_API_KEY) return { kind: "skipped", reason: "no_api_key" }

  const cleaned = reviews
    .map((r) => ({ text: (r.text ?? "").trim(), source: r.source || "desconhecida", userRating: r.userRating ?? null }))
    .filter((r) => r.text.length >= 40)
  if (cleaned.length === 0) return { kind: "skipped", reason: "no_content" }

  const sampled = sampleStratifiedBySource(cleaned)
  const numbered = sampled
    .map((r, i) => {
      const rating = r.userRating != null ? ` (nota ${r.userRating}/10)` : ""
      return `[${r.source} #${i + 1}]${rating}\n${sanitizeReviewText(r.text).slice(0, DIGEST_MAX_CHARS_PER_REVIEW)}`
    })
    .join("\n\n---\n\n")

  const nSources = new Set(sampled.map((r) => r.source)).size
  const userPrompt = `Destile o digest estruturado das ${sampled.length} review(s) abaixo (de ${nSources} fonte(s)). Use a tool \`submit_review_digest\`.\n\n${numbered}`

  try {
    const client = getAnthropicClient({ maxRetries: 3 })
    let lastReason = "motivo desconhecido"

    // Uma resposta truncada ou com tool-call mal-serializado é DESCARTADA e
    // re-pedida (temperatura 0 na 2ª). Persistir o lixo é pior que falhar: ele
    // vira texto técnico na página da obra e alimenta o preditor de Interesse.
    for (let attempt = 1; attempt <= DIGEST_MAX_ATTEMPTS; attempt++) {
      const { message } = await createLoggedMessage(
        client,
        {
          model: REVIEW_DIGEST_MODEL,
          max_tokens: DIGEST_MAX_TOKENS,
          temperature: attempt === 1 ? 0.2 : 0,
          system: DIGEST_SYSTEM_PROMPT,
          messages: [{ role: "user", content: userPrompt }],
          tools: [REVIEW_DIGEST_TOOL],
          tool_choice: { type: "tool", name: REVIEW_DIGEST_TOOL.name },
        },
        {
          operation: "review_digest",
          promptVersion: REVIEW_DIGEST_VERSION,
          workId: opts.workId ?? null,
          metadata: { nReviews: sampled.length, nSources, attempt },
        },
      )

      if (message.stop_reason === "max_tokens") {
        lastReason = `resposta truncada em ${DIGEST_MAX_TOKENS} tokens`
        console.warn(`[review-digest] tentativa ${attempt}: ${lastReason}`)
        continue
      }

      const toolUse = message.content.find(
        (block): block is Extract<typeof block, { type: "tool_use" }> =>
          block.type === "tool_use" && block.name === REVIEW_DIGEST_TOOL.name,
      )
      if (!toolUse) {
        lastReason = "modelo não chamou a tool"
        console.warn(`[review-digest] tentativa ${attempt}: ${lastReason}`)
        continue
      }

      const validation = validateDigest(toolUse.input)
      if (!validation.ok) {
        lastReason = DIGEST_REJECTION_MSG[validation.reason]
        console.warn(`[review-digest] tentativa ${attempt}: digest rejeitado — ${lastReason}`)
        continue
      }

      return {
        kind: "ok",
        result: {
          digest: validation.digest,
          model: REVIEW_DIGEST_MODEL,
          promptVersion: REVIEW_DIGEST_VERSION,
          tokensIn: message.usage.input_tokens,
          tokensOut: message.usage.output_tokens,
        },
      }
    }

    // Falha explícita (o caller NÃO persiste e mantém o digest anterior).
    return { kind: "api_failed", error: `digest inválido após ${DIGEST_MAX_ATTEMPTS} tentativas: ${lastReason}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[review-digest] falhou:", msg)
    return { kind: "api_failed", error: msg }
  }
}

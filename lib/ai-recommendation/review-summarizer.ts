import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { createHash } from "node:crypto"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"

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

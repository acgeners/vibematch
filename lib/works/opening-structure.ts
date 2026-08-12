import "server-only"

import type Anthropic from "@anthropic-ai/sdk"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { SONNET_MODEL } from "@/lib/ai/models"

/**
 * "A obra começa com FLASHFORWARD?" — a régua, o prompt e a chamada.
 *
 * 🔴 A RÉGUA, e é ela que separa flashforward de setup isekai:
 *    **a narrativa principal REENCONTRA a cena de abertura?**
 *
 * Medido em 2026-08-12 (`scripts/piloto-flashforward.ts`, 19 obras, US$1,40):
 *   - 6 decididas · 13 sem evidência suficiente. Fora dos 3 controles: **3 em 16 (19%)**
 *   - **zero chutes** — vários "indeterminado" citam a tag `time-skip-in-first-chapter-prologue`
 *     e a RECUSAM explicitamente, que é o comportamento que o desenho existe para produzir
 *   - os `linear` vieram da SINOPSE (a morte na vida anterior aparece nela); os `flashforward`
 *     vieram de REVIEW de leitor reclamando. Faz sentido: flashforward só vira texto quando
 *     incomoda alguém.
 *
 * ⚠️ Por que não regex: o vocabulário do leitor é livre ("end at the beginning", "don't read
 * the first chapter", "they show us towards the end"). Um regex generoso acha 7 obras em 988.
 *
 * ⚠️ Por que a web é um segundo disparo e não fallback automático: ela custa ~US$0,25 contra
 * US$0,016 do local e resgatou 1 em 5 no piloto — ~US$1,06 por obra adicional decidida. O custo
 * não são as buscas (US$0,01 cada), são os resultados delas voltando ao input a cada volta do
 * loop de tool use.
 */

export const OPENING_STRUCTURE_PROMPT_VERSION = "opening-v1"

/** Quanto material local cabe no prompt. A mediana do catálogo é ~3.700 tokens; o p90, ~7.900. */
const MAX_REVIEWS = 40
const MAX_REVIEW_CHARS = 26_000

/** Abaixo disto a "citação" não é citação. O banco impõe o mesmo mínimo (migration 185). */
export const MIN_EVIDENCE_CHARS = 15

export type OpeningStructureVerdict = "flashforward" | "linear" | "indeterminado"
export type OpeningStructureSource = "local" | "web"

export interface OpeningStructureContext {
  workId: string
  title: string
  synopsis: string | null
  /** `works.review_digest` cru — a síntese das reviews. É onde o eixo "ritmo" costuma falar. */
  digest: unknown
  reviews: Array<{ source: string | null; text: string }>
  /** Só as tags de tropo temporal, e elas entram no prompt como NÃO-evidência. */
  tropeTags: string[]
}

export interface OpeningStructureResult {
  verdict: OpeningStructureVerdict
  evidence: string
  rationale: string
  confidence: number
  source: OpeningStructureSource
  modelName: string
  promptVersion: string
  costUsd: number
  searches: number
}

const RULE = `Você determina se uma obra (manhwa/manga) ABRE COM FLASHFORWARD.

A RÉGUA — uma pergunta só: a narrativa principal REENCONTRA a cena de abertura?
- SIM  → "flashforward". O leitor vê o "depois" antes do "antes", e a história chega naquela cena.
- NÃO  → "linear". Inclui o caso mais comum do gênero: a obra abre com a MORTE ou execução da
  protagonista e ela regride/reencarna. Essa cena pertence a uma linha do tempo que foi
  SUBSTITUÍDA — a nova linha existe justamente para evitá-la e nunca a alcança. Isso NÃO é
  flashforward, é prólogo de regressão.

⚠️ Reencarnação, regressão, transmigração e time travel NÃO são evidência de flashforward por si
sós. São o tropo mais comum deste catálogo; se você responder "sim" por causa deles, está
descrevendo o gênero, não a obra. O mesmo vale para a tag "time-skip-in-first-chapter-prologue":
em metade das obras que a têm, ela marca o setup de regressão.

⚠️ EVIDÊNCIA LITERAL OBRIGATÓRIA. Cite palavra por palavra o trecho do material que sustenta o
veredito. Se o material só descreve o ENREDO (quem é a protagonista, qual o conflito) e não diz
nada sobre a ORDEM em que os eventos são apresentados, responda "indeterminado" com evidência
vazia. "Indeterminado" é a resposta certa e esperada na maioria dos casos — não é falha.`

const VERDICT_TOOL: Anthropic.Tool = {
  name: "registrar_veredito",
  description: "Registra o veredito sobre a estrutura de abertura da obra.",
  input_schema: {
    type: "object",
    properties: {
      veredito: {
        type: "string",
        enum: ["flashforward", "linear", "indeterminado"],
        description:
          "flashforward = abre com cena que a narrativa depois ALCANÇA. linear = abertura é o começo cronológico (inclui prólogo de regressão que a nova linha nunca reencontra). indeterminado = a evidência não sustenta nem um nem outro.",
      },
      evidencia: {
        type: "string",
        description:
          "CITAÇÃO LITERAL do material, copiada palavra por palavra. Vazia se não houver citação possível — e nesse caso o veredito é indeterminado.",
      },
      raciocinio: {
        type: "string",
        description:
          "Uma frase: a narrativa reencontra a cena de abertura, ou a cena pertence a uma linha substituída?",
      },
      confianca: { type: "number", description: "0 a 1." },
    },
    required: ["veredito", "evidencia", "raciocinio", "confianca"],
  },
}

/** Sonnet 5 na promo introdutória ($2/$10 por MTok até 2026-08-31). Ver lib/ai/models.ts. */
const PRICE_IN_PER_MTOK = 2.0
const PRICE_OUT_PER_MTOK = 10.0
const PRICE_PER_SEARCH = 0.01

function usageCost(usage: unknown): number {
  const u = usage as
    | { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number }
    | undefined
  const inTok = (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0)
  return (inTok * PRICE_IN_PER_MTOK) / 1e6 + ((u?.output_tokens ?? 0) * PRICE_OUT_PER_MTOK) / 1e6
}

function searchCount(usage: unknown): number {
  const u = usage as { server_tool_use?: { web_search_requests?: number } } | undefined
  return u?.server_tool_use?.web_search_requests ?? 0
}

/**
 * Monta o material local. As reviews que falam da ABERTURA vêm PRIMEIRO — o corte por
 * caracteres come o fim da lista, e cortar justamente a evidência relevante inverteria o
 * veredito sem nada acusar.
 */
export function buildOpeningMaterial(ctx: OpeningStructureContext): string {
  const relevante =
    /first (chapter|ch|episode)|prologue|prolog|opening|beginning|starts?|begins?|flash|timeline|ending|spoil/i

  const textos = ctx.reviews.map((r) => `[${r.source ?? "?"}] ${r.text.slice(0, 1200)}`)
  const ordenadas = [...textos.filter((t) => relevante.test(t)), ...textos.filter((t) => !relevante.test(t))]

  const escolhidas: string[] = []
  let acc = 0
  for (const t of ordenadas.slice(0, MAX_REVIEWS)) {
    if (acc + t.length > MAX_REVIEW_CHARS) break
    escolhidas.push(t)
    acc += t.length
  }

  const partes = [`OBRA: ${ctx.title}`]
  if (ctx.synopsis) partes.push(`\nSINOPSE (descreve o ENREDO, raramente a estrutura):\n${ctx.synopsis.slice(0, 1500)}`)
  if (ctx.tropeTags.length)
    partes.push(`\nTAGS DE TROPO (NÃO são evidência de estrutura):\n${ctx.tropeTags.join(", ")}`)
  if (ctx.digest) partes.push(`\nSÍNTESE DAS REVIEWS (JSON):\n${JSON.stringify(ctx.digest).slice(0, 6000)}`)
  if (escolhidas.length) partes.push(`\nREVIEWS DE LEITORES (${escolhidas.length}):\n${escolhidas.join("\n---\n")}`)
  return partes.join("\n")
}

function extractTool(msg: Anthropic.Message): Record<string, unknown> | null {
  for (const b of msg.content) {
    if (b.type === "tool_use" && b.name === "registrar_veredito") {
      return b.input as Record<string, unknown>
    }
  }
  return null
}

/**
 * O gate de citação vazia mora AQUI e no banco, não só no prompt. Instrução é pedido; o CHECK
 * `works_opening_structure_exige_evidencia` é a garantia. Este é o cinto, o banco é o suspensório
 * — e o suspensório também cobre um `update` à mão no Studio.
 */
export function normalizeOpeningVerdict(payload: Record<string, unknown> | null): {
  verdict: OpeningStructureVerdict
  evidence: string
  rationale: string
  confidence: number
} {
  const evidence = String(payload?.evidencia ?? "").trim()
  const raw = String(payload?.veredito ?? "indeterminado")
  const valid: OpeningStructureVerdict[] = ["flashforward", "linear", "indeterminado"]
  let verdict: OpeningStructureVerdict = valid.includes(raw as OpeningStructureVerdict)
    ? (raw as OpeningStructureVerdict)
    : "indeterminado"
  // Um veredito afirmativo sem citação verificável é exatamente o que este desenho existe para
  // impedir — com 320 obras de reencarnação no catálogo, "flashforward" é o chute plausível.
  if (verdict !== "indeterminado" && evidence.length < MIN_EVIDENCE_CHARS) verdict = "indeterminado"
  return {
    verdict,
    evidence: verdict === "indeterminado" ? "" : evidence,
    rationale: String(payload?.raciocinio ?? ""),
    confidence: Math.max(0, Math.min(1, Number(payload?.confianca ?? 0))),
  }
}

const normalize = normalizeOpeningVerdict

/** ETAPA 1 — só o que já está no banco. ~US$0,016/obra, ~15s. */
export async function analyzeOpeningStructureLocal(
  ctx: OpeningStructureContext,
): Promise<OpeningStructureResult> {
  const client = getAnthropicClient({ maxRetries: 4 })
  const { message, usage } = await createLoggedMessage(
    client,
    {
      model: SONNET_MODEL,
      max_tokens: 1200,
      system: RULE,
      tools: [VERDICT_TOOL],
      tool_choice: { type: "tool", name: "registrar_veredito" },
      messages: [
        {
          role: "user",
          content: `${buildOpeningMaterial(ctx)}\n\nCom base APENAS no material acima, a obra abre com flashforward? Use a tool.`,
        },
      ],
    },
    {
      operation: "opening_structure",
      subOperation: "local",
      promptVersion: OPENING_STRUCTURE_PROMPT_VERSION,
      // ⚠️ Sem workId aqui a proveniência fica órfã para sempre — é exatamente o que
      // aconteceu com `tag_inference`, que por isso não aparece em getWorkAiProvenance.
      workId: ctx.workId,
    },
  )

  return {
    ...normalize(extractTool(message)),
    source: "local",
    modelName: SONNET_MODEL,
    promptVersion: OPENING_STRUCTURE_PROMPT_VERSION,
    costUsd: usageCost(usage),
    searches: 0,
  }
}

/**
 * ETAPA 2 — busca web, disparo explícito do usuário. ~US$0,25, ~1 resgate em 5.
 *
 * ⚠️ Duas voltas e duas buscas é o TETO, e é o conserto de um defeito medido: cada volta
 * REPROCESSA os resultados de busca já acumulados em `messages` (~100k tokens de input), e no
 * piloto uma obra só chegou a US$0,41 com 4 voltas × 3 buscas. Nenhuma resposta útil apareceu
 * depois da segunda.
 */
export async function analyzeOpeningStructureWeb(
  ctx: OpeningStructureContext,
): Promise<OpeningStructureResult> {
  const client = getAnthropicClient({ maxRetries: 4 })
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `A obra "${ctx.title}" (manhwa) abre com flashforward?

O material que eu já tenho é INCONCLUSIVO — ele descreve o enredo, não a ordem em que os eventos são apresentados. Busque na web discussões de leitores sobre o PRIMEIRO CAPÍTULO ou o PRÓLOGO desta obra especificamente.

Depois de buscar, registre o veredito pela tool. Se a busca também só devolver sinopse/premissa, o veredito é "indeterminado" — não infira do tropo.`,
    },
  ]

  let cost = 0
  let searches = 0
  let payload: Record<string, unknown> | null = null

  for (let i = 0; i < 2; i++) {
    const { message, usage } = await createLoggedMessage(
      client,
      {
        model: SONNET_MODEL,
        max_tokens: 2000,
        system: RULE,
        tools: [
          { type: "web_search_20260209", name: "web_search", max_uses: 2 } as unknown as Anthropic.Tool,
          VERDICT_TOOL,
        ],
        messages,
      },
      {
        operation: "opening_structure",
        subOperation: "web",
        promptVersion: OPENING_STRUCTURE_PROMPT_VERSION,
        workId: ctx.workId,
        attempt: i,
      },
    )
    cost += usageCost(usage)
    searches += searchCount(usage)

    payload = extractTool(message)
    if (payload) break

    // Server tools rodam num loop server-side que pode devolver `pause_turn`; reenviar a
    // conversa retoma de onde parou. Sem isto, uma busca longa devolveria veredito vazio.
    messages.push({ role: "assistant", content: message.content })
    if (message.stop_reason !== "pause_turn") {
      messages.push({ role: "user", content: "Registre o veredito usando a tool registrar_veredito." })
    }
  }

  return {
    ...normalize(payload),
    source: "web",
    modelName: SONNET_MODEL,
    promptVersion: OPENING_STRUCTURE_PROMPT_VERSION,
    costUsd: cost + searches * PRICE_PER_SEARCH,
    searches,
  }
}

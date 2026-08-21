import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { MODEL } from "./service"
import { DEEP_DIVE_SYSTEM_PROMPT, buildDeepDiveUserPrompt } from "./deep-dive-prompts"
import { deepDiveToolPayloadSchema } from "./deep-dive-schema"
import type { DeepDiveContext, DeepDivePayload } from "./types"
import type { UsageTokens } from "@/lib/ai/pricing"

// Versão do prompt — incremente quando mudar DEEP_DIVE_SYSTEM_PROMPT ou
// o schema do tool. Importante porque o ai_api_calls.prompt_version é
// usado pra A/B e auditoria de regressão.
// v3 (Item B): bloco PREFERÊNCIAS E REGRAS DO USUÁRIO no profileBlock cacheado
// + instruções (condicional/geral + fallback de reviews em obras magras).
// v4 (Item B): endurecimento — inversão de sentimento + força por evidência
// (regra "evito" confirmada por consenso limita read_when a "guardar" e baixa
// match_score; evidência fraca/única fica só em tags_cons/flags).
// v5 (Item C, Passe 1): consenso das reviews (review_summary) no work bundle.
// v6 (Item C, Passe 2): digest estruturado (review_digest) tem precedência.
export const DEEP_DIVE_PROMPT_VERSION = "deep-dive-v6"

// Extended thinking budget tokens — escolhido em discussão com o user.
// Reduz pra metade na segunda tentativa pra liberar headroom de output
// se a primeira foi cortada por max_tokens.
const THINKING_BUDGET_FIRST = 8000
const THINKING_BUDGET_RETRY = 4000

// max_tokens é o teto TOTAL de output (thinking + resposta visível). A API
// exige max_tokens > thinking.budget_tokens; reservamos folga acima do budget
// de thinking pra caber o payload estruturado (alignment_breakdown é grande).
// É só um teto — não muda custo a menos que o modelo gere mais.
const MAX_TOKENS_FIRST = 12000 // 8000 thinking + ~4000 output
const MAX_TOKENS_RETRY = 10000 // 4000 thinking + ~6000 output

const DEEP_DIVE_TOOL: Anthropic.Messages.Tool = {
  name: "submit_deep_analysis",
  description: "Submete a análise profunda estruturada da obra alvo.",
  input_schema: {
    type: "object",
    properties: {
      match_score: { type: "number", minimum: 0, maximum: 100 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      one_liner: { type: "string", maxLength: 220 },

      alignment_breakdown: {
        type: "object",
        properties: {
          tags_pros: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tag: { type: "string" },
                impact: { type: "number", minimum: 0, maximum: 1 },
                why: { type: "string" },
              },
              required: ["tag", "impact", "why"],
            },
          },
          tags_cons: {
            type: "array",
            items: {
              type: "object",
              properties: {
                tag: { type: "string" },
                impact: { type: "number", minimum: 0, maximum: 1 },
                why: { type: "string" },
              },
              required: ["tag", "impact", "why"],
            },
          },
          criteria_pros: {
            type: "array",
            items: {
              type: "object",
              properties: {
                criterion: { type: "string" },
                score: { type: "number", minimum: 0, maximum: 10 },
                ideal_range: {
                  type: "array",
                  items: { type: "number", minimum: 0, maximum: 10 },
                  minItems: 2,
                  maxItems: 2,
                },
                why: { type: "string" },
              },
              required: ["criterion", "score", "ideal_range", "why"],
            },
          },
          criteria_cons: {
            type: "array",
            items: {
              type: "object",
              properties: {
                criterion: { type: "string" },
                score: { type: "number", minimum: 0, maximum: 10 },
                ideal_range: {
                  type: "array",
                  items: { type: "number", minimum: 0, maximum: 10 },
                  minItems: 2,
                  maxItems: 2,
                },
                why: { type: "string" },
              },
              required: ["criterion", "score", "ideal_range", "why"],
            },
          },
          narrative_match: {
            type: "array",
            items: {
              type: "object",
              properties: {
                pattern: { type: "string" },
                evidence: { type: "string" },
              },
              required: ["pattern", "evidence"],
            },
          },
        },
        required: ["tags_pros", "tags_cons", "criteria_pros", "criteria_cons", "narrative_match"],
      },

      similar_in_library: {
        type: "array",
        items: {
          type: "object",
          properties: {
            work_id: { type: "string", description: "UUID exato fornecido na request." },
            similarity_reason: { type: "string" },
            user_score: { type: "number", minimum: 0, maximum: 10 },
            alignment_signal: {
              type: "string",
              enum: ["positive", "negative", "neutral"],
            },
          },
          required: ["work_id", "similarity_reason", "user_score", "alignment_signal"],
        },
      },

      review_synthesis: {
        type: "object",
        properties: {
          consensus: { type: "string" },
          divergence: { type: "string" },
          flags: { type: "array", items: { type: "string" } },
        },
        required: ["consensus", "divergence", "flags"],
      },

      mood_match: {
        type: ["object", "null"],
        properties: {
          fit: { type: "number", minimum: 0, maximum: 1 },
          why: { type: "string" },
        },
        required: ["fit", "why"],
        description: "null quando userContext não foi fornecido.",
      },

      read_recommendation: {
        type: "object",
        properties: {
          when: {
            type: "string",
            enum: ["agora", "guardar", "evitar"],
          },
          reasoning: { type: "string" },
          suggested_alternative_id: {
            type: "string",
            description: "UUID do pool de alternativas. Omita se pool vazio ou when='agora'.",
          },
        },
        required: ["when", "reasoning"],
      },
    },
    required: [
      "match_score",
      "confidence",
      "one_liner",
      "alignment_breakdown",
      "similar_in_library",
      "review_synthesis",
      "mood_match",
      "read_recommendation",
    ],
  },
}

function findToolUse(message: Anthropic.Messages.Message, toolName: string) {
  return message.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === toolName,
  )
}

// Extended thinking não expõe thinking_tokens diretamente no usage —
// é parte do output_tokens. Aproximamos somando os caracteres dos
// blocks de tipo "thinking" e dividindo por 4 (heurística padrão ≈ 1 token / 4 chars).
function approximateThinkingTokens(message: Anthropic.Messages.Message): number {
  let chars = 0
  for (const block of message.content) {
    if ((block as { type?: string }).type === "thinking") {
      const text = (block as { thinking?: string }).thinking ?? ""
      chars += text.length
    }
  }
  return Math.round(chars / 4)
}

export interface DeepDiveResult {
  payload: DeepDivePayload
  modelName: string
  promptVersion: string
  usage: UsageTokens
  thinkingTokens: number
  apiCallId: string | null
}

export interface RunDeepDiveArgs {
  context: DeepDiveContext
  userContext?: string | null
  /** Item B — preferências/regras livres (texto) injetadas no profileBlock cacheado. */
  preferenceRules?: string[] | null
}

export async function runDeepDive(args: RunDeepDiveArgs): Promise<DeepDiveResult> {
  const client = getAnthropicClient({ maxRetries: 6 })
  const { profileBlock, tailBlock } = buildDeepDiveUserPrompt(
    args.context,
    args.userContext,
    args.preferenceRules,
  )

  // IDs que o modelo pode legitimamente referenciar. Inclui similares e
  // alternativas. work_id da obra alvo NÃO entra (ela é o objeto da análise,
  // não pode aparecer em similar_in_library nem suggested_alternative_id).
  const validSimilarIds = new Set<string>([
    ...args.context.similars.loved.map((w) => w.id),
    ...args.context.similars.avoided.map((w) => w.id),
  ])
  const validAlternativeIds = new Set<string>(args.context.alternatives.map((a) => a.id))

  let lastError: unknown = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const thinkingBudget = attempt === 0 ? THINKING_BUDGET_FIRST : THINKING_BUDGET_RETRY
    const maxTokens = attempt === 0 ? MAX_TOKENS_FIRST : MAX_TOKENS_RETRY

    const { message, apiCallId, usage } = await createLoggedMessage(
      client,
      {
        model: MODEL,
        // Extended thinking exige temperature=1.0; outros valores são rejeitados.
        temperature: 1,
        max_tokens: maxTokens,
        thinking: { type: "enabled", budget_tokens: thinkingBudget },
        system: [
          { type: "text", text: DEEP_DIVE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        tools: [DEEP_DIVE_TOOL],
        // Extended thinking não aceita tool_choice forçado (a API rejeita com
        // "Thinking may not be enabled when tool_choice forces tool use").
        // O prompt já manda "Sempre use a tool submit_deep_analysis", e o
        // bloco `if (!toolUse)` abaixo trata o caso raro do modelo não chamar.
        tool_choice: { type: "auto" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: profileBlock, cache_control: { type: "ephemeral" } },
              { type: "text", text: tailBlock },
            ],
          },
        ],
      },
      {
        operation: "deep_dive",
        subOperation: "analysis",
        promptVersion: DEEP_DIVE_PROMPT_VERSION,
        workId: args.context.work.id,
        attempt,
        metadata: {
          thinkingBudget,
          hasUserContext: !!args.userContext?.trim(),
          nPreferenceRules: args.preferenceRules?.length ?? 0,
          nSimilarsLoved: args.context.similars.loved.length,
          nSimilarsAvoided: args.context.similars.avoided.length,
          nAlternatives: args.context.alternatives.length,
        },
      },
    )

    const toolUse = findToolUse(message, DEEP_DIVE_TOOL.name)
    if (!toolUse) {
      lastError = new Error(
        message.stop_reason === "max_tokens"
          ? "Resposta do Deep Dive cortada por max_tokens (output estruturado não coube — retry com menos thinking)."
          : "Resposta não chamou a tool submit_deep_analysis.",
      )
      continue
    }

    const parsed = deepDiveToolPayloadSchema.safeParse(toolUse.input)
    if (!parsed.success) {
      lastError = new Error(
        `Payload do Deep Dive não atende ao schema: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      )
      continue
    }

    // Filtra IDs alucinados em vez de hard fail — o resto da análise
    // costuma ser útil mesmo quando um ID está errado. Enriquece com
    // title+candidatas direto do contexto pra evitar roundtrip no render.
    const similarMetadata = new Map<string, { title: string; coverUrls: string[] }>()
    for (const w of args.context.similars.loved) similarMetadata.set(w.id, { title: w.title, coverUrls: w.coverUrl ? [w.coverUrl] : [] })
    for (const w of args.context.similars.avoided) similarMetadata.set(w.id, { title: w.title, coverUrls: w.coverUrl ? [w.coverUrl] : [] })

    const filteredSimilars = parsed.data.similar_in_library
      .filter((s) => validSimilarIds.has(s.work_id))
      .map((s) => {
        const meta = similarMetadata.get(s.work_id)
        return {
          ...s,
          ...(meta ? { title: meta.title, coverUrls: meta.coverUrls } : {}),
        }
      })

    const altId = parsed.data.read_recommendation.suggested_alternative_id
    const validAltId = altId && validAlternativeIds.has(altId) ? altId : undefined
    const altTitle = validAltId
      ? args.context.alternatives.find((a) => a.id === validAltId)?.title
      : undefined

    const payload: DeepDivePayload = {
      match_score: parsed.data.match_score,
      confidence: parsed.data.confidence,
      one_liner: parsed.data.one_liner,
      alignment_breakdown: parsed.data.alignment_breakdown,
      similar_in_library: filteredSimilars,
      review_synthesis: parsed.data.review_synthesis,
      mood_match: parsed.data.mood_match,
      read_recommendation: {
        when: parsed.data.read_recommendation.when,
        reasoning: parsed.data.read_recommendation.reasoning,
        ...(validAltId ? { suggested_alternative_id: validAltId } : {}),
        ...(altTitle ? { suggested_alternative_title: altTitle } : {}),
      },
    }

    return {
      payload,
      modelName: MODEL,
      promptVersion: DEEP_DIVE_PROMPT_VERSION,
      usage,
      thinkingTokens: approximateThinkingTokens(message),
      apiCallId,
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Falha desconhecida ao gerar Deep Dive.")
}

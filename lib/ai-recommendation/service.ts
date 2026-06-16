import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { CRITERION_SLUGS } from "@/types/domain"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import {
  RANKING_SYSTEM_PROMPT,
  TASTE_PROFILE_SYSTEM_PROMPT,
  buildRankingUserPrompt,
  buildTasteProfileUserPrompt,
} from "./prompts"
import { rankingToolPayloadSchema, tasteProfileToolPayloadSchema } from "./schema"
import type {
  CandidateWorkInput,
  RankedWork,
  RatedWorkInput,
  RecommendationMode,
  TasteProfilePayload,
} from "./types"

export const MODEL = "claude-sonnet-4-6"
// v2: Smart Shortlist enriquecido (sub-fase 2.3.A) — adicionados campos
// opcionais ao tool submit_ranking: confidence, risks, similar_loved/avoided,
// review_quotes, mood_fit. Sistema prompt instrui sobre cada um.
// v3 (Item B): bloco PREFERÊNCIAS E REGRAS DO USUÁRIO (texto livre condicional/
// geral) injetado no profileBlock cacheado + instruções no system prompt.
// v4 (Item B): endurecimento — inversão de sentimento (review que confirma traço
// evitado conta CONTRA, mesmo se o autor ama) + força por evidência (consenso
// rebaixa alignment_score; evidência fraca fica só em risks).
// v5 (Item C, Passe 1): consenso das reviews (review_summary) no tailBlock +
// seleção das cruas por qualidade/diversidade de fonte (não mais por nota).
// v6 (Item C, Passe 2): digest estruturado (review_digest, Sonnet) tem
// precedência sobre o review_summary-texto no tailBlock.
export const PROMPT_VERSION = "v6"

const CRITERION_SLUG_ENUM = [...CRITERION_SLUGS]

const TASTE_PROFILE_TOOL: Anthropic.Messages.Tool = {
  name: "submit_taste_profile",
  description: "Submete o perfil de gosto consolidado do usuário em formato estruturado.",
  input_schema: {
    type: "object",
    properties: {
      loved_tags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            group: { type: ["string", "null"] },
            strength: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["name", "strength"],
        },
      },
      avoided_tags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            group: { type: ["string", "null"] },
            strength: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["name", "strength"],
        },
      },
      loved_themes: { type: "array", items: { type: "string" } },
      avoided_themes: { type: "array", items: { type: "string" } },
      criterion_preferences: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: {
            ideal_min: { type: "number", minimum: 0, maximum: 10 },
            ideal_max: { type: "number", minimum: 0, maximum: 10 },
            weight: { type: "number", minimum: 0, maximum: 1 },
            note: { type: ["string", "null"] },
          },
          required: ["ideal_min", "ideal_max", "weight"],
        },
        description: `Mapa slug→preferência. Slugs válidos: ${CRITERION_SLUG_ENUM.join(", ")}.`,
      },
      narrative_patterns: { type: "array", items: { type: "string" } },
      summary: { type: "string" },
    },
    required: [
      "loved_tags",
      "avoided_tags",
      "loved_themes",
      "avoided_themes",
      "criterion_preferences",
      "narrative_patterns",
      "summary",
    ],
  },
}

const RANKING_TOOL: Anthropic.Messages.Tool = {
  name: "submit_ranking",
  description: "Submete o ranking dos candidatos por alinhamento com o perfil de gosto.",
  input_schema: {
    type: "object",
    properties: {
      mode_summary: { type: "string" },
      rankings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            work_id: { type: "string" },
            alignment_score: { type: "number", minimum: 0, maximum: 100 },
            justification: { type: "string" },
            top_match_factors: { type: "array", items: { type: "string" } },
          },
          required: ["work_id", "alignment_score", "justification", "top_match_factors"],
        },
      },
    },
    required: ["mode_summary", "rankings"],
  },
}

export interface TasteProfileResult {
  profile: TasteProfilePayload
  modelName: string
  promptVersion: string
  rawResponse: unknown
  usage: TokenUsage
  apiCallId: string | null
}

export interface RankingResult {
  modeSummary: string
  rankings: RankedWork[]
  modelName: string
  promptVersion: string
  rawResponse: unknown
  usage: TokenUsage
  apiCallId: string | null
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

function findToolUse(message: Anthropic.Messages.Message, toolName: string) {
  return message.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === toolName,
  )
}

export async function generateTasteProfile(
  works: RatedWorkInput[],
): Promise<TasteProfileResult> {
  if (works.length === 0) {
    throw new Error("Nenhuma obra avaliada disponível para gerar perfil.")
  }

  const client = getAnthropicClient({ maxRetries: 6 })
  const userPrompt = buildTasteProfileUserPrompt(works)

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { message, apiCallId, usage } = await createLoggedMessage(
      client,
      {
        model: MODEL,
        // Histórico: 3000/4000 cortava com ≥100 obras avaliadas, fazendo o
        // summary ser truncado (o modelo produz primeiro tags+critérios e
        // deixa summary por último). Subimos pra acomodar caudas longas.
        max_tokens: attempt === 0 ? 6000 : 8000,
        temperature: attempt === 0 ? 0.2 : 0,
        system: [
          { type: "text", text: TASTE_PROFILE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        tools: [TASTE_PROFILE_TOOL],
        tool_choice: { type: "tool", name: TASTE_PROFILE_TOOL.name },
        // User prompt cacheado (ephemeral 5min) — quando attempt 1 dispara
        // segundos depois do 0, evita re-criar 90K+ tokens de cache.
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userPrompt, cache_control: { type: "ephemeral" } },
            ],
          },
        ],
      },
      {
        operation: "recommendation_taste_profile",
        promptVersion: PROMPT_VERSION,
        attempt,
        metadata: { nWorks: works.length },
      },
    )

    const toolUse = findToolUse(message, TASTE_PROFILE_TOOL.name)
    if (!toolUse) {
      lastError = new Error(
        message.stop_reason === "max_tokens"
          ? "Resposta cortada por max_tokens ao gerar perfil de gosto."
          : "Resposta não chamou a tool submit_taste_profile.",
      )
      continue
    }

    const parsed = tasteProfileToolPayloadSchema.safeParse(toolUse.input)
    if (!parsed.success) {
      lastError = new Error(
        `Payload do perfil não atende ao schema: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      )
      continue
    }

    const normalized: TasteProfilePayload = {
      ...parsed.data,
      loved_tags: parsed.data.loved_tags.map((t) => ({ ...t, group: t.group ?? null })),
      avoided_tags: parsed.data.avoided_tags.map((t) => ({ ...t, group: t.group ?? null })),
      criterion_preferences: parsed.data.criterion_preferences,
    }

    return {
      profile: normalized,
      modelName: MODEL,
      promptVersion: PROMPT_VERSION,
      rawResponse: toolUse.input,
      usage,
      apiCallId,
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Falha desconhecida ao gerar perfil de gosto.")
}

export interface RankFavoritesArgs {
  profile: TasteProfilePayload
  candidates: CandidateWorkInput[]
  mode: RecommendationMode
  userContext?: string | null
  /** Item B — preferências/regras livres (texto) injetadas no profileBlock cacheado. */
  preferenceRules?: string[] | null
}

export async function rankFavorites(args: RankFavoritesArgs): Promise<RankingResult> {
  if (args.candidates.length === 0) {
    throw new Error("Nenhum candidato para rankear.")
  }

  const client = getAnthropicClient({ maxRetries: 6 })
  const { profileBlock, tailBlock } = buildRankingUserPrompt(
    args.profile,
    args.candidates,
    args.mode,
    args.userContext,
    args.preferenceRules,
  )

  const candidateIdSet = new Set(args.candidates.map((c) => c.id))

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { message, apiCallId, usage } = await createLoggedMessage(
      client,
      {
        model: MODEL,
        // Histórico: 4000/5000 era suficiente pra ranking simples (v1), mas o
        // v2 enriquecido (confidence/risks/similar_loved/avoided/review_quotes/
        // mood_fit) gera ~250-300 tokens por candidato. Com 20 candidatos +
        // mode_summary, precisamos de folga ≥ 8000.
        max_tokens: attempt === 0 ? 8000 : 12000,
        temperature: attempt === 0 ? 0.2 : 0,
        system: [
          { type: "text", text: RANKING_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        tools: [RANKING_TOOL],
        tool_choice: { type: "tool", name: RANKING_TOOL.name },
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
        operation: "recommendation_rank",
        promptVersion: PROMPT_VERSION,
        attempt,
        metadata: {
          mode: args.mode,
          nCandidates: args.candidates.length,
          hasUserContext: !!args.userContext,
          nPreferenceRules: args.preferenceRules?.length ?? 0,
        },
      },
    )

    const toolUse = findToolUse(message, RANKING_TOOL.name)
    if (!toolUse) {
      lastError = new Error(
        message.stop_reason === "max_tokens"
          ? "Resposta cortada por max_tokens no ranking."
          : "Resposta não chamou a tool submit_ranking.",
      )
      continue
    }

    const parsed = rankingToolPayloadSchema.safeParse(toolUse.input)
    if (!parsed.success) {
      lastError = new Error(
        `Payload do ranking não atende ao schema: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      )
      continue
    }

    // Filtra work_ids fora dos candidatos enviados e deduplica: o modelo às
    // vezes repete a mesma obra. Consumidores assumem 1 ranking por work_id
    // (senão o upsert com onConflict="work_id" quebra com "ON CONFLICT DO
    // UPDATE command cannot affect row a second time"). Mantém a 1ª ocorrência.
    const seenIds = new Set<string>()
    const validRankings = parsed.data.rankings.filter(
      (r) => candidateIdSet.has(r.work_id) && !seenIds.has(r.work_id) && seenIds.add(r.work_id),
    )
    if (validRankings.length === 0) {
      lastError = new Error("Ranking não trouxe nenhum work_id válido dos candidatos enviados.")
      continue
    }

    validRankings.sort((a, b) => b.alignment_score - a.alignment_score)

    return {
      modeSummary: parsed.data.mode_summary,
      rankings: validRankings,
      modelName: MODEL,
      promptVersion: PROMPT_VERSION,
      rawResponse: toolUse.input,
      usage,
      apiCallId,
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Falha desconhecida ao rankear favoritos.")
}

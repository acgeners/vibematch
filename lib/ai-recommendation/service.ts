import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import { CRITERION_SLUGS } from "@/types/domain"
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
export const PROMPT_VERSION = "v1"

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
}

export interface RankingResult {
  modeSummary: string
  rankings: RankedWork[]
  modelName: string
  promptVersion: string
  rawResponse: unknown
  usage: TokenUsage
}

export interface TokenUsage {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
}

function extractUsage(message: Anthropic.Messages.Message): TokenUsage {
  const u = message.usage as Anthropic.Messages.Usage & {
    cache_creation_input_tokens?: number | null
    cache_read_input_tokens?: number | null
  }
  return {
    inputTokens: u?.input_tokens ?? null,
    outputTokens: u?.output_tokens ?? null,
    cacheReadTokens: u?.cache_read_input_tokens ?? null,
    cacheCreationTokens: u?.cache_creation_input_tokens ?? null,
  }
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
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY não configurada — geração de perfil de gosto abortada.")
  }
  if (works.length === 0) {
    throw new Error("Nenhuma obra avaliada disponível para gerar perfil.")
  }

  const client = new Anthropic({ apiKey })
  const userPrompt = buildTasteProfileUserPrompt(works)

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: attempt === 0 ? 3000 : 4000,
      temperature: attempt === 0 ? 0.2 : 0,
      system: [
        { type: "text", text: TASTE_PROFILE_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools: [TASTE_PROFILE_TOOL],
      tool_choice: { type: "tool", name: TASTE_PROFILE_TOOL.name },
      messages: [{ role: "user", content: userPrompt }],
    })

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
      usage: extractUsage(message),
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
}

export async function rankFavorites(args: RankFavoritesArgs): Promise<RankingResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY não configurada — ranking abortado.")
  }
  if (args.candidates.length === 0) {
    throw new Error("Nenhum candidato para rankear.")
  }

  const client = new Anthropic({ apiKey })
  const { profileBlock, tailBlock } = buildRankingUserPrompt(
    args.profile,
    args.candidates,
    args.mode,
    args.userContext,
  )

  const candidateIdSet = new Set(args.candidates.map((c) => c.id))

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: attempt === 0 ? 4000 : 5000,
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
    })

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

    const validRankings = parsed.data.rankings.filter((r) => candidateIdSet.has(r.work_id))
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
      usage: extractUsage(message),
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Falha desconhecida ao rankear favoritos.")
}

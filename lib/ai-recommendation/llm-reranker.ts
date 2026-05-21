import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import {
  MODEL,
  PROMPT_VERSION,
  type RankingResult,
  type TokenUsage,
} from "./service"
import {
  RANKING_SYSTEM_PROMPT,
  buildRankingUserPromptWithLabel,
} from "./prompts"
import { rankingToolPayloadSchema } from "./schema"
import type { CandidateWorkInput, TasteProfilePayload } from "./types"

/**
 * Núcleo reutilizável do LLM re-ranker. Aceita um `modeLabel` arbitrário —
 * usado tanto por `rankFavorites` (lista de favoritos) quanto por
 * `rerankTopN` (top-N de qualquer filtro em /ranking, Passo 8).
 *
 * Mantém o mesmo schema de output que o `rankFavorites` original e o
 * mesmo tool de structured output (`submit_ranking`).
 */

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

function findToolUse(message: Anthropic.Messages.Message, toolName: string) {
  return message.content.find(
    (block): block is Extract<typeof block, { type: "tool_use" }> =>
      block.type === "tool_use" && block.name === toolName,
  )
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

export interface RankCandidatesArgs {
  profile: TasteProfilePayload
  candidates: CandidateWorkInput[]
  /** Label livre que descreve o modo (ex: "Top-50 filtrado por drama+completed"). */
  modeLabel: string
  userContext?: string | null
}

export async function rankCandidates(args: RankCandidatesArgs): Promise<RankingResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY não configurada — ranking abortado.")
  }
  if (args.candidates.length === 0) {
    throw new Error("Nenhum candidato para rankear.")
  }

  const client = new Anthropic({ apiKey })
  const { profileBlock, tailBlock } = buildRankingUserPromptWithLabel(
    args.profile,
    args.candidates,
    args.modeLabel,
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
    : new Error("Falha desconhecida ao rankear candidatos.")
}

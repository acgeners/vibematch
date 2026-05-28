import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import { MODEL, PROMPT_VERSION, type RankingResult } from "./service"
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
            alignment_score: {
              type: "number",
              minimum: 0,
              maximum: 100,
              description: "Score de alinhamento 0–100. Use a escala inteira.",
            },
            justification: {
              type: "string",
              description: "1–2 frases citando tags/critérios/quotes que sustentam o score.",
            },
            top_match_factors: {
              type: "array",
              items: { type: "string" },
              description: "2–4 chips curtos (tags, critérios, padrões).",
            },
            confidence: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Quanto VOCÊ confia neste alignment_score. 0.9+ = match óbvio; 0.5–0.8 = razoável; <0.5 = pouca evidência.",
            },
            risks: {
              type: "array",
              items: { type: "string" },
              description: "1–3 razões pra NÃO ler (mesmo se match alto). Ex.: tag evitada presente, MeanPostScore baixo em similares.",
            },
            similar_loved: {
              type: "array",
              items: { type: "string" },
              description: "1–2 work_id de obras que o user AMA (user_score ≥ 8) e que esta lembra. Use APENAS IDs reais do bloco profile/biblioteca.",
            },
            similar_avoided: {
              type: "array",
              items: { type: "string" },
              description: "1–2 work_id de obras que o user AVALIOU MAL (user_score ≤ 5) e que esta lembra.",
            },
            review_quotes: {
              type: "array",
              items: { type: "string" },
              description: "1–2 quotes curtos das reviews fornecidas (entre aspas) que sustentam o match ou expõem risco. NÃO INVENTAR.",
            },
            mood_fit: {
              type: "number",
              minimum: 0,
              maximum: 1,
              description: "Fit com o mood/contexto do user. APENAS quando houver CONTEXTO ADICIONAL na request — caso contrário, omita.",
            },
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

export interface RankCandidatesArgs {
  profile: TasteProfilePayload
  candidates: CandidateWorkInput[]
  /** Label livre que descreve o modo (ex: "Top-50 filtrado por drama+completed"). */
  modeLabel: string
  userContext?: string | null
  /** Opcional — pra correlacionar com o run que originou a chamada. */
  runId?: string | null
}

export async function rankCandidates(args: RankCandidatesArgs): Promise<RankingResult> {
  if (args.candidates.length === 0) {
    throw new Error("Nenhum candidato para rankear.")
  }

  const client = getAnthropicClient({ maxRetries: 6 })
  const { profileBlock, tailBlock } = buildRankingUserPromptWithLabel(
    args.profile,
    args.candidates,
    args.modeLabel,
    args.userContext,
  )

  const candidateIdSet = new Set(args.candidates.map((c) => c.id))

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { message, apiCallId, usage } = await createLoggedMessage(
      client,
      {
        model: MODEL,
        // Mantém consistência com `rankFavorites` em service.ts — o output
        // enriquecido (v2) por candidato é grande e o teto antigo cortava
        // o mode_summary final em runs com ≥15 candidatos.
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
        operation: "recommendation_llm_rerank",
        promptVersion: PROMPT_VERSION,
        runId: args.runId ?? null,
        attempt,
        metadata: {
          modeLabel: args.modeLabel,
          nCandidates: args.candidates.length,
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
      usage,
      apiCallId,
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Falha desconhecida ao rankear candidatos.")
}

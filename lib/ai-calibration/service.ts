import "server-only"
import type Anthropic from "@anthropic-ai/sdk"
import { CRITERION_SLUGS } from "@/types/domain"
import { createLoggedMessage, getAnthropicClient } from "@/lib/ai/anthropic-client"
import {
  AUDIT_SYSTEM_PROMPT,
  BIAS_SYSTEM_PROMPT,
  buildAuditUserPrompt,
  buildBiasUserPrompt,
} from "./prompts"
import { auditToolPayloadSchema, biasToolPayloadSchema } from "./schema"
import type {
  AuditSuggestionFromModel,
  AuditWorkInput,
  BiasCorrelationEntry,
  BiasReport,
  BiasResidualExample,
  BiasStatsByCriterion,
} from "./types"
import type { CriterionSlug } from "@/types/domain"

export const MODEL = "claude-sonnet-4-6"
export const PROMPT_VERSION = "v1"

const CRITERION_SLUG_ENUM = [...CRITERION_SLUGS]

const AUDIT_TOOL: Anthropic.Messages.Tool = {
  name: "submit_audits",
  description:
    "Submete as sugestões de ajuste de category_scores detectadas no lote auditado.",
  input_schema: {
    type: "object",
    properties: {
      audits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            work_id: { type: "string" },
            criterion_slug: { type: "string", enum: CRITERION_SLUG_ENUM },
            current_score: { type: "number", minimum: 0, maximum: 10 },
            suggested_score: { type: "number", minimum: 0, maximum: 10 },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            justification: { type: "string" },
          },
          required: [
            "work_id",
            "criterion_slug",
            "current_score",
            "suggested_score",
            "confidence",
            "justification",
          ],
        },
      },
    },
    required: ["audits"],
  },
}

const BIAS_TOOL: Anthropic.Messages.Tool = {
  name: "submit_bias_report",
  description:
    "Submete o relatório de viés sistemático por critério em formato estruturado.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      entries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            criterion_slug: { type: "string", enum: CRITERION_SLUG_ENUM },
            bias_estimate: { type: "number", minimum: -5, maximum: 5 },
            dispersion: { type: "string", enum: ["low", "medium", "high"] },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            recommendation: { type: "string" },
          },
          required: [
            "criterion_slug",
            "bias_estimate",
            "dispersion",
            "confidence",
            "recommendation",
          ],
        },
      },
    },
    required: ["summary", "entries"],
  },
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

export interface AuditResult {
  suggestions: AuditSuggestionFromModel[]
  modelName: string
  promptVersion: string
  usage: TokenUsage
  rawResponse: unknown
  apiCallId: string | null
}

export interface AuditCallMeta {
  runId?: string | null
  chunkIndex?: number | null
}

export async function requestCalibrationAudit(
  works: AuditWorkInput[],
  callMeta: AuditCallMeta = {},
): Promise<AuditResult> {
  if (works.length === 0) {
    return {
      suggestions: [],
      modelName: MODEL,
      promptVersion: PROMPT_VERSION,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      rawResponse: null,
      apiCallId: null,
    }
  }

  const client = getAnthropicClient({ maxRetries: 6 })
  const workIdSet = new Set(works.map((w) => w.workId))
  const validSlugs = new Set<string>(CRITERION_SLUG_ENUM)

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const userPrompt = buildAuditUserPrompt(works)
    const { message, apiCallId, usage } = await createLoggedMessage(
      client,
      {
        model: MODEL,
        max_tokens: attempt === 0 ? 4000 : 5000,
        temperature: attempt === 0 ? 0.2 : 0,
        system: [
          { type: "text", text: AUDIT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        tools: [AUDIT_TOOL],
        tool_choice: { type: "tool", name: AUDIT_TOOL.name },
        messages: [{ role: "user", content: userPrompt }],
      },
      {
        operation: "calibration_audit",
        promptVersion: PROMPT_VERSION,
        runId: callMeta.runId ?? null,
        attempt,
        metadata: {
          nWorks: works.length,
          chunkIndex: callMeta.chunkIndex ?? null,
        },
      },
    )

    const toolUse = findToolUse(message, AUDIT_TOOL.name)
    if (!toolUse) {
      lastError = new Error(
        message.stop_reason === "max_tokens"
          ? "Resposta cortada por max_tokens no audit."
          : "Resposta não chamou submit_audits.",
      )
      continue
    }

    const parsed = auditToolPayloadSchema.safeParse(toolUse.input)
    if (!parsed.success) {
      lastError = new Error(
        `Payload do audit inválido: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      )
      continue
    }

    const filtered: AuditSuggestionFromModel[] = []
    for (const a of parsed.data.audits) {
      if (!workIdSet.has(a.work_id)) continue
      if (!validSlugs.has(a.criterion_slug)) continue
      if (Math.abs(a.suggested_score - a.current_score) < 0.5) continue
      if (a.confidence < 0.5) continue
      filtered.push({
        workId: a.work_id,
        criterionSlug: a.criterion_slug as CriterionSlug,
        currentScore: a.current_score,
        suggestedScore: a.suggested_score,
        confidence: a.confidence,
        justification: a.justification,
      })
    }

    return {
      suggestions: filtered,
      modelName: MODEL,
      promptVersion: PROMPT_VERSION,
      usage,
      rawResponse: toolUse.input,
      apiCallId,
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Falha desconhecida no audit IA.")
}

export interface BiasResult {
  report: BiasReport
  modelName: string
  promptVersion: string
  usage: TokenUsage
  rawResponse: unknown
  apiCallId: string | null
}

export async function requestBiasReport(
  args: {
    stats: BiasStatsByCriterion[]
    residuals: BiasResidualExample[]
    correlations: BiasCorrelationEntry[]
  },
  callMeta: { runId?: string | null } = {},
): Promise<BiasResult> {
  if (args.stats.length === 0) {
    throw new Error("Sem estatísticas para gerar relatório de viés.")
  }

  const client = getAnthropicClient({ maxRetries: 6 })

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const userPrompt = buildBiasUserPrompt(args.stats, args.residuals, args.correlations)
    const { message, apiCallId, usage } = await createLoggedMessage(
      client,
      {
        model: MODEL,
        max_tokens: attempt === 0 ? 3500 : 4500,
        temperature: attempt === 0 ? 0.2 : 0,
        system: [
          { type: "text", text: BIAS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        tools: [BIAS_TOOL],
        tool_choice: { type: "tool", name: BIAS_TOOL.name },
        messages: [{ role: "user", content: userPrompt }],
      },
      {
        operation: "calibration_bias",
        promptVersion: PROMPT_VERSION,
        runId: callMeta.runId ?? null,
        attempt,
        metadata: {
          nCriteria: args.stats.length,
          nResiduals: args.residuals.length,
        },
      },
    )

    const toolUse = findToolUse(message, BIAS_TOOL.name)
    if (!toolUse) {
      lastError = new Error(
        message.stop_reason === "max_tokens"
          ? "Resposta cortada por max_tokens no relatório de viés."
          : "Resposta não chamou submit_bias_report.",
      )
      continue
    }

    const parsed = biasToolPayloadSchema.safeParse(toolUse.input)
    if (!parsed.success) {
      lastError = new Error(
        `Payload do relatório inválido: ${parsed.error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
      )
      continue
    }

    const report: BiasReport = {
      summary: parsed.data.summary,
      entries: parsed.data.entries.map((e) => ({
        criterion_slug: e.criterion_slug as CriterionSlug,
        bias_estimate: e.bias_estimate,
        dispersion: e.dispersion,
        confidence: e.confidence,
        recommendation: e.recommendation,
      })),
    }

    return {
      report,
      modelName: MODEL,
      promptVersion: PROMPT_VERSION,
      usage,
      rawResponse: toolUse.input,
      apiCallId,
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Falha desconhecida no relatório de viés.")
}

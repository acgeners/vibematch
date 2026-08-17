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
import { AUDITABLE_CRITERIA, isAuditableCriterion } from "./policy"
import type {
  AuditSuggestionFromModel,
  AuditWorkInput,
  CriterionAnchor,
  BiasCorrelationEntry,
  BiasReport,
  BiasResidualExample,
  BiasStatsByCriterion,
} from "./types"
import type { CriterionSlug } from "@/types/domain"
import { SONNET_MODEL } from "@/lib/ai/models"

export const MODEL = SONNET_MODEL
/**
 * v5 (2026-08-16): `user_score` deixa de ser âncora e vira contexto proibido de justificar
 * sozinho; a pós-leitura (`post_*`) é promovida à evidência principal. O motivo é medido —
 * a auto-aplicação que subiu `protagonist` 7,0 → 8,5 se justificava com "user_score
 * altíssimo (9.4)", que é gosto entrando num atributo de catálogo COMPARTILHADO. A pool
 * passa a exigir pós-leitura: sem ela o auditor relê a mesma evidência da avaliação.
 *
 * ⚠️ Pula a v4 de propósito: ela existiu num piloto e está gravada em `ai_api_calls`
 * (3 chamadas). Reusar o rótulo faria duas réguas diferentes dividirem o mesmo nome no log.
 *
 * v3 (2026-08-16): o auditor passou a receber o DIGEST das reviews e as ÂNCORAS de
 * distribuição do catálogo — as duas causas dos erros de 85% (juiz sem evidência e juiz sem
 * escala). Obra sem digest sai do run.
 *
 * v2 (2026-08-16): `adult_content` e `couple_dynamics` saíram do escopo da auditoria
 * (ver `policy.ts`). O prompt e o enum da tool mudaram junto, então a versão sobe — ela é
 * gravada em `calibration_runs.prompt_version` e é o que `loadLastRun` compara para
 * detectar drift de régua. Não subir faria o rótulo do run mentir E o próximo run rodar
 * incremental sobre uma régua diferente da anterior.
 *
 * ⚠️ Consequência esperada: o primeiro run depois desta mudança é uma varredura COMPLETA.
 */
export const PROMPT_VERSION = "v5"

/** Universo do relatório de VIÉS — diagnóstico cobre os 9, inclusive os fora da auditoria. */
const CRITERION_SLUG_ENUM = [...CRITERION_SLUGS]
/** Universo da AUDITORIA — o modelo não consegue sequer nomear um critério fora do escopo. */
const AUDITABLE_SLUG_ENUM = [...AUDITABLE_CRITERIA]

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
            criterion_slug: { type: "string", enum: AUDITABLE_SLUG_ENUM },
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
  anchors: CriterionAnchor[] = [],
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

  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const userPrompt = buildAuditUserPrompt(works, anchors)
    const { message, apiCallId, usage } = await createLoggedMessage(
      client,
      {
        model: MODEL,
        max_tokens: 8000,
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

    // Truncamento por max_tokens deixa o tool_use.input incompleto. Como o
    // schema faz `audits.default([])`, um payload truncado faria safeParse
    // "passar" como 0 sugestões — mascarando a falha. Descarta e tenta de novo.
    if (message.stop_reason === "max_tokens") {
      lastError = new Error(
        "Resposta cortada por max_tokens no audit (tool_use truncado) — payload descartado.",
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
      // O enum da tool já barra critério fora do escopo; isto é a 2ª camada, do mesmo
      // desenho de `LOCKED_SOURCES` (o prompt pede, o código garante).
      if (!isAuditableCriterion(a.criterion_slug)) continue
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

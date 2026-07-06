import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import { createAdminClient } from "@/lib/supabase/admin"
import { deepStripLoneSurrogates } from "@/lib/ai/sanitize"
import { modelRejectsSampling } from "./models"
import { computeCostUsd } from "./pricing"
import type { UsageTokens } from "./pricing"
import { classifyAiError } from "@/lib/ai-observability/classify-error"
import { AI_OPERATIONS } from "@/lib/ai-observability/types"
import type {
  AiCacheStatus,
  AiErrorCategory,
  AiImageStatus,
  AiOperationKey,
  AiWorkloadType,
} from "@/lib/ai-observability/types"

/**
 * Garante um workload_type em toda linha: usa o explícito do caller, senão o
 * típico da operação no catálogo (admin p/ calibration/tag, recurring p/ as
 * demais). Linhas históricas continuam classificadas na leitura (conservador).
 */
function withWorkloadDefault(meta: LogMeta): LogMeta {
  if (meta.workloadType) return meta
  const fallback = AI_OPERATIONS[meta.operation as AiOperationKey]?.typicalWorkload ?? null
  return fallback ? { ...meta, workloadType: fallback } : meta
}

export interface LogMeta {
  operation: string
  subOperation?: string | null
  promptVersion?: string | null
  workId?: string | null
  runId?: string | null
  attempt?: number | null
  userId?: string | null
  /** Observabilidade (Plano 1): agrupa as TENTATIVAS de uma mesma solicitação lógica. */
  logicalRequestId?: string | null
  /** Observabilidade: origem da chamada (recurring/admin/experiment/…). */
  workloadType?: AiWorkloadType | null
  /** Observabilidade: status do cache de resultado nesta linha (geralmente "miss"). */
  cacheStatus?: AiCacheStatus | null
  /** Observabilidade: ciclo de vida da capa (só ai_evaluation). */
  imageStatus?: AiImageStatus | null
  metadata?: Record<string, unknown>
}

export interface LoggedMessageResult {
  message: Anthropic.Messages.Message
  apiCallId: string | null
  usage: UsageTokens
}

export function getAnthropicClient(opts?: { maxRetries?: number; apiKey?: string }): Anthropic {
  const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY não configurada.")
  }
  return new Anthropic({ apiKey, maxRetries: opts?.maxRetries ?? 6 })
}

function extractUsage(message: Anthropic.Messages.Message): UsageTokens {
  const u = message.usage as Anthropic.Messages.Usage & {
    cache_creation_input_tokens?: number | null
    cache_read_input_tokens?: number | null
  }
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u?.cache_creation_input_tokens ?? 0,
  }
}

function buildMetadataBag(
  meta: LogMeta,
  extra?: { errorCategory?: AiErrorCategory | null },
): Record<string, unknown> | null {
  const bag: Record<string, unknown> = { ...(meta.metadata ?? {}) }
  if (meta.workId) bag.work_id = meta.workId
  if (meta.runId) bag.run_id = meta.runId
  if (meta.attempt !== null && meta.attempt !== undefined) bag.attempt = meta.attempt
  // Campos de observabilidade (Plano 1, Fase B). Só entram quando presentes.
  if (meta.logicalRequestId) bag.logical_request_id = meta.logicalRequestId
  if (meta.workloadType) bag.workload_type = meta.workloadType
  if (meta.cacheStatus) bag.cache_status = meta.cacheStatus
  if (meta.imageStatus) bag.image_status = meta.imageStatus
  if (extra?.errorCategory) bag.error_category = extra.errorCategory
  return Object.keys(bag).length > 0 ? bag : null
}

async function persistLog(args: {
  meta: LogMeta
  model: string
  usage: UsageTokens
  latencyMs: number
  status: "success" | "error"
  errorMessage?: string | null
  errorCategory?: AiErrorCategory | null
  stopReason?: string | null
  requestId?: string | null
}): Promise<string | null> {
  try {
    const cost = computeCostUsd(args.model, args.usage)
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("ai_api_calls")
      .insert({
        operation: args.meta.operation,
        sub_operation: args.meta.subOperation ?? null,
        model_name: args.model,
        prompt_version: args.meta.promptVersion ?? null,
        input_tokens: args.usage.inputTokens,
        output_tokens: args.usage.outputTokens,
        cache_read_tokens: args.usage.cacheReadTokens,
        cache_creation_tokens: args.usage.cacheCreationTokens,
        cost_input_usd: cost.costInputUsd,
        cost_output_usd: cost.costOutputUsd,
        cost_cache_read_usd: cost.costCacheReadUsd,
        cost_cache_creation_usd: cost.costCacheCreationUsd,
        pricing_source: cost.pricingSource,
        latency_ms: args.latencyMs,
        status: args.status,
        error_message: args.errorMessage ?? null,
        stop_reason: args.stopReason ?? null,
        request_id: args.requestId ?? null,
        user_id: args.meta.userId ?? null,
        metadata: buildMetadataBag(args.meta, { errorCategory: args.errorCategory }),
      })
      .select("id")
      .single()

    if (error) {
      console.warn("[ai-log] insert falhou:", error.message)
      return null
    }
    return data?.id ?? null
  } catch (err) {
    console.warn("[ai-log] insert exception:", err instanceof Error ? err.message : err)
    return null
  }
}

/** Status HTTP do erro do SDK Anthropic, quando exposto. */
function httpStatusFromError(err: unknown): number | null {
  if (typeof err === "object" && err !== null && "status" in err) {
    const s = (err as { status?: unknown }).status
    if (typeof s === "number" && Number.isFinite(s)) return s
  }
  return null
}

/**
 * Compat de parâmetros por família de modelo (backstop central). Modelos como
 * Sonnet 5 / Opus 4.7+ REJEITAM `temperature`/`top_p`/`top_k` (HTTP 400) e ligam
 * thinking por default quando ele é omitido. Como TODA chamada Claude passa por
 * `createLoggedMessage`, sanitizar aqui cobre todos os call sites sem tocar em
 * cada um — e reverter o `SONNET_MODEL` pro 4.6 volta a aceitar tudo (o 4.6 não
 * casa em `modelRejectsSampling`, então os params passam intactos).
 */
function sanitizeParamsForModel(
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
): Anthropic.Messages.MessageCreateParamsNonStreaming {
  const model = typeof params.model === "string" ? params.model : String(params.model)
  if (!modelRejectsSampling(model)) return params
  const { temperature: _t, top_p: _p, top_k: _k, ...rest } = params
  void _t
  void _p
  void _k
  // Preserva o determinismo atual (o 4.6 rodava sem thinking): fixa disabled
  // quando o caller não especificou (todas essas famílias aceitam `disabled`).
  return { ...rest, thinking: rest.thinking ?? { type: "disabled" } }
}

export async function createLoggedMessage(
  client: Anthropic,
  params: Anthropic.Messages.MessageCreateParamsNonStreaming,
  meta: LogMeta,
): Promise<LoggedMessageResult> {
  const start = Date.now()
  const modelStr = typeof params.model === "string" ? params.model : String(params.model)

  // Defesa central: remove surrogates UTF-16 soltos de TODO o payload antes de
  // serializar. Sem isso, qualquer texto raspado truncado no meio de um emoji
  // (vários `.slice(0, N)` em lib/external/*) faz a Anthropic responder 400
  // "no low surrogate in string". Vale pra todas as chamadas que passam por aqui.
  const safeParams = deepStripLoneSurrogates(sanitizeParamsForModel(params))

  try {
    // Usa streaming internamente (.stream().finalMessage()) em vez de
    // create(): a geração das respostas estruturadas longas (avaliação IA ~3-4k
    // tokens) ultrapassa o limite recomendado de requests não-stream do SDK.
    // O streaming evita esse risco e a interface segue idêntica — só o Message
    // final importa pros callers. Latência é medida do start ao finalMessage.
    const message = await client.messages.stream(safeParams).finalMessage()
    const usage = extractUsage(message)
    const apiCallId = await persistLog({
      meta: withWorkloadDefault(meta),
      model: message.model ?? modelStr,
      usage,
      latencyMs: Date.now() - start,
      status: "success",
      stopReason: message.stop_reason ?? null,
      requestId: message.id ?? null,
    })
    return { message, apiCallId, usage }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    // Classificação central: todo erro que passa pelo provider ganha uma
    // categoria estável (status HTTP + mensagem), sem expor conteúdo sensível.
    const errorCategory = classifyAiError({
      status: httpStatusFromError(err),
      message: errorMessage,
      stage: "provider",
    })
    await persistLog({
      meta: withWorkloadDefault(meta),
      model: modelStr,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      latencyMs: Date.now() - start,
      status: "error",
      errorMessage,
      errorCategory,
    })
    throw err
  }
}

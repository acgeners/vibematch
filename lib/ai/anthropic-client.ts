import "server-only"
import Anthropic from "@anthropic-ai/sdk"
import { createAdminClient } from "@/lib/supabase/admin"
import { deepStripLoneSurrogates } from "@/lib/ai/sanitize"
import { computeCostUsd } from "./pricing"
import type { UsageTokens } from "./pricing"

export interface LogMeta {
  operation: string
  subOperation?: string | null
  promptVersion?: string | null
  workId?: string | null
  runId?: string | null
  attempt?: number | null
  userId?: string | null
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

function buildMetadataBag(meta: LogMeta): Record<string, unknown> | null {
  const bag: Record<string, unknown> = { ...(meta.metadata ?? {}) }
  if (meta.workId) bag.work_id = meta.workId
  if (meta.runId) bag.run_id = meta.runId
  if (meta.attempt !== null && meta.attempt !== undefined) bag.attempt = meta.attempt
  return Object.keys(bag).length > 0 ? bag : null
}

async function persistLog(args: {
  meta: LogMeta
  model: string
  usage: UsageTokens
  latencyMs: number
  status: "success" | "error"
  errorMessage?: string | null
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
        metadata: buildMetadataBag(args.meta),
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
  const safeParams = deepStripLoneSurrogates(params)

  try {
    // Usa streaming internamente (.stream().finalMessage()) em vez de
    // create(): a geração das respostas estruturadas longas (avaliação IA ~3-4k
    // tokens) ultrapassa o limite recomendado de requests não-stream do SDK.
    // O streaming evita esse risco e a interface segue idêntica — só o Message
    // final importa pros callers. Latência é medida do start ao finalMessage.
    const message = await client.messages.stream(safeParams).finalMessage()
    const usage = extractUsage(message)
    const apiCallId = await persistLog({
      meta,
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
    await persistLog({
      meta,
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
    })
    throw err
  }
}

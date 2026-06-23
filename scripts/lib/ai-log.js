/* eslint-disable @typescript-eslint/no-require-imports */
// Adaptador de logger das chamadas Anthropic PARA OS SCRIPTS (Plano 2 §17).
//
// Os scripts admin rodam em Node puro (`node --env-file` / dotenv) e não podem
// importar lib/ai/anthropic-client.ts (server-only + alias @/ + TS). Este
// adaptador CJS registra as chamadas na MESMA tabela ai_api_calls (migration
// 059), com o MESMO formato de custo — sem furar a telemetria central.
//
// Preços: lê lib/ai/pricing-data.json (fonte ÚNICA, compartilhada com pricing.ts)
// — preços NÃO são duplicados. Best-effort: falha de log NUNCA derruba o script.
//
// Uso (CJS):  const { loggedCreate } = require("./lib/ai-log.js")
// Uso (ESM):  import { loggedCreate } from "./lib/ai-log.js"

const pricingData = require("../../lib/ai/pricing-data.json")

const MILLION = 1_000_000

function computeCostUsd(model, usage) {
  const price = pricingData.models[model]
  if (!price) {
    return {
      cost_input_usd: 0,
      cost_output_usd: 0,
      cost_cache_read_usd: 0,
      cost_cache_creation_usd: 0,
      pricing_source: `unknown@${model}`,
    }
  }
  return {
    cost_input_usd: ((usage.inputTokens || 0) / MILLION) * price.inputPerMTok,
    cost_output_usd: ((usage.outputTokens || 0) / MILLION) * price.outputPerMTok,
    cost_cache_read_usd: ((usage.cacheReadTokens || 0) / MILLION) * price.cacheReadPerMTok,
    cost_cache_creation_usd: ((usage.cacheCreationTokens || 0) / MILLION) * price.cacheCreationPerMTok,
    pricing_source: pricingData.snapshotTag,
  }
}

function extractUsage(message) {
  const u = (message && message.usage) || {}
  return {
    inputTokens: u.input_tokens || 0,
    outputTokens: u.output_tokens || 0,
    cacheReadTokens: u.cache_read_input_tokens || 0,
    cacheCreationTokens: u.cache_creation_input_tokens || 0,
  }
}

/**
 * Insere UMA linha em ai_api_calls (best-effort; nunca lança). `meta.workloadType`
 * deve ser admin/backfill/experiment (vai pra metadata.workload_type, lido pela
 * classificação de workload da observabilidade).
 */
async function logAiCall(supabase, args) {
  try {
    const cost = computeCostUsd(args.model, args.usage || {})
    const metadata = Object.assign({}, args.metadata)
    if (args.workloadType) metadata.workload_type = args.workloadType
    const { error } = await supabase.from("ai_api_calls").insert({
      operation: args.operation,
      sub_operation: args.subOperation || null,
      model_name: args.model,
      prompt_version: args.promptVersion || null,
      input_tokens: (args.usage && args.usage.inputTokens) || 0,
      output_tokens: (args.usage && args.usage.outputTokens) || 0,
      cache_read_tokens: (args.usage && args.usage.cacheReadTokens) || 0,
      cache_creation_tokens: (args.usage && args.usage.cacheCreationTokens) || 0,
      cost_input_usd: cost.cost_input_usd,
      cost_output_usd: cost.cost_output_usd,
      cost_cache_read_usd: cost.cost_cache_read_usd,
      cost_cache_creation_usd: cost.cost_cache_creation_usd,
      pricing_source: cost.pricing_source,
      latency_ms: args.latencyMs != null ? args.latencyMs : 0,
      status: args.status,
      error_message: args.errorMessage || null,
      stop_reason: args.stopReason || null,
      request_id: args.requestId || null,
      metadata: Object.keys(metadata).length > 0 ? metadata : null,
    })
    if (error) console.warn("[ai-log:script] insert falhou:", error.message)
  } catch (err) {
    console.warn("[ai-log:script] exception:", err && err.message ? err.message : err)
  }
}

/**
 * Substitui `client.messages.create(params)` registrando a chamada. Mede latência,
 * captura usage/stop_reason e loga sucesso OU erro. NÃO engole o erro do provider:
 * loga e relança (o script trata como antes).
 */
async function loggedCreate(client, supabase, params, meta) {
  const start = Date.now()
  try {
    const message = await client.messages.create(params)
    await logAiCall(supabase, {
      operation: meta.operation,
      subOperation: meta.subOperation,
      model: (message && message.model) || params.model,
      promptVersion: meta.promptVersion,
      workloadType: meta.workloadType,
      usage: extractUsage(message),
      latencyMs: Date.now() - start,
      status: "success",
      stopReason: message && message.stop_reason,
      requestId: message && message.id,
      metadata: meta.metadata,
    })
    return message
  } catch (err) {
    await logAiCall(supabase, {
      operation: meta.operation,
      subOperation: meta.subOperation,
      model: params.model,
      promptVersion: meta.promptVersion,
      workloadType: meta.workloadType,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      latencyMs: Date.now() - start,
      status: "error",
      errorMessage: err && err.message ? err.message : String(err),
      metadata: meta.metadata,
    })
    throw err
  }
}

module.exports = { loggedCreate, logAiCall, extractUsage, computeCostUsd }

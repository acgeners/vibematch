/**
 * Estimativa de custo + decisão do gate (Fase B passo 1, endurecida) — ver
 * ARQUITETURA-ORQUESTRACAO.md §0/§5 (decisão D3: cascata + micro-threshold).
 *
 * A estimativa é um UPPER BOUND conservador (não média histórica):
 *  - tokens base = instruções fixas + OUTPUT MÁXIMO (max_tokens real do call);
 *  - tokens por item = per-obra/per-review conservador × escala;
 *  - SEM desconto de cache (não confia que o prompt cache reduzirá o custo);
 *  - × COST_SAFETY_MULTIPLIER (margem explícita, centralizada);
 *  - modelo/preço desconhecido ⇒ Infinity (bloqueia, não assume custo zero).
 *
 * Puro: usa o pricing real (lib/ai/pricing.ts). Não chama LLM, não toca IO.
 */

import { computeCostUsd, priceForModel, type UsageTokens } from "@/lib/ai/pricing"
import { ACTION_CONTRACTS, type ActionName } from "./contracts"
import type { ExecutionPlan } from "./planner"

/** Teto abaixo do qual a cascata roda sem confirmação (sub-cent silencioso). */
export const DEFAULT_MICRO_THRESHOLD_USD = 0.02

/**
 * Margem de segurança sobre a estimativa de tokens. NÃO é média histórica — é
 * teto. Justificativa (dados atuais): a base já embute o OUTPUT MÁXIMO (max_tokens)
 * e um per-item conservador, mas a contagem de tokens por item varia (sinopses/
 * reviews longas, instruções que mudam). 1.5× cobre subcontagem de ~50% sem
 * depender de cache. Centralizado aqui — não espalhar como número mágico.
 */
export const COST_SAFETY_MULTIPLIER = 1.5

const ZERO_USAGE: UsageTokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }

/**
 * Custo bruto (USD) de um `usage` para um modelo. Modelo/preço DESCONHECIDO ⇒
 * Infinity (bloqueia downstream) em vez do 0 que `computeCostUsd` devolveria.
 * NaN/negativo (defensivo) ⇒ Infinity.
 */
export function estimateUsdFromTokens(model: string, usage: UsageTokens): number {
  if (!priceForModel(model)) return Number.POSITIVE_INFINITY
  const b = computeCostUsd(model, usage)
  const sum = b.costInputUsd + b.costOutputUsd + b.costCacheReadUsd + b.costCacheCreationUsd
  return Number.isFinite(sum) && sum >= 0 ? sum : Number.POSITIVE_INFINITY
}

function buildUsage(
  base: UsageTokens,
  perItem: UsageTokens | undefined,
  scale: number,
): UsageTokens {
  const s = Math.max(0, scale)
  return {
    inputTokens: base.inputTokens + (perItem?.inputTokens ?? 0) * s,
    outputTokens: base.outputTokens + (perItem?.outputTokens ?? 0) * s,
    // Conservador: NÃO assume cache read (desconto). cache write só se a base
    // declarar — senão input é cobrado a preço cheio.
    cacheReadTokens: 0,
    cacheCreationTokens: base.cacheCreationTokens + (perItem?.cacheCreationTokens ?? 0) * s,
  }
}

export interface StepCostEstimate {
  /** Custo provável (sem a margem de segurança) — para exibir a "faixa". */
  likelyUsd: number
  /** Upper bound usado pelo GATE (likely × COST_SAFETY_MULTIPLIER). */
  upperBoundUsd: number
  pricingKnown: boolean
  usage: UsageTokens
}

/** Estimativa decomposta de UMA ação, escalada por `scale` (itens processados). */
export function estimateStep(action: ActionName, scale = 1): StepCostEstimate {
  const est = ACTION_CONTRACTS[action].estimate
  if (!est) return { likelyUsd: 0, upperBoundUsd: 0, pricingKnown: true, usage: ZERO_USAGE }
  if (!priceForModel(est.model)) {
    return { likelyUsd: Number.POSITIVE_INFINITY, upperBoundUsd: Number.POSITIVE_INFINITY, pricingKnown: false, usage: ZERO_USAGE }
  }
  const usage = buildUsage(est.base, est.perItem, scale)
  const likely = estimateUsdFromTokens(est.model, usage)
  return { likelyUsd: likely, upperBoundUsd: likely * COST_SAFETY_MULTIPLIER, pricingKnown: true, usage }
}

/** Upper bound do custo de UMA ação — o valor que o gate usa. */
export function estimateStepUsd(action: ActionName, scale = 1): number {
  return estimateStep(action, scale).upperBoundUsd
}

/**
 * Custo estimado (UPPER BOUND) da CASCATA: pré-requisitos do plano + a ação-alvo.
 */
export function estimatePlanUsd(
  plan: ExecutionPlan,
  scaleByAction: Partial<Record<ActionName, number>> = {},
): number {
  const stepsUsd = plan.steps.reduce((sum, s) => sum + estimateStepUsd(s.action, scaleByAction[s.action] ?? 1), 0)
  return stepsUsd + estimateStepUsd(plan.action, scaleByAction[plan.action] ?? 1)
}

export type CostDecision = "auto" | "needs_confirmation" | "blocked_over_cap"

export interface DecideCostArgs {
  estimatedUsd: number
  microThresholdUsd: number
  allowPaid: boolean
  /** Teto autorizado pelo caller (USD). Indefinido = sem teto. */
  maxCostUsd?: number
}

/**
 * Regra do gate (D3):
 *   não-finito (preço desconhecido/NaN)  → needs_confirmation (NUNCA auto)
 *   est ≤ micro                          → auto (sub-cent, silencioso)
 *   allowPaid && (sem teto || est≤teto)  → auto (pré-autorizado)
 *   allowPaid && est>teto                → blocked_over_cap
 *   senão                                → needs_confirmation
 */
export function decideCost(args: DecideCostArgs): CostDecision {
  const { estimatedUsd, microThresholdUsd, allowPaid, maxCostUsd } = args
  if (!Number.isFinite(estimatedUsd)) return "needs_confirmation"
  if (estimatedUsd <= microThresholdUsd) return "auto"
  if (allowPaid) {
    if (maxCostUsd != null && estimatedUsd > maxCostUsd) return "blocked_over_cap"
    return "auto"
  }
  return "needs_confirmation"
}

export type CostGateResult =
  | { ok: true; estimatedUsd: number; likelyUsd: number }
  | { blocked: "threshold" | "over_cap" | "pricing_unknown"; estimatedUsd: number; likelyUsd: number }

/**
 * Gate de custo de UMA ação: estima o upper bound (escalado), bloqueia preço
 * desconhecido, e aplica decideCost. O gate sempre usa o UPPER BOUND.
 */
export function gateActionCost(
  action: ActionName,
  scale: number,
  opts: { allowPaid: boolean; maxCostUsd?: number; microThresholdUsd?: number },
): CostGateResult {
  const micro = opts.microThresholdUsd ?? DEFAULT_MICRO_THRESHOLD_USD
  const { likelyUsd, upperBoundUsd, pricingKnown } = estimateStep(action, scale)
  if (!pricingKnown) return { blocked: "pricing_unknown", estimatedUsd: upperBoundUsd, likelyUsd }
  const decision = decideCost({ estimatedUsd: upperBoundUsd, microThresholdUsd: micro, allowPaid: opts.allowPaid, maxCostUsd: opts.maxCostUsd })
  if (decision === "needs_confirmation") return { blocked: "threshold", estimatedUsd: upperBoundUsd, likelyUsd }
  if (decision === "blocked_over_cap") return { blocked: "over_cap", estimatedUsd: upperBoundUsd, likelyUsd }
  return { ok: true, estimatedUsd: upperBoundUsd, likelyUsd }
}

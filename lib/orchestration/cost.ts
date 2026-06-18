/**
 * Estimativa de custo + decisão do gate (Fase B passo 1) — ver
 * ARQUITETURA-ORQUESTRACAO.md §0/§5 (decisão D3: cascata + micro-threshold).
 *
 * Puro: usa as estimativas heurísticas dos contratos e o pricing real
 * (lib/ai/pricing.ts). Não chama LLM, não toca IO.
 */

import { computeCostUsd, type UsageTokens } from "@/lib/ai/pricing"
import { ACTION_CONTRACTS, type ActionName } from "./contracts"
import type { ExecutionPlan } from "./planner"

/** Teto abaixo do qual a cascata roda sem confirmação (sub-cent silencioso). */
export const DEFAULT_MICRO_THRESHOLD_USD = 0.02

/** Custo estimado (USD) de UMA ação, escalado por `scale` (itens processados). */
export function estimateStepUsd(action: ActionName, scale = 1): number {
  const est = ACTION_CONTRACTS[action].estimate
  if (!est) return 0
  const { model, base, perItem } = est
  const usage: UsageTokens = {
    inputTokens: base.inputTokens + (perItem?.inputTokens ?? 0) * scale,
    outputTokens: base.outputTokens + (perItem?.outputTokens ?? 0) * scale,
    cacheReadTokens: base.cacheReadTokens + (perItem?.cacheReadTokens ?? 0) * scale,
    cacheCreationTokens: base.cacheCreationTokens + (perItem?.cacheCreationTokens ?? 0) * scale,
  }
  const b = computeCostUsd(model, usage)
  return b.costInputUsd + b.costOutputUsd + b.costCacheReadUsd + b.costCacheCreationUsd
}

/**
 * Custo estimado da CASCATA: pré-requisitos do plano + a própria ação-alvo.
 * `scaleByAction` permite escalar ações metered (ex.: perfil sobre N obras).
 */
export function estimatePlanUsd(
  plan: ExecutionPlan,
  scaleByAction: Partial<Record<ActionName, number>> = {},
): number {
  const stepsUsd = plan.steps.reduce(
    (sum, s) => sum + estimateStepUsd(s.action, scaleByAction[s.action] ?? 1),
    0,
  )
  const targetUsd = estimateStepUsd(plan.action, scaleByAction[plan.action] ?? 1)
  return stepsUsd + targetUsd
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
 *   est ≤ micro                          → auto (sub-cent, silencioso)
 *   allowPaid && (sem teto || est≤teto)  → auto (pré-autorizado)
 *   allowPaid && est>teto                → blocked_over_cap
 *   senão                                → needs_confirmation
 */
export function decideCost(args: DecideCostArgs): CostDecision {
  const { estimatedUsd, microThresholdUsd, allowPaid, maxCostUsd } = args
  if (estimatedUsd <= microThresholdUsd) return "auto"
  if (allowPaid) {
    if (maxCostUsd != null && estimatedUsd > maxCostUsd) return "blocked_over_cap"
    return "auto"
  }
  return "needs_confirmation"
}

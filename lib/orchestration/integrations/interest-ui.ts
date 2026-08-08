/**
 * Mapeamento PURO do resultado de `ensurePredictInterest` para os estados
 * TIPADOS que a UI consome (passo 4 etapa 2). Sem IO, sem server-only — pode ser
 * importado por client e server. O import do tipo do outcome é type-only (erasado),
 * então não puxa o módulo server-only para o cliente.
 */
import type { PredictInterestOutcome } from "./synopsis-interest"
import type { SynopsisQuality } from "@/types/domain"
import { formatUsd, formatUsdApprox } from "@/lib/format/money"

export type WorkPredictResult =
  | { status: "fresh" | "succeeded"; predictedQuality: SynopsisQuality; partial: boolean; usedFallbacks: string[] }
  | { status: "processing"; message: string }
  | { status: "not_ready"; message: string }
  | { status: "blocked_manual"; message: string }
  | { status: "blocked_cost_confirmation"; reason: string; likelyUsd: number; upperBoundUsd: number; message: string }
  | { status: "failed"; error: string }

export interface PredictWorkOpts {
  /** Confirma a cascata (gerar/atualizar perfil) — allowPaid=true (uma confirmação). */
  confirmCascade?: boolean
  maxCostUsd?: number
  /** Aceita usar perfil stale como resultado parcial. */
  acceptStaleProfile?: boolean
}

export function interestCostMessage(reason: string, likely: number, upper: number): string {
  if (reason === "profile_cascade")
    return `Atualizar o perfil + prever: ${formatUsdApprox(likely)} (provável) / até ${formatUsd(upper)}. Dá pra prever só com o perfil atual (mais barato).`
  if (reason === "over_cap") return `Custo (até ${formatUsd(upper)}) acima do teto configurado.`
  if (reason === "pricing_unknown") return "Custo não estimável (preço do modelo desconhecido) — bloqueado."
  return `Esta previsão custa ${formatUsdApprox(likely)} (provável) / até ${formatUsd(upper)}. Confirmar?`
}

export function mapInterestOutcome(o: PredictInterestOutcome): WorkPredictResult {
  switch (o.status) {
    case "fresh":
    case "succeeded":
      return { status: o.status, predictedQuality: o.predictedQuality, partial: o.partial, usedFallbacks: o.usedFallbacks }
    case "processing":
      return { status: "processing", message: o.reason === "consolidating" ? "Consolidando a sinopse — tente em instantes." : "Previsão já em andamento." }
    case "stale":
      return { status: "processing", message: "As entradas mudaram durante o cálculo — refaça a previsão." }
    case "not_ready":
      return { status: "not_ready", message: o.message }
    case "blocked_manual":
      return { status: "blocked_manual", message: o.message }
    case "blocked_cost_confirmation":
      return { status: "blocked_cost_confirmation", reason: o.reason, likelyUsd: o.likelyUsd, upperBoundUsd: o.estimatedUsd, message: interestCostMessage(o.reason, o.likelyUsd, o.estimatedUsd) }
    case "failed":
      return { status: "failed", error: o.error }
  }
}

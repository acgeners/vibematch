"use server"

import { revalidatePath } from "next/cache"
import { ensureReviewDigest } from "@/lib/orchestration/integrations/reviews"

export interface GenerateDigestResult {
  ok: boolean
  /** "generated" | "fresh" | "immaterial" | "no_reviews" | "processing" | "blocked" | "error" */
  status: string
  message?: string
  costUsd?: number
}

/**
 * Gera/regenera o digest estruturado (Sonnet) de UMA obra, sob demanda (botão da
 * página da obra). `allowPaid` = clique deliberado pré-autoriza o custo (~$0,02–0,05).
 * `force` (regerar manual) ignora o gate por-contagem; sem force, o gate decide
 * (absent/stale → gera; fresh → skip sem custo). Lê o corpus CANÔNICO (work_reviews
 * + manual externa). NÃO regenera o resumo (Haiku) — é artefato separado.
 */
export async function generateWorkReviewDigest(
  workId: string,
  opts: { force?: boolean } = {},
): Promise<GenerateDigestResult> {
  if (!workId) return { ok: false, status: "error", message: "Obra inválida." }

  const outcome = await ensureReviewDigest(workId, { allowPaid: true, force: opts.force })
  revalidatePath(`/titles/${workId}`)

  switch (outcome.status) {
    case "succeeded":
      return { ok: true, status: "generated", costUsd: outcome.costUsd }
    case "skipped":
      return {
        ok: true,
        status: outcome.reason,
        message: outcome.reason === "fresh" ? "Digest já está em dia." : "Mudança imaterial — digest mantido.",
      }
    case "not_ready":
      return { ok: false, status: "no_reviews", message: outcome.message }
    case "processing":
      return { ok: true, status: "processing", message: "Geração do digest em andamento." }
    case "blocked_cost_confirmation":
      return { ok: false, status: "blocked", message: `Confirmação de custo necessária (~$${outcome.estimatedUsd.toFixed(3)}).` }
    case "failed":
      return { ok: false, status: "error", message: outcome.error }
    default:
      return { ok: false, status: "error", message: "Resultado inesperado." }
  }
}

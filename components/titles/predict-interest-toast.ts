"use client"

import { toast } from "sonner"
import { predictSynopsisQualityForWorkAction } from "@/server/actions/synopsis-quality"
import type { PredictWorkOpts } from "@/lib/orchestration/integrations/interest-ui"
import { SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"

/**
 * Chama a previsão individual (passo 4) e traduz o estado TIPADO em toast,
 * preservando o padrão de UI existente. O custo (cascata de perfil) vira um toast
 * com botão "Confirmar" que reexecuta com `confirmCascade` — uma confirmação única,
 * sem modal novo. Mensagens explicam a causa específica (perfil/sinopse/custo/job).
 */
export async function predictInterestWithToast(
  workId: string,
  refresh: () => void,
  opts: PredictWorkOpts = {},
): Promise<void> {
  const res = await predictSynopsisQualityForWorkAction(workId, opts)
  switch (res.status) {
    case "fresh":
    case "succeeded": {
      const label = SYNOPSIS_QUALITY_LABELS[res.predictedQuality]
      const partial = res.partial ? ` · parcial (${res.usedFallbacks.join(", ")})` : ""
      toast.success(`Interesse estimado: ${res.predictedQuality} (${label})${partial}`)
      refresh()
      break
    }
    case "processing":
      toast.info(res.message)
      break
    case "not_ready":
    case "blocked_manual":
      toast.error(res.message)
      break
    case "failed":
      toast.error(`Falhou: ${res.error}. Tente novamente.`)
      break
    case "blocked_cost_confirmation":
      toast(res.message, {
        duration: 12000,
        action: {
          label: "Confirmar",
          onClick: () => {
            void predictInterestWithToast(workId, refresh, { ...opts, confirmCascade: true })
          },
        },
      })
      break
  }
}

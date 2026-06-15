"use client"

import { useTransition } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { toast } from "sonner"
import { Sparkles, Loader2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  predictSynopsisQualityForWorkAction,
  applySynopsisPredictionAction,
} from "@/server/actions/synopsis-quality"
import { SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"

export interface PredictSynopsisRowActionsProps {
  workId: string
  /** Já existe previsão persistida? Muda "Prever" → "Reprever" e habilita Aplicar. */
  hasPrediction: boolean
  /** Previsão já igual ao valor manual? Desabilita Aplicar. */
  alreadyApplied: boolean
  isPaid?: boolean
}

/**
 * Ações por linha da fila de Interesse Sinopse (aba /ai-evaluation?tab=sinopse).
 * Espelha o RerankAiRkButton da fila de IA Rk, somando o "Aplicar" (copia a
 * previsão pro campo manual — única via que entra no pipeline de notas).
 */
export function PredictSynopsisRowActions({
  workId,
  hasPrediction,
  alreadyApplied,
  isPaid = true,
}: PredictSynopsisRowActionsProps) {
  const refresh = useRefresh()
  const [predicting, startPredict] = useTransition()
  const [applying, startApply] = useTransition()

  if (!isPaid) {
    return (
      <Button variant="outline" size="sm" className="gap-1.5" disabled title="Feature do plano Pago.">
        <Sparkles className="h-3.5 w-3.5" />
        Prever
        <span className="ml-1 rounded bg-muted px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Pago
        </span>
      </Button>
    )
  }

  const runPredict = () => {
    startPredict(async () => {
      const res = await predictSynopsisQualityForWorkAction(workId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      const q = res.data?.predictedQuality
      toast.success(q ? `Interesse estimado: ${q} (${SYNOPSIS_QUALITY_LABELS[q]})` : "Interesse estimado.")
      refresh()
    })
  }

  const runApply = () => {
    startApply(async () => {
      const res = await applySynopsisPredictionAction(workId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success("Aplicado ao Interesse sinopse.")
      refresh()
    })
  }

  return (
    <div className="flex flex-col items-stretch gap-2">
      <Button variant="outline" size="sm" onClick={runPredict} disabled={predicting} className="gap-1.5">
        {predicting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {predicting ? "Estimando…" : hasPrediction ? "Reprever" : "Prever"}
      </Button>
      {hasPrediction && (
        <Button
          variant={alreadyApplied ? "ghost" : "secondary"}
          size="sm"
          onClick={runApply}
          disabled={applying || alreadyApplied}
          className="gap-1.5"
        >
          {applying ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : alreadyApplied ? (
            <Check className="h-3.5 w-3.5" />
          ) : null}
          {alreadyApplied ? "Aplicado" : "Aplicar"}
        </Button>
      )}
    </div>
  )
}

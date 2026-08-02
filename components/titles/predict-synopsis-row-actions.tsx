"use client"

import { useTransition } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { toast } from "sonner"
import { Sparkles, Loader2, Check, SkipForward } from "lucide-react"
import { Button } from "@/components/ui/button"
import { applySynopsisPredictionAction, skipSynopsisInterestAction } from "@/server/actions/synopsis-quality"
import { predictInterestWithToast } from "@/components/titles/predict-interest-toast"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { GenerationGate } from "@/components/generation/generation-gate"
import type { UiReadiness } from "@/lib/orchestration/ui-readiness"

export interface PredictSynopsisRowActionsProps {
  workId: string
  /** Já existe previsão persistida? Muda "Prever" → "Reprever" e habilita Aplicar. */
  hasPrediction: boolean
  /** Previsão já igual ao valor manual? Desabilita Aplicar. */
  alreadyApplied: boolean
  /** Prontidão do gerador (motor → UI). Quando presente, gate no "Prever". */
  readiness?: UiReadiness | null
  isPaid?: boolean
}

/**
 * Ações por linha da fila de Interesse Sinopse (aba /fila-recomendacao?tab=sinopse).
 * Espelha o RerankAiRkButton da fila de IA Rk, somando o "Aplicar" (copia a
 * previsão pro campo manual — única via que entra no pipeline de notas).
 */
export function PredictSynopsisRowActions({
  workId,
  hasPrediction,
  alreadyApplied,
  readiness,
  isPaid = true,
}: PredictSynopsisRowActionsProps) {
  const refresh = useRefresh()
  const confirmCost = useCostConfirm()
  const [predicting, startPredict] = useTransition()
  const [applying, startApply] = useTransition()
  const [skipping, startSkip] = useTransition()

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

  const runPredict = async () => {
    if (!(await confirmCost({ action: "predict_interest" }))) return
    startPredict(async () => {
      await predictInterestWithToast(workId, refresh, {}, confirmCost)
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

  const runSkip = () => {
    startSkip(async () => {
      const res = await skipSynopsisInterestAction(workId)
      if (res.error) {
        toast.error(res.error)
        return
      }
      toast.success("Obra pulada — fora da fila.")
      refresh()
    })
  }

  const gate = readiness ?? null
  const blocked = gate ? !gate.ready : false
  const blockTitle =
    gate && !gate.ready
      ? [`Falta ${gate.blocking.map((b) => b.label).join(", ")}`, gate.blocking[0]?.instruction]
          .filter(Boolean)
          .join(" — ")
      : undefined

  const predictButton = (
    <Button size="sm" onClick={() => void runPredict()} disabled={predicting || blocked} title={blockTitle} className="w-full gap-1.5">
      {predicting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      {predicting ? "Estimando…" : hasPrediction ? "Reprever" : "Prever"}
    </Button>
  )

  return (
    <div className="flex flex-col items-stretch gap-2">
      {gate ? (
        <GenerationGate readiness={gate} stretch>
          {predictButton}
        </GenerationGate>
      ) : (
        predictButton
      )}
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
      <Button
        variant="outline"
        size="sm"
        onClick={runSkip}
        disabled={skipping}
        className="gap-1.5"
        title="Pular — tira a obra da fila de Interesse na Obra (não toca no valor)"
      >
        {skipping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SkipForward className="h-3.5 w-3.5" />}
        Pular
      </Button>
    </div>
  )
}

"use client"

import { useTransition } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { toast } from "sonner"
import { Sparkles, Loader2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { applySynopsisPredictionAction } from "@/server/actions/synopsis-quality"
import { predictInterestWithToast } from "@/components/titles/predict-interest-toast"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"
import type { SynopsisQuality } from "@/types/domain"
import type { UiReadiness } from "@/lib/orchestration/ui-readiness"
import { GenerationGate } from "@/components/generation/generation-gate"
import { InputConfidenceSeal } from "@/components/generation/input-confidence-seal"

export interface SynopsisQualitySuggestionProps {
  workId: string
  /** Valor MANUAL atual (works.synopsis_quality) — pra saber se já foi aplicado. */
  manualValue: SynopsisQuality | null
  prediction: {
    predictedQuality: SynopsisQuality
    justification: string | null
    confidence: number | null
    stale: boolean
  } | null
  /** A obra tem sinopse canônica? Fallback quando `readiness` não é passado. */
  hasCanonicalSynopsis: boolean
  /** Prontidão do gerador (motor de orquestração → UI). Quando presente, dita o
   *  bloqueio/âmbar/selo; senão cai no check antigo de `hasCanonicalSynopsis`. */
  readiness?: UiReadiness | null
  /** Previsão IA é feature do plano Pago. Controla só a aparência. */
  isPaid?: boolean
}

/**
 * Sugestão IA do "Interesse Sinopse" abaixo da sinopse. É uma SUGESTÃO separada:
 * "Aplicar" copia o valor pro campo manual (única via que entra no pipeline de
 * notas) por ação explícita do usuário. "Prever/Reprever" dispara a estimativa.
 */
export function SynopsisQualitySuggestion({
  workId,
  manualValue,
  prediction,
  hasCanonicalSynopsis,
  readiness,
  isPaid = true,
}: SynopsisQualitySuggestionProps) {
  const refresh = useRefresh()
  const [predicting, startPredict] = useTransition()
  const [applying, startApply] = useTransition()
  const confirmCost = useCostConfirm()

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
      toast.success("Aplicado ao Interesse na Obra.")
      refresh()
    })
  }

  if (!isPaid) {
    return (
      <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        Estimar Interesse na Obra por IA é uma feature do plano Pago.
      </div>
    )
  }

  const alreadyApplied = prediction != null && manualValue === prediction.predictedQuality

  // Prontidão do motor de orquestração (quando passada). Dita bloqueio/âmbar/selo;
  // sem ela, mantém o check antigo de sinopse canônica.
  const gate = readiness ?? null
  const blocked = gate ? !gate.ready : !hasCanonicalSynopsis
  const blockTitle =
    gate && !gate.ready
      ? [`Falta ${gate.blocking.map((b) => b.label).join(", ")}`, gate.blocking[0]?.instruction]
          .filter(Boolean)
          .join(" — ")
      : hasCanonicalSynopsis
        ? undefined
        : "Sem sinopse canônica para avaliar."

  const predictButton = (
    <Button
      variant="outline"
      size="sm"
      className="h-7 gap-1.5 text-xs"
      onClick={() => void runPredict()}
      disabled={predicting || blocked}
      title={blockTitle}
    >
      {predicting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      {predicting ? "Estimando…" : prediction ? "Reprever" : "Prever"}
    </Button>
  )

  return (
    <div className="mt-3 space-y-2 border-t border-border/40 pt-3">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" /> Interesse na Obra (sugestão IA)
      </span>
      <div className="flex items-center gap-2">
        {gate ? (
          <GenerationGate readiness={gate} showSeal={false} className="min-w-0 flex-1">
            {predictButton}
          </GenerationGate>
        ) : (
          <div className="flex-1">{predictButton}</div>
        )}
        {gate?.ready && <InputConfidenceSeal readiness={gate} className="shrink-0" />}
      </div>

      {prediction ? (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-0.5 text-xs font-semibold text-rose-600 dark:text-rose-300">
              {prediction.predictedQuality} — {SYNOPSIS_QUALITY_LABELS[prediction.predictedQuality]}
            </span>
            {prediction.confidence != null && (
              <span className="text-[11px] text-muted-foreground">
                confiança {Math.round(prediction.confidence * 100)}%
              </span>
            )}
            {prediction.stale && (
              <span className="inline-flex items-center rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-300">
                desatualizado
              </span>
            )}
            <Button
              variant={alreadyApplied ? "ghost" : "secondary"}
              size="sm"
              className="ml-auto h-7 gap-1.5 text-xs"
              onClick={runApply}
              disabled={applying || alreadyApplied}
            >
              {applying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : alreadyApplied ? (
                <Check className="h-3.5 w-3.5" />
              ) : null}
              {alreadyApplied ? "Aplicado" : "Aplicar"}
            </Button>
          </div>
          {prediction.justification && (
            <p className="text-xs leading-5 text-muted-foreground">{prediction.justification}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {hasCanonicalSynopsis
            ? "Estime o quanto esta sinopse combina com seu perfil de gosto."
            : "Gere a sinopse consolidada para habilitar a estimativa."}
        </p>
      )}
    </div>
  )
}

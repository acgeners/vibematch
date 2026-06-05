"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { Sparkles, Loader2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { predictSynopsisQualityForDraftAction } from "@/server/actions/synopsis-quality"
import { SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"
import type { SynopsisQuality } from "@/types/domain"

export interface SynopsisQualityDraftSuggestionProps {
  /** Lê título/sinopse canônica/tags FRESCOS no momento do clique. */
  getInput: () => { title: string; synopsis: string; tags: string[] }
  /** A sinopse canônica já foi consolidada? Sem ela não há o que avaliar. */
  hasCanonicalSynopsis: boolean
  /** Consolidação da sinopse canônica em andamento — aguarda terminar. */
  canonicalLoading: boolean
  /** Valor MANUAL atual do form (synopsis_quality) — pra marcar "Aplicado". */
  manualValue: SynopsisQuality | null
  /** Copia a previsão pro campo manual do form (não toca no banco). */
  onApply: (quality: SynopsisQuality) => void
}

/**
 * Sugestão IA do "Interesse Sinopse" no form de /titles/new (rascunho, sem obra
 * salva). É uma SUGESTÃO separada: a previsão roda em memória contra a sinopse
 * canônica + tags do form; "Aplicar" só copia o valor pro campo manual. Nada é
 * persistido até a obra ser criada.
 */
export function SynopsisQualityDraftSuggestion({
  getInput,
  hasCanonicalSynopsis,
  canonicalLoading,
  manualValue,
  onApply,
}: SynopsisQualityDraftSuggestionProps) {
  const [predicting, startPredict] = useTransition()
  const [prediction, setPrediction] = useState<{
    predictedQuality: SynopsisQuality
    justification: string
    confidence: number | null
  } | null>(null)

  const runPredict = () => {
    const input = getInput()
    startPredict(async () => {
      const res = await predictSynopsisQualityForDraftAction(input)
      if (res.error || !res.data) {
        toast.error(res.error ?? "Falha ao estimar Interesse Sinopse.")
        return
      }
      setPrediction(res.data)
      toast.success(
        `Interesse estimado: ${res.data.predictedQuality} (${SYNOPSIS_QUALITY_LABELS[res.data.predictedQuality]})`,
      )
    })
  }

  const canPredict = hasCanonicalSynopsis && !canonicalLoading
  const alreadyApplied = prediction != null && manualValue === prediction.predictedQuality

  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-card/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" /> Interesse sinopse (sugestão IA)
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          onClick={runPredict}
          disabled={predicting || !canPredict}
          title={canPredict ? undefined : "Gere a sinopse canônica primeiro."}
        >
          {predicting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {predicting ? "Estimando…" : prediction ? "Reprever" : "Prever"}
        </Button>
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
            <Button
              type="button"
              variant={alreadyApplied ? "ghost" : "secondary"}
              size="sm"
              className="ml-auto h-7 gap-1.5 text-xs"
              onClick={() => onApply(prediction.predictedQuality)}
              disabled={alreadyApplied}
            >
              {alreadyApplied ? <Check className="h-3.5 w-3.5" /> : null}
              {alreadyApplied ? "Aplicado" : "Aplicar"}
            </Button>
          </div>
          {prediction.justification && (
            <p className="text-xs leading-5 text-muted-foreground">{prediction.justification}</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {canonicalLoading
            ? "Consolidando a sinopse canônica…"
            : hasCanonicalSynopsis
              ? "Estime o quanto esta sinopse combina com seu perfil de gosto."
              : "Gere a sinopse canônica (seção Sinopse) para habilitar a estimativa."}
        </p>
      )}
    </div>
  )
}

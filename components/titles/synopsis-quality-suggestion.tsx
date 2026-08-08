"use client"

import { useTransition } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { toast } from "sonner"
import { Sparkles, Loader2, Check, Heart, ArrowRight, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { applySynopsisPredictionAction } from "@/server/actions/synopsis-quality"
import { predictInterestWithToast } from "@/components/titles/predict-interest-toast"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { SYNOPSIS_QUALITY_LABELS } from "@/lib/constants/criteria"
import type { SynopsisQuality } from "@/types/domain"
import type { UiReadiness } from "@/lib/orchestration/ui-readiness"
import { InputConfidenceSeal } from "@/components/generation/input-confidence-seal"
import { QualityHearts } from "@/components/ui/quality-hearts"
import { SynopsisQualityPicker } from "@/components/titles/synopsis-quality-picker"
import { InterestAppliedMark } from "@/components/ui/interest-applied-mark"

export interface SynopsisQualitySuggestionProps {
  workId: string
  /** Valor MANUAL atual (works.synopsis_quality) — pra saber se já foi aplicado. */
  manualValue: SynopsisQuality | null
  /** `synopsis_quality_source === "prediction_applied"` ⇒ selo ✨ no valor manual. */
  manualFromPrediction?: boolean
  /** Quem está vendo pode escrever o próprio estado de leitura? (mesmo gate das actions) */
  canEditManual?: boolean
  prediction: {
    predictedQuality: SynopsisQuality
    justification: string | null
    confidence: number | null
    stale: boolean
    /** ISO de `synopsis_quality_predictions.predicted_at` — dá referência ao "desatualizada". */
    predictedAt?: string | null
    modelName?: string | null
  } | null
  /** A obra tem sinopse canônica? Fallback quando `readiness` não é passado. */
  hasCanonicalSynopsis: boolean
  /** Prontidão do gerador (motor de orquestração → UI). Quando presente, dita o
   *  bloqueio e o selo de inputs; senão cai no check antigo de `hasCanonicalSynopsis`. */
  readiness?: UiReadiness | null
  /** Previsão IA é feature do plano Pago. Controla só a aparência. */
  isPaid?: boolean
}

/** DD/MM/AAAA a partir do ISO (slice — evita mismatch de fuso/hidratação). */
function fmtDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const [y, m, d] = iso.slice(0, 10).split("-")
  return y && m && d ? `${d}/${m}/${y}` : null
}

/**
 * Interesse na Obra abaixo da sinopse: a sugestão da IA PAREADA com o valor manual
 * que ela vai sobrescrever. A previsão é uma sugestão separada — só aplicar copia o
 * valor pro campo manual (a única via que entra no pipeline de notas).
 *
 * ⚠️ O layout é pareado de propósito. A 1ª versão mostrava só a sugestão, e aplicar
 * sobrescrevia em silêncio o ♥ que mora na faixa de stats no TOPO da página — dava
 * pra baixar o próprio interesse de ♥♥♥ pra ♥♥ sem ver o que estava sendo trocado.
 * Por isso o botão carrega a transição ("♥♥♥ → ♥♥") e o manual é editável aqui.
 *
 * ⚠️ **Cada fato aparece UMA vez.** A 2ª versão dizia "desatualizado" em três lugares
 * (chip no topo, faixa âmbar com a data, e a data de novo no rodapé) e tinha dois
 * caminhos pra mesma ação (o botão "Aplicar" e a seta entre os cards, que era só
 * decoração). Hoje: a seta É o botão de aplicar, "Prever de novo" ocupa o topo (onde
 * ficava o chip) e o estado da previsão vive só no rodapé + no tom do botão.
 *
 * ⚠️ Cor: a previsão é LARANJA (`variant="pred"`, mesma do /ranking) e o manual é
 * ROSA. Antes a sugestão usava o rosa do manual — duas coisas diferentes, uma cor só.
 */
export function SynopsisQualitySuggestion({
  workId,
  manualValue,
  manualFromPrediction = false,
  canEditManual = false,
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

  // Prontidão do motor de orquestração (quando passada). Dita bloqueio e selo; sem
  // ela, mantém o check antigo de sinopse canônica.
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

  const stale = Boolean(prediction?.stale)
  const predictedOn = fmtDate(prediction?.predictedAt)

  // O botão herda o aviso: âmbar quando a previsão envelheceu. O texto do porquê fica
  // no `title` e no rodapé — uma faixa inteira só pra repetir a data era o maior bloco
  // do componente. Aplicar uma previsão velha grava no pipeline de notas um número que
  // a IA já não sustenta, então aqui ele passa na frente do aplicar.
  const predictTitle = blocked
    ? blockTitle
    : stale
      ? `Previsão${predictedOn ? ` de ${predictedOn}` : ""} desatualizada: a sinopse ou seu perfil de gosto mudaram desde então.`
      : undefined

  const applyLabel = alreadyApplied
    ? "Aplicado — a sugestão já é o seu interesse"
    : prediction == null
      ? "Sem previsão para aplicar"
      : manualValue
        ? `Aplicar ao meu interesse (${manualValue} → ${prediction.predictedQuality})`
        : `Aplicar ao meu interesse (${prediction.predictedQuality})`

  return (
    <div className="mt-4 space-y-3 border-t border-border/40 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <Heart className="h-3.5 w-3.5" /> Interesse na Obra
        </span>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            "h-7 gap-1.5 text-xs",
            stale && !blocked && "border-amber-400/40 text-amber-600 hover:text-amber-600 dark:text-amber-300",
          )}
          onClick={() => void runPredict()}
          disabled={predicting || blocked}
          title={predictTitle}
        >
          {predicting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {predicting ? "Estimando…" : prediction ? "Prever de novo" : "Prever interesse"}
        </Button>
      </div>

      {/* Veredito pareado. A seta do meio É o botão de aplicar: ela já apontava da
          sugestão pro seu ♥, então o botão separado só repetia o gesto. */}
      <div className="grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3 w-3" /> A IA sugere
          </span>
          {prediction ? (
            <>
              {/* `render="icon"`: os mesmos corações do picker à direita. Em glifo eles
                  saíam visivelmente menores que os editáveis, no mesmo bloco. */}
              <span className="flex flex-wrap items-center gap-2">
                <QualityHearts quality={prediction.predictedQuality} variant="pred" render="icon" />
                <span className="text-sm font-semibold text-foreground">
                  {SYNOPSIS_QUALITY_LABELS[prediction.predictedQuality]}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                {prediction.confidence != null && <span>confiança {Math.round(prediction.confidence * 100)}%</span>}
                {gate && <InputConfidenceSeal readiness={gate} />}
              </span>
            </>
          ) : (
            <>
              <span className="text-sm text-muted-foreground">
                {blocked ? "precisa da sinopse consolidada" : "ainda não estimado"}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {blocked
                  ? (blockTitle ?? "Gere a sinopse consolidada para habilitar.")
                  : "Estima o quanto esta sinopse combina com seu perfil de gosto."}
              </span>
            </>
          )}
        </div>

        <div className="flex flex-col items-center justify-center gap-1">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                {/* span por fora: botão desabilitado não dispara hover, e o tooltip é
                    quem explica por que ele está apagado. */}
                <span className="inline-flex">
                  <button
                    type="button"
                    onClick={runApply}
                    disabled={applying || alreadyApplied || prediction == null}
                    aria-label={applyLabel}
                    className={cn(
                      "grid size-9 place-items-center rounded-full border transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      alreadyApplied
                        ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                        : prediction == null || applying
                          ? "border-border/60 text-muted-foreground opacity-50"
                          : "border-border bg-background text-foreground hover:border-primary hover:bg-primary/10 hover:text-primary",
                    )}
                  >
                    {applying ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : alreadyApplied ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <ArrowRight className="h-4 w-4 rotate-90 sm:rotate-0" />
                    )}
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[15rem] text-center leading-snug">
                {applyLabel}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {/* Rótulo mínimo: sem ele a seta lê como enfeite, e aplicar deixa de ter porta. */}
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {alreadyApplied ? "aplicado" : "aplicar"}
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-1 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            <Heart className="h-3 w-3" /> Seu interesse
            {manualValue && manualFromPrediction && <InterestAppliedMark size={11} />}
          </span>
          {canEditManual ? (
            <>
              {/* `subtleClear`: o ✕ permanente ao lado dos ♥ vira ruído — mesma decisão
                  da faixa de stats. */}
              <SynopsisQualityPicker workId={workId} value={manualValue} subtleClear />
              <span className="text-[11px] text-muted-foreground">
                {manualValue
                  ? `${SYNOPSIS_QUALITY_LABELS[manualValue]} — clique nos ♥ pra mudar`
                  : "clique nos ♥ pra definir"}
              </span>
            </>
          ) : manualValue ? (
            <>
              <span className="flex flex-wrap items-center gap-2">
                <QualityHearts quality={manualValue} render="icon" />
                <span className="text-sm font-semibold text-foreground">
                  {SYNOPSIS_QUALITY_LABELS[manualValue]}
                </span>
              </span>
              <span className="text-[11px] text-muted-foreground">entre pra editar</span>
            </>
          ) : (
            <>
              <QualityHearts quality="" render="icon" />
              <span className="text-[11px] text-muted-foreground">você ainda não definiu</span>
            </>
          )}
        </div>
      </div>

      {prediction?.justification && (
        // Fechada por padrão: o veredito precisa ler em um segundo, e o parágrafo
        // competia com a sinopse — que é o conteúdo principal deste card.
        <details className="group border-t border-border/40 pt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-foreground/80 outline-none hover:text-foreground focus-visible:underline [&::-webkit-details-marker]:hidden">
            <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
            Por que {SYNOPSIS_QUALITY_LABELS[prediction.predictedQuality]}?
          </summary>
          <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{prediction.justification}</p>
        </details>
      )}

      {prediction && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
          {predictedOn && (
            <span className={cn(stale && "text-amber-600 dark:text-amber-300")}>
              Prevista em {predictedOn}
              {stale && " — desatualizada"}
            </span>
          )}
          {predictedOn && prediction.modelName && <span aria-hidden>·</span>}
          {prediction.modelName && <span>{prediction.modelName}</span>}
          {(predictedOn || prediction.modelName) && <span aria-hidden>·</span>}
          <span>Só o seu ♥ entra no cálculo das notas</span>
        </p>
      )}
    </div>
  )
}

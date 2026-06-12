"use client"

import { useState } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { Loader2, Pencil, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { triggerAiEvaluation } from "@/server/actions/ai"
import {
  getEvaluationInputs,
  saveManualReviews,
  updatePrimarySynopsis,
} from "@/server/actions/manual-reviews"
import { AiEvaluationReviewForm } from "@/components/ai-evaluation/ai-evaluation-review-form"
import { AiEvaluationCompare } from "@/components/ai-evaluation/ai-evaluation-compare"
import type { CompareEval } from "@/components/ai-evaluation/ai-evaluation-compare"
import {
  ReviewDraftsField,
  draftsToManualReviewInput,
  manualReviewsToDrafts,
} from "@/components/titles/review-drafts-field"
import type { ReviewDraft } from "@/components/titles/review-drafts-field"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { NO_REVIEWS_REASON_LABEL } from "@/lib/ai-evaluation/no-reviews"
import { SHOW_HAIKU_AB } from "@/lib/ai-evaluation/ab-config"
import type { NoReviewsReason } from "@/lib/ai-evaluation/no-reviews"
import type { AiEvaluation } from "@/types/domain"

interface AiEvaluationButtonProps {
  workId: string
  workTitle: string
  hasCriteriaScores: boolean
  coverUrl?: string | null
  /** Variante visual. "cta" (default) = botão grande dentro da aba; "compact" = botão pequeno. */
  variant?: "cta" | "compact"
  /**
   * Última avaliação completada da obra (tipicamente Sonnet). Quando presente,
   * habilita o botão "Comparar com Haiku 4.5": roda o Haiku e mostra lado a lado
   * contra esta, sem refazer o modelo atual.
   */
  latestEvaluation?: CompareEval | null
}

export function AiEvaluationButton({
  workId,
  workTitle,
  hasCriteriaScores,
  coverUrl,
  variant = "cta",
  latestEvaluation,
}: AiEvaluationButtonProps) {
  const refresh = useRefresh()
  const [evaluating, setEvaluating] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [evaluation, setEvaluation] = useState<AiEvaluation | null>(null)
  const [currentScores, setCurrentScores] = useState<Record<string, number>>({})
  const [noReviewConfirm, setNoReviewConfirm] = useState<NoReviewsReason | null | "none">(null)
  // Comparação Sonnet (existente) vs. Haiku (recém-rodado).
  const [compareData, setCompareData] = useState<{ a: CompareEval; b: AiEvaluation } | null>(null)
  // Editor de entradas (sinopse + reviews manuais) antes de rodar a IA.
  const [inputsOpen, setInputsOpen] = useState(false)
  const [inputsLoading, setInputsLoading] = useState(false)
  const [savingInputs, setSavingInputs] = useState(false)
  const [synopsisDraft, setSynopsisDraft] = useState("")
  const [reviewDrafts, setReviewDrafts] = useState<ReviewDraft[]>([])

  const openInputsEditor = async () => {
    setInputsOpen(true)
    setInputsLoading(true)
    const inputs = await getEvaluationInputs(workId)
    setSynopsisDraft(inputs.synopsis)
    setReviewDrafts(manualReviewsToDrafts(inputs.reviews))
    setInputsLoading(false)
  }

  // Persiste sinopse primária + reviews manuais. Retorna false em erro.
  const persistInputs = async (): Promise<boolean> => {
    const [synRes, revRes] = await Promise.all([
      updatePrimarySynopsis(workId, synopsisDraft),
      saveManualReviews(workId, draftsToManualReviewInput(reviewDrafts)),
    ])
    if (synRes.error) {
      toast.error(`Falha ao salvar sinopse: ${synRes.error}`)
      return false
    }
    if (revRes.error) {
      toast.error(`Falha ao salvar reviews: ${revRes.error}`)
      return false
    }
    return true
  }

  const handleSaveInputs = async () => {
    setSavingInputs(true)
    const ok = await persistInputs()
    setSavingInputs(false)
    if (ok) {
      toast.success("Entradas salvas")
      setInputsOpen(false)
      refresh()
    }
  }

  const handleSaveInputsAndEvaluate = async () => {
    setSavingInputs(true)
    const ok = await persistInputs()
    setSavingInputs(false)
    if (!ok) return
    setInputsOpen(false)
    await runEvaluation()
  }

  const runEvaluation = async (opts?: { model?: "sonnet" | "opus" | "haiku"; proceedWithoutReviews?: boolean }) => {
    setEvaluating(true)
    const result = await triggerAiEvaluation(workId, opts)
    setEvaluating(false)

    // Gate: sem reviews externas, confirma antes de chamar o LLM.
    if ("needsReviewConfirmation" in result && result.needsReviewConfirmation) {
      setNoReviewConfirm(result.noReviewsReason ?? "none")
      return false
    }

    if (("error" in result && result.error) || !("data" in result) || !result.data?.evaluation) {
      toast.error(`Erro na avaliação IA: ${("error" in result && result.error) || "resposta vazia"}`)
      return false
    }

    setEvaluation(result.data.evaluation)
    setCurrentScores(result.data.currentScores ?? {})
    setReviewOpen(true)
    const reviewsUsed = result.data.reviewsUsed ?? 0
    toast.success(
      reviewsUsed === 0
        ? "Avaliação IA gerada sem reviews externas."
        : `Avaliação IA gerada usando ${reviewsUsed} review${reviewsUsed === 1 ? "" : "s"} externa${reviewsUsed === 1 ? "" : "s"}.`
    )
    return true
  }

  const handleAiEvaluation = () => void runEvaluation()

  // Roda o Haiku e abre a comparação contra a avaliação existente (sem refazer
  // o modelo atual). `proceedWithoutReviews` porque a obra já foi avaliada.
  const runHaikuCompare = async () => {
    if (!latestEvaluation) return
    setEvaluating(true)
    const result = await triggerAiEvaluation(workId, { model: "haiku", proceedWithoutReviews: true })
    setEvaluating(false)
    if (("error" in result && result.error) || !("data" in result) || !result.data?.evaluation) {
      toast.error(`Erro na avaliação Haiku: ${("error" in result && result.error) || "resposta vazia"}`)
      return
    }
    setCurrentScores(result.data.currentScores ?? {})
    setCompareData({ a: latestEvaluation, b: result.data.evaluation })
  }

  const label = evaluating
    ? "Avaliando..."
    : hasCriteriaScores
    ? "Reavaliar com IA"
    : "Avaliar com IA"

  return (
    <>
      {variant === "cta" ? (
        <div className="flex flex-col gap-2 rounded-lg border bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {hasCriteriaScores ? "Atualizar avaliação IA" : "Gerar avaliação IA"}
            </p>
            <p className="text-xs text-muted-foreground">
              {hasCriteriaScores
                ? "Busca reviews externas e gera nova avaliação. Você revisa as notas antes de aplicar."
                : "Busca reviews externas e cria a avaliação inicial. Você revisa as notas antes de aplicar."}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button onClick={handleAiEvaluation} disabled={evaluating}>
              <Sparkles className="h-4 w-4" />
              {label}
            </Button>
            <Button
              variant="outline"
              onClick={() => void openInputsEditor()}
              disabled={evaluating}
              title="Edite a sinopse usada pela IA e adicione reviews suas antes de avaliar."
            >
              <Pencil className="h-4 w-4" />
              Editar entradas
            </Button>
            {SHOW_HAIKU_AB && latestEvaluation && (
              <Button
                variant="outline"
                onClick={() => void runHaikuCompare()}
                disabled={evaluating}
                title="Roda o Haiku 4.5 e compara lado a lado com a avaliação atual, sem refazer o modelo atual."
              >
                <Sparkles className="h-4 w-4" />
                Comparar com Haiku 4.5
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleAiEvaluation} disabled={evaluating}>
            <Sparkles className="h-4 w-4" />
            {label}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openInputsEditor()}
            disabled={evaluating}
            title="Edite a sinopse usada pela IA e adicione reviews suas antes de avaliar."
          >
            <Pencil className="h-4 w-4" />
            Editar entradas
          </Button>
          {SHOW_HAIKU_AB && latestEvaluation && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runHaikuCompare()}
              disabled={evaluating}
              title="Roda o Haiku 4.5 e compara lado a lado com a avaliação atual."
            >
              <Sparkles className="h-4 w-4" />
              Comparar com Haiku 4.5
            </Button>
          )}
        </div>
      )}

      <Dialog open={evaluating} onOpenChange={() => undefined}>
        <DialogContent className="max-w-sm" showCloseButton={false}>
          <DialogHeader className="items-center text-center">
            <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Loader2 className="h-7 w-7 animate-spin text-primary" />
            </div>
            <DialogTitle>{hasCriteriaScores ? "Reavaliando com IA" : "Avaliando com IA"}</DialogTitle>
            <DialogDescription>
              Buscando reviews externas e gerando {hasCriteriaScores ? "uma nova avaliação" : "a avaliação"}. Isso pode levar alguns segundos.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revisar avaliação IA</DialogTitle>
            <DialogDescription>
              Ajuste manualmente qualquer nota antes de aplicar na obra.
            </DialogDescription>
          </DialogHeader>
          {evaluation && (
            <AiEvaluationReviewForm
              evaluation={evaluation}
              workId={workId}
              workTitle={workTitle}
              coverUrl={coverUrl}
              currentScores={currentScores}
              onReevaluate={async (model) => {
                await runEvaluation({ model, proceedWithoutReviews: true })
              }}
              onSaved={() => {
                setReviewOpen(false)
                refresh()
              }}
              onCancel={() => setReviewOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Editor de entradas: sinopse usada pela IA + reviews manuais. */}
      <Dialog open={inputsOpen} onOpenChange={(open) => !open && !savingInputs && setInputsOpen(false)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar entradas da avaliação IA</DialogTitle>
            <DialogDescription>
              {`Ajuste a sinopse e adicione reviews suas sobre "${workTitle}". São salvas na obra e reusadas em toda reavaliação.`}
            </DialogDescription>
          </DialogHeader>

          {inputsLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando entradas…
            </div>
          ) : (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="ai-synopsis">Sinopse usada pela IA</Label>
                <Textarea
                  id="ai-synopsis"
                  value={synopsisDraft}
                  disabled={savingInputs}
                  onChange={(e) => setSynopsisDraft(e.target.value)}
                  placeholder="Sinopse da obra. Editar aqui define a sinopse primária (manual) — autoridade máxima no prompt."
                  className="min-h-[140px]"
                />
                <p className="text-xs text-muted-foreground">
                  Vira a sinopse primária da obra (mesma que aparece na página). Vazia = sem sinopse (a IA baixa a confidence).
                </p>
              </div>

              <div className="space-y-2">
                <Label>Reviews manuais</Label>
                <ReviewDraftsField value={reviewDrafts} onChange={setReviewDrafts} disabled={savingInputs} />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setInputsOpen(false)} disabled={savingInputs}>
              Cancelar
            </Button>
            <Button variant="outline" onClick={() => void handleSaveInputs()} disabled={savingInputs || inputsLoading}>
              {savingInputs ? "Salvando…" : "Salvar"}
            </Button>
            <Button onClick={() => void handleSaveInputsAndEvaluate()} disabled={savingInputs || inputsLoading}>
              <Sparkles className="h-4 w-4" />
              Salvar e avaliar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Comparação Sonnet (atual) vs. Haiku (recém-rodado). */}
      <Dialog open={compareData != null} onOpenChange={(open) => !open && setCompareData(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Comparar modelos</DialogTitle>
            <DialogDescription>
              {`"${workTitle}" — escolha qual avaliação usar.`}
            </DialogDescription>
          </DialogHeader>
          {compareData && (
            <AiEvaluationCompare
              a={compareData.a}
              b={compareData.b}
              onPick={(which) => {
                // "b" (Haiku) → carrega no form pra aceitar/editar.
                // "a" (atual) → mantém o que já existe; só fecha.
                if (which === "b") {
                  setEvaluation(compareData.b)
                  setReviewOpen(true)
                }
                setCompareData(null)
              }}
              onClose={() => setCompareData(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Gate: sem reviews externas, confirma antes de chamar o LLM. */}
      <ConfirmDialog
        open={noReviewConfirm != null}
        onOpenChange={(open) => !open && setNoReviewConfirm(null)}
        title="Sem reviews externas"
        description={`Não há reviews externas para "${workTitle}"${
          noReviewConfirm && noReviewConfirm !== "none"
            ? ` (${NO_REVIEWS_REASON_LABEL[noReviewConfirm]})`
            : ""
        }. A avaliação vai usar só sinopse, tags e gêneros. Avaliar mesmo assim?`}
        confirmText="Avaliar mesmo assim"
        cancelText="Cancelar"
        onConfirm={() => {
          setNoReviewConfirm(null)
          void runEvaluation({ proceedWithoutReviews: true })
        }}
      />
    </>
  )
}

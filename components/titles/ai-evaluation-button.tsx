"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { triggerAiEvaluation } from "@/server/actions/ai"
import { AiEvaluationReviewForm } from "@/components/ai-evaluation/ai-evaluation-review-form"
import { AiEvaluationCompare } from "@/components/ai-evaluation/ai-evaluation-compare"
import type { CompareEval } from "@/components/ai-evaluation/ai-evaluation-compare"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  const router = useRouter()
  const [evaluating, setEvaluating] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [evaluation, setEvaluation] = useState<AiEvaluation | null>(null)
  const [currentScores, setCurrentScores] = useState<Record<string, number>>({})
  const [noReviewConfirm, setNoReviewConfirm] = useState<NoReviewsReason | null | "none">(null)
  // Comparação Sonnet (existente) vs. Haiku (recém-rodado).
  const [compareData, setCompareData] = useState<{ a: CompareEval; b: AiEvaluation } | null>(null)

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
                router.refresh()
              }}
              onCancel={() => setReviewOpen(false)}
            />
          )}
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

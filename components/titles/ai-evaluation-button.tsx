"use client"

import { useState } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { useIsAdmin } from "@/components/layout/admin-context"
import { Loader2, Pencil, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { triggerAiEvaluation } from "@/server/actions/ai"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { previewCascade } from "@/lib/cost-preview/catalog"
import {
  getEvaluationInputs,
  updatePrimarySynopsis,
} from "@/server/actions/manual-reviews"
import { AiEvaluationReviewForm } from "@/components/ai-evaluation/ai-evaluation-review-form"
import {
  clearPendingAiReview,
  setPendingAiReview,
  usePendingAiReview,
} from "@/lib/ai-evaluation/pending-review-store"
import type { CurrentEvaluationMeta } from "@/components/ai-evaluation/ai-evaluation-review-form"
import { AiEvaluationCompare } from "@/components/ai-evaluation/ai-evaluation-compare"
import type { CompareEval } from "@/components/ai-evaluation/ai-evaluation-compare"
import { ExternalManualReviewsSection } from "@/components/titles/external-manual-reviews-section"
import type { ExternalManualReviewDisplayRow } from "@/server/queries/external-manual-reviews"
import { Button } from "@/components/ui/button"
import { SaveButton } from "@/components/ui/save-button"
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
  /** Gate local aberto? Habilita o editor de reviews EXTERNAS manuais no diálogo. */
  externalEditorEnabled?: boolean
  externalReviews?: ExternalManualReviewDisplayRow[]
}

export function AiEvaluationButton({
  workId,
  workTitle,
  hasCriteriaScores,
  coverUrl,
  variant = "cta",
  latestEvaluation,
  externalEditorEnabled = false,
  externalReviews = [],
}: AiEvaluationButtonProps) {
  // Stopgap multi-user: avaliação IA é CURADORIA do catálogo (admin/operador) →
  // some pro usuário logado. O bloqueio real é server-side.
  const isAdmin = useIsAdmin()
  const refresh = useRefresh()
  const confirmCost = useCostConfirm()
  // Lê o store global pra refletir, no próprio botão, uma avaliação desta obra
  // rodando em segundo plano (sobrevive à navegação — se voltar à página, ainda
  // mostra "Avaliando…").
  const evalTaskId = `ai-eval:${workId}`
  const tasks = useAppTasks()
  const myEvalRunning = tasks.some((t) => t.id === evalTaskId && t.status === "running")
  const [evaluating, setEvaluating] = useState(false)
  // 🔴 O resultado que espera revisão vive num store de MÓDULO, não em estado de
  // componente. Este botão mora dentro de `<TabsContent value="ai">`, e o Radix
  // DESMONTA a aba inativa — trocar de aba (ou navegar) durante os ~17,5s da
  // avaliação destruía o resultado, e o `setEvaluation` do `onDone` virava no-op
  // silencioso: a avaliação ficava em `review_pending` e o popup nunca abria.
  // A presença no store É o "aberto": um `reviewOpen` local traria o bug de volta
  // pela outra metade.
  const pendingReview = usePendingAiReview(workId)
  // Guarda o fechamento acidental do popup de revisão (clique fora / Esc / X): o
  // resultado da IA ainda não foi aplicado, então dispara uma confirmação antes de descartar.
  const [confirmDiscardReview, setConfirmDiscardReview] = useState(false)
  const [noReviewConfirm, setNoReviewConfirm] = useState<NoReviewsReason | null | "none">(null)
  // Comparação Sonnet (existente) vs. Haiku (recém-rodado).
  // `aFull` só existe quando a coluna A é uma avaliação COMPLETA (tem id) e
  // portanto pode voltar pro formulário editável. No caminho do Haiku a coluna A
  // é a `latestEvaluation` — forma frouxa, sem id, já aplicada na obra: ali
  // "usar A" é literalmente não fazer nada.
  const [compareData, setCompareData] = useState<{
    a: CompareEval
    aFull: AiEvaluation | null
    b: AiEvaluation
    // Viajam junto com a comparação porque é a escolha dela que vira revisão —
    // soltos em estado próprio, morriam na mesma desmontagem do resultado.
    currentScores: Record<string, number>
    currentEvaluation: CurrentEvaluationMeta | null
  } | null>(null)
  // Editor de entradas (sinopse + reviews EXTERNAS manuais) antes de rodar a IA. As reviews
  // externas são persistidas pelo próprio ExternalManualReviewsSection (imediato); aqui só a
  // sinopse é draft/salva no "Avaliar". A avaliação lê as reviews externas do banco.
  const [inputsOpen, setInputsOpen] = useState(false)
  const [inputsLoading, setInputsLoading] = useState(false)
  const [savingInputs, setSavingInputs] = useState(false)
  const [synopsisDraft, setSynopsisDraft] = useState("")
  // Sinopse como veio do banco, pra saber se o "Salvar" (só sinopse) tem o que gravar.
  const [synopsisLoaded, setSynopsisLoaded] = useState("")
  const synopsisDirty = synopsisDraft !== synopsisLoaded

  const openInputsEditor = async () => {
    setInputsOpen(true)
    setInputsLoading(true)
    const inputs = await getEvaluationInputs(workId)
    setSynopsisDraft(inputs.synopsis)
    setSynopsisLoaded(inputs.synopsis)
    setInputsLoading(false)
  }

  // Persiste a sinopse primária. Retorna false em erro. (Reviews externas já são persistidas
  // pelo editor inline, independentemente.)
  const persistInputs = async (): Promise<boolean> => {
    const synRes = await updatePrimarySynopsis(workId, synopsisDraft)
    if (synRes.error) {
      toast.error(`Falha ao salvar sinopse: ${synRes.error}`)
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
    if (!(await confirmEvalCost())) return
    setSavingInputs(true)
    const ok = await persistInputs()
    setSavingInputs(false)
    if (!ok) return
    setInputsOpen(false)
    dispatchEvaluation()
  }

  // Dispara a avaliação em SEGUNDO PLANO via store global. Não bloqueia a UI:
  // o indicador da sidebar mostra "Avaliando…", você pode navegar, e o resultado
  // (durável — vai pra fila review_pending) te encontra por toast/badge. Se você
  // ainda estiver nesta página quando terminar, o review abre inline.
  const dispatchEvaluation = (opts?: { model?: "sonnet" | "opus" | "haiku"; proceedWithoutReviews?: boolean }) => {
    runTask({
      id: evalTaskId,
      kind: "ai-eval",
      label: `Avaliando: ${workTitle}`,
      href: "/curation/works",
      run: () => triggerAiEvaluation(workId, opts),
      successToast: (result) => {
        if ("data" in result && result.data?.evaluation) {
          const reviewsUsed = result.data.reviewsUsed ?? 0
          return {
            message:
              reviewsUsed === 0
                ? `Avaliação de "${workTitle}" pronta (sem reviews externas)`
                : `Avaliação de "${workTitle}" pronta (${reviewsUsed} review${reviewsUsed === 1 ? "" : "s"})`,
            action: { label: "Revisar", href: "/curation/works" },
          }
        }
        return null // gate ("sem reviews") ou erro → sem toast de sucesso
      },
      onDone: (result) => {
        // Gate: sem reviews externas, confirma antes de chamar o LLM.
        if ("needsReviewConfirmation" in result && result.needsReviewConfirmation) {
          setNoReviewConfirm(result.noReviewsReason ?? "none")
          return
        }
        if (("error" in result && result.error) || !("data" in result) || !result.data?.evaluation) {
          toast.error(`Erro na avaliação IA: ${("error" in result && result.error) || "resposta vazia"}`)
          return
        }
        // Vai pro store de módulo: abre agora se a aba estiver montada, e espera
        // por ela se não estiver (navegação/troca de aba não perdem mais o resultado).
        setPendingAiReview(workId, {
          evaluation: result.data.evaluation,
          currentScores: result.data.currentScores ?? {},
          currentEvaluation: result.data.currentEvaluation ?? null,
        })
      },
    })
  }

  // Custo real de "✨ Avaliar": a avaliação (Sonnet) + resumo (Haiku) + digest
  // (Sonnet) embutidos em triggerAiEvaluation quando o pool de reviews muda.
  const confirmEvalCost = async (): Promise<boolean> => {
    const cascade = previewCascade([
      { action: "ai_evaluation", label: "Avaliação dos 9 critérios" },
      { action: "review_summary", label: "Resumo de reviews" },
      { action: "review_digest", label: "Digest de reviews" },
    ])
    return confirmCost({
      estimate: {
        likelyUsd: cascade.likelyUsd,
        upperBoundUsd: cascade.upperBoundUsd,
        etaSeconds: cascade.etaSeconds,
        background: true,
        scale: 1,
      },
      steps: cascade.steps,
      title: hasCriteriaScores ? `Reavaliar "${workTitle}" com IA?` : `Avaliar "${workTitle}" com IA?`,
      description:
        "Roda a avaliação dos 9 critérios e, se as reviews externas mudarem, gera resumo + digest.",
      confirmLabel: hasCriteriaScores ? "Reavaliar" : "Avaliar",
    })
  }

  const handleAiEvaluation = async () => {
    if (!(await confirmEvalCost())) return
    dispatchEvaluation()
  }

  /**
   * Roda `model` e abre a comparação lado a lado contra `baseline` (sem refazer o
   * modelo já rodado). `proceedWithoutReviews` porque a obra já foi avaliada.
   *
   * Duas entradas: o botão "Comparar com Haiku" (baseline = última avaliação
   * salva) e o "Reavaliar com Opus" de dentro da revisão (baseline = a avaliação
   * aberta no formulário, que pode ainda não estar salva).
   */
  const runModelCompare = async (
    model: "sonnet" | "opus" | "haiku",
    baseline: CompareEval | null,
    baselineFull: AiEvaluation | null = null,
  ) => {
    if (!baseline) return
    setEvaluating(true)
    const result = await triggerAiEvaluation(workId, { model, proceedWithoutReviews: true })
    setEvaluating(false)
    if (("error" in result && result.error) || !("data" in result) || !result.data?.evaluation) {
      toast.error(`Erro na avaliação: ${("error" in result && result.error) || "resposta vazia"}`)
      return
    }
    setCompareData({
      a: baseline,
      aFull: baselineFull,
      b: result.data.evaluation,
      currentScores: result.data.currentScores ?? {},
      currentEvaluation: result.data.currentEvaluation ?? null,
    })
  }

  const runHaikuCompare = () => runModelCompare("haiku", latestEvaluation ?? null)

  // `evaluating` (modal bloqueante) cobre só os fluxos interativos (comparar
  // Haiku / reavaliar dentro do review). `myEvalRunning` é a avaliação principal
  // em segundo plano. Ambos desabilitam os botões; só `evaluating` abre o modal.
  const busy = evaluating || myEvalRunning
  const label = busy
    ? "Avaliando..."
    : hasCriteriaScores
    ? "Reavaliar com IA"
    : "Avaliar com IA"

  if (!isAdmin) return null

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
            <Button onClick={() => void handleAiEvaluation()} disabled={busy}>
              <Sparkles className="h-4 w-4" />
              {label}
            </Button>
            <Button
              variant="outline"
              onClick={() => void openInputsEditor()}
              disabled={busy}
              title="Edite a sinopse usada pela IA e adicione reviews suas antes de avaliar."
            >
              <Pencil className="h-4 w-4" />
              Editar entradas
            </Button>
            {SHOW_HAIKU_AB && latestEvaluation && (
              <Button
                variant="outline"
                onClick={() => void runHaikuCompare()}
                disabled={busy}
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
          <Button variant="outline" size="sm" onClick={() => void handleAiEvaluation()} disabled={busy}>
            <Sparkles className="h-4 w-4" />
            {label}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openInputsEditor()}
            disabled={busy}
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
              disabled={busy}
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

      <Dialog
        // Some enquanto o comparador está aberto — senão o de comparar empilha por
        // cima do de revisar, e fechar um revela o outro por baixo. Mesmo padrão
        // do painel da fila.
        open={pendingReview != null && compareData == null}
        onOpenChange={(open) => {
          // Fechar via X/Esc/clique-fora NÃO fecha direto: confirma antes de perder o
          // resultado. Salvar chama setReviewOpen(false) direto e passa por fora daqui.
          // O comparador fecha este diálogo por `compareData`, não por aqui.
          if (!open && compareData == null) setConfirmDiscardReview(true)
        }}
      >
        {/* 🔴 `sm:` obrigatório: o `DialogContent` traz `sm:max-w-lg`, e a variante
            responsiva VENCE a classe base acima de 640px — com `max-w-4xl` (sem
            `sm:`) este diálogo ficava em **512px** numa tela de 1512, medido no
            browser em 2026-08-18: justificativa de 500 caracteres em **6 linhas**,
            1,5 critério por tela. Com o teto abaixo: **1024px** e **2 linhas**.
            O `min()` em vez de `sm:max-w-5xl` seco é MARGEM: o 5xl também vence o
            `max-w-[calc(100%-2rem)]` da base, então entre 640 e 1088px o diálogo
            encostava nas duas bordas (medido: janela de 900px → diálogo de 900px;
            com o clamp, 836). */}
        <DialogContent className="max-h-[90vh] sm:max-w-[min(64rem,calc(100vw-4rem))] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Revisar avaliação IA</DialogTitle>
            <DialogDescription>
              Revise as notas da IA e escolha entre a nota atual e a sugerida antes de aplicar na obra.
            </DialogDescription>
          </DialogHeader>
          {pendingReview && (
            <AiEvaluationReviewForm
              evaluation={pendingReview.evaluation}
              workId={workId}
              workTitle={workTitle}
              coverUrl={coverUrl}
              currentScores={pendingReview.currentScores}
              currentEvaluation={pendingReview.currentEvaluation}
              onReevaluate={async (model) => {
                // Compara em vez de SUBSTITUIR. Antes o resultado do modelo novo
                // sobrescrevia o formulário e a avaliação anterior sumia da tela
                // sem chance de comparar — o painel da fila já fazia certo, só
                // esta porta de entrada é que trocava em silêncio.
                await runModelCompare(model, pendingReview.evaluation, pendingReview.evaluation)
              }}
              onSaved={() => {
                clearPendingAiReview(workId)
                refresh()
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmDiscardReview}
        onOpenChange={setConfirmDiscardReview}
        title="Descartar a avaliação?"
        description="Você perderá o resultado da IA que ainda não foi aplicado. Ele continua pendente e pode ser revisado depois."
        confirmText="Descartar"
        cancelText="Continuar revisando"
        onConfirm={() => clearPendingAiReview(workId)}
      />

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

              {externalEditorEnabled ? (
                <ExternalManualReviewsSection workId={workId} reviews={externalReviews} />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Reviews externas manuais só podem ser adicionadas em ambiente local (gate).
                </p>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setInputsOpen(false)} disabled={savingInputs}>
              Cancelar
            </Button>
            {/* "Salvar" só grava a sinopse → gateado pela mudança dela. "Salvar e
                avaliar" roda a IA de qualquer jeito, então não é gateado. */}
            <SaveButton
              variant="outline"
              onClick={() => void handleSaveInputs()}
              disabled={savingInputs || inputsLoading || !synopsisDirty}
              disabledReason={
                !inputsLoading && !synopsisDirty ? "Nenhuma alteração para salvar" : undefined
              }
            >
              {savingInputs ? "Salvando…" : "Salvar"}
            </SaveButton>
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
                // A escolhida volta pro formulário editável. A coluna A só tem
                // pra onde voltar quando é uma avaliação completa (`aFull`) —
                // no A/B do Haiku ela é a nota JÁ aplicada na obra, então
                // escolhê-la é mesmo só fechar.
                const chosen = which === "b" ? compareData.b : compareData.aFull
                if (chosen) {
                  setPendingAiReview(workId, {
                    evaluation: chosen,
                    currentScores: compareData.currentScores,
                    currentEvaluation: compareData.currentEvaluation,
                  })
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
          dispatchEvaluation({ proceedWithoutReviews: true })
        }}
      />
    </>
  )
}

"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ChevronRight, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { submitAiReview } from "@/server/actions/ai"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { Button } from "@/components/ui/button"
import { SaveButton } from "@/components/ui/save-button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Label } from "@/components/ui/label"
import { cn, titleToSlug } from "@/lib/utils"
import {
  NO_REVIEWS_REASON_LABEL,
  NO_REVIEWS_REASON_CTA,
  isNoReviewsReason,
} from "@/lib/ai-evaluation/no-reviews"
import type { NoReviewsReason } from "@/lib/ai-evaluation/no-reviews"
import { SHOW_HAIKU_AB } from "@/lib/ai-evaluation/ab-config"
import { describeCrossRuler, formatRuler } from "@/lib/ai-evaluation/confidence-ruler"
import type { AiEvaluation } from "@/types/domain"

// Limiar fixo de fricção no "Salvar" e no botão "Reavaliar com Opus".
// Desacoplado do `formula_config.low_confidence_threshold` (que controla o
// filtro da fila): aqui o objetivo é só pedir confirmação quando há risco real,
// alinhado com a faixa amarela/vermelha dos badges (≥75% = verde, sem fricção).
const CONFIRM_THRESHOLD = 0.7

// O texto anterior dizia o CONTRÁRIO do que os dados mostram: afirmava que a
// confiança reflete "a consistência da evidência, NÃO a quantidade de reviews".
// Medido em 2026-07-24 sobre 2.178 avaliações, a relação com a QUANTIDADE é
// monotônica (0 reviews → 0,651 · 1-5 → 0,751 · 6-15 → 0,792 · 16-30 → 0,802 ·
// 31-60 → 0,812 · 61+ → 0,839; rho 0,44 com reviews substantivas), e a relação
// com acerto é nula (rho −0,078 com a correção humana — teste sem poder, porque
// só 0,1–4% dos critérios são editados). Ver lib/ai-evaluation/confidence-ruler.ts.
const CONFIDENCE_TOOLTIP =
  "Confiança declarada pela IA nesta avaliação (0–100%). Medido no nosso corpus: acompanha o VOLUME DE EVIDÊNCIA que chegou ao prompt (sem reviews ≈ 65%; com 61+ reviews ≈ 84%) — não mede se a nota está certa. Não é comparável entre modelos: cada um tem um teto próprio."

type ReevalModel = "sonnet" | "opus" | "haiku"

/** Confiança + justificativas da avaliação que gerou as notas ATUAIS (a anterior).
 *  Vem de `triggerAiEvaluation`. Null quando nenhuma nota atual veio de IA. */
export interface CurrentEvaluationMeta {
  confidence: number | null
  /** Procedência da confiança "Atual". Sem ela a tela compara réguas diferentes
   *  em silêncio — ver `lib/ai-evaluation/confidence-ruler.ts`. */
  modelName: string | null
  promptVersion: string | null
  evaluatedAt: string | null
  justifications: Record<string, string>
}

interface AiEvaluationReviewFormProps {
  evaluation: AiEvaluation
  workId: string
  workTitle: string
  coverUrl?: string | null
  currentScores?: Record<string, number>
  /** Confiança + justificativas da avaliação anterior (respalda a coluna "Atual"). */
  currentEvaluation?: CurrentEvaluationMeta | null
  /** Quando fornecido, mostra botão de re-avaliar com modelo alternativo em caso de confiança baixa. */
  onReevaluate?: (model: ReevalModel) => Promise<void> | void
  onSaved: (acceptedScores: Record<string, number>) => void
}


function getNoReviewsReason(rawResponse: unknown): NoReviewsReason | null {
  if (typeof rawResponse !== "object" || rawResponse === null) return null
  const ctx = (rawResponse as Record<string, unknown>).evaluationContext
  if (typeof ctx !== "object" || ctx === null) return null
  const value = (ctx as Record<string, unknown>).noReviewsReason
  return isNoReviewsReason(value) ? value : null
}

type ReviewUsageState =
  | { kind: "unavailable" } // sem reviews externas para essa obra
  | { kind: "declined"; available: number }    // reviews disponíveis mas modelo não citou nenhuma
  | { kind: "used"; count: number; available: number }

/** Só a COR DO TEXTO da confiança — o fundo é do botão que a contém. Sem
 *  `border-<cor>`: `* { border-color }` em globals.css mata essas utilidades no TW v4. */
function confidenceTextClass(confidence: number): string {
  if (confidence >= 0.75) return "text-emerald-600 dark:text-emerald-400"
  if (confidence >= 0.5) return "text-amber-600 dark:text-amber-400"
  return "text-rose-600 dark:text-rose-400"
}

/** "2026-06-08" → "08/06". Só dia/mês: a coluna do botão é estreita e o ano só
 *  importa quando a avaliação é de outro ano — aí o rótulo cai pra dd/mm/aa. */
function formatShortDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    ...(sameYear ? {} : { year: "2-digit" }),
  })
}

function getReviewUsage(rawResponse: unknown): ReviewUsageState {
  if (typeof rawResponse !== "object" || rawResponse === null) {
    return { kind: "unavailable" }
  }

  const raw = rawResponse as Record<string, unknown>
  const audit = raw.reviewAudit
  if (typeof audit !== "object" || audit === null) {
    return { kind: "unavailable" }
  }

  const reviewAudit = audit as Record<string, unknown>
  const usedReviewIds = Array.isArray(reviewAudit.usedReviewIds) ? reviewAudit.usedReviewIds : []
  const expectedIds = Array.isArray(reviewAudit.expectedReviewIds) ? reviewAudit.expectedReviewIds : []
  // expectedReviewIds = todas as reviews enviadas pro prompt (R1..Rn).
  // Fallback pra contar via evaluationContext.sourcedReviews quando não tem.
  let available = expectedIds.length
  if (!available) {
    const ctx = (raw.evaluationContext ?? {}) as { sourcedReviews?: unknown[]; legacyReviews?: unknown[] }
    available =
      (Array.isArray(ctx.sourcedReviews) ? ctx.sourcedReviews.length : 0) +
      (Array.isArray(ctx.legacyReviews) ? ctx.legacyReviews.length : 0)
  }

  if (reviewAudit.required !== true) {
    return { kind: "unavailable" }
  }
  if (usedReviewIds.length === 0) {
    return { kind: "declined", available }
  }
  return { kind: "used", count: usedReviewIds.length, available }
}

interface EvaluationContextDebug {
  title?: string
  synopsis?: string | null
  synopsisIsManual?: boolean
  synopsisOmittedFromPrompt?: boolean
  genres?: string[]
  tagsGrouped?: Array<{ group: string | null; names: string[] }>
  externalContext?: string[]
  sourcedReviews?: Array<{
    id: string
    source: string
    sourceTitle: string
    matchScore: number
    text: string
    userRating?: number
  }>
  legacyReviews?: Array<{ id: string; text: string }>
  r19Detected?: boolean
}

function getEvaluationContext(rawResponse: unknown): EvaluationContextDebug | null {
  if (typeof rawResponse !== "object" || rawResponse === null) return null
  const ctx = (rawResponse as Record<string, unknown>).evaluationContext
  if (typeof ctx !== "object" || ctx === null) return null
  return ctx as EvaluationContextDebug
}

export function AiEvaluationReviewForm({
  evaluation,
  workId,
  workTitle,
  coverUrl,
  currentScores,
  currentEvaluation,
  onReevaluate,
  onSaved,
}: AiEvaluationReviewFormProps) {
  const initialScores = useMemo(
    () =>
      (evaluation.ai_evaluation_scores ?? []).map((s) => ({
        criterionSlug: s.criterion_slug,
        suggestedScore: s.suggested_score ?? 0,
        acceptedScore: s.suggested_score ?? 0,
        currentScore: currentScores?.[s.criterion_slug],
        // Justificativa sugerida (nova avaliação) e a atual (avaliação anterior),
        // pra alternar conforme o modo selecionado no critério.
        justification: s.justification,
        currentJustification: currentEvaluation?.justifications?.[s.criterion_slug] ?? null,
        wasEdited: false,
        mode: "suggested" as "current" | "suggested",
      })),
    [currentScores, currentEvaluation, evaluation.ai_evaluation_scores]
  )

  const [scores, setScores] = useState(initialScores)
  const [submitting, setSubmitting] = useState(false)
  const [showDebug, setShowDebug] = useState(false)
  const [confirmLowConfidenceOpen, setConfirmLowConfidenceOpen] = useState(false)
  const [reevaluatingModel, setReevaluatingModel] = useState<ReevalModel | null>(null)
  const [coverFailed, setCoverFailed] = useState(false)
  const reviewUsage = getReviewUsage(evaluation.raw_response)
  const debugContext = getEvaluationContext(evaluation.raw_response)
  const noReviewsReason = getNoReviewsReason(evaluation.raw_response)
  const isLowConfidence =
    evaluation.confidence != null && evaluation.confidence < CONFIRM_THRESHOLD
  const thresholdPct = Math.round(CONFIRM_THRESHOLD * 100)

  // Contagens pros chips do cabeçalho de "Dados usados na avaliação".
  const debugCounts = debugContext
    ? {
        genres: debugContext.genres?.length ?? 0,
        tags: (debugContext.tagsGrouped ?? []).reduce((acc, g) => acc + g.names.length, 0),
        reviews:
          (debugContext.sourcedReviews?.length ?? 0) + (debugContext.legacyReviews?.length ?? 0),
      }
    : null


  // Só dois modos: manter a nota ATUAL ou aceitar a SUGERIDA. Escolher a atual
  // (quando difere da sugerida) marca wasEdited → grava como `ai_edited`.
  const selectMode = (slug: string, mode: "current" | "suggested") => {
    setScores((prev) =>
      prev.map((s) => {
        if (s.criterionSlug !== slug) return s
        const value =
          mode === "current" && s.currentScore !== undefined ? s.currentScore : s.suggestedScore
        return {
          ...s,
          mode,
          acceptedScore: value,
          wasEdited: value !== s.suggestedScore,
        }
      })
    )
  }

  const submitScores = async (scoresToSubmit: typeof scores) => {
    setSubmitting(true)
    try {
      const result = await submitAiReview({
        evaluationId: evaluation.id,
        workId,
        scores: scoresToSubmit.map((s) => ({
          criterionSlug: s.criterionSlug,
          acceptedScore: s.acceptedScore,
          wasEdited: s.wasEdited,
        })),
      })

      if (result.error) {
        toast.error(`Erro ao salvar revisão: ${result.error}`)
        return
      }

      toast.success("Notas salvas.")
      const scoreMap = Object.fromEntries(scoresToSubmit.map((s) => [s.criterionSlug, s.acceptedScore]))
      onSaved(scoreMap)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`Erro ao salvar revisão: ${message}`)
    } finally {
      setSubmitting(false)
    }
  }

  /** Posiciona os 9 critérios no conjunto escolhido. NÃO salva — quem salva é o
   *  botão "Salvar". Depois de aplicar, cada critério continua livre pra destoar. */
  const applyToAll = (mode: "current" | "suggested") => {
    setScores((prev) =>
      prev.map((s) => {
        const value =
          mode === "current" && s.currentScore !== undefined ? s.currentScore : s.suggestedScore
        return { ...s, mode, acceptedScore: value, wasEdited: value !== s.suggestedScore }
      })
    )
  }

  const doSubmit = () => submitScores(scores)

  const handleSubmit = () => {
    // A fricção de confiança baixa migrou do antigo "Aceitar" (que salvava na
    // hora) pro Salvar — só faz sentido perguntar quando o que vai gravar de
    // fato inclui alguma nota nova da IA.
    if (isLowConfidence && scores.some((s) => s.mode === "suggested")) {
      setConfirmLowConfidenceOpen(true)
      return
    }
    doSubmit()
  }

  // Quantos critérios diferem, e quantos a gravação vai de fato mudar.
  const diffCount = scores.filter(
    (s) => s.currentScore !== undefined && s.currentScore !== s.suggestedScore
  ).length
  const changing = scores.filter(
    (s) => s.currentScore === undefined || s.acceptedScore !== s.currentScore
  )
  // Média do |delta|, não do delta com sinal: com +2 e −2 a média assinada dá
  // 0.0 e a linha diria "6 mudam · Δ médio +0.0" — lendo isso você conclui que
  // quase nada muda enquanto 6 notas se mexem. Mesma escolha do comparador de
  // modelos (`meanAbsDelta` em ai-evaluation-compare.tsx).
  const avgAbsDelta =
    changing.length > 0
      ? changing.reduce(
          (acc, s) => acc + Math.abs(s.acceptedScore - (s.currentScore ?? s.acceptedScore)),
          0
        ) / changing.length
      : 0
  const hasCurrent = scores.some((s) => s.currentScore !== undefined)

  // Non-null só quando as duas confianças vieram de configs DIFERENTES — é o caso
  // de 75% das obras. Quando é a mesma régua a comparação é legítima e nada disto
  // aparece (senão o aviso viraria ruído permanente conforme o catálogo migra).
  const crossRuler = describeCrossRuler(
    currentEvaluation
      ? {
          confidence: currentEvaluation.confidence,
          modelName: currentEvaluation.modelName,
          promptVersion: currentEvaluation.promptVersion,
        }
      : null,
    { modelName: evaluation.model_name, promptVersion: evaluation.prompt_version },
  )
  const currentRulerLabel = formatRuler({
    modelName: currentEvaluation?.modelName ?? null,
    promptVersion: currentEvaluation?.promptVersion ?? null,
  })
  const suggestedRulerLabel = formatRuler({
    modelName: evaluation.model_name,
    promptVersion: evaluation.prompt_version,
  })
  const currentRulerDate = formatShortDate(currentEvaluation?.evaluatedAt ?? null)
  const suggestedRulerDate = formatShortDate(evaluation.created_at ?? null)

  const handleReevaluate = async (model: ReevalModel) => {
    if (!onReevaluate || reevaluatingModel) return
    setReevaluatingModel(model)
    try {
      await onReevaluate(model)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(`Erro ao reavaliar: ${message}`)
    } finally {
      setReevaluatingModel(null)
    }
  }

  const showOpusButton =
    !!onReevaluate && isLowConfidence && evaluation.model_name !== "claude-opus-4-7"

  // A/B de modelo: oculto por padrão (Haiku se mostrou pior na rubrica).
  // Reexibir via SHOW_HAIKU_AB em lib/ai-evaluation/ab-config.ts.
  const showHaikuButton =
    SHOW_HAIKU_AB && !!onReevaluate && evaluation.model_name !== "claude-haiku-4-5-20251001"

  return (
    <div className="space-y-4">
      <ConfirmDialog
        open={confirmLowConfidenceOpen}
        onOpenChange={setConfirmLowConfidenceOpen}
        title="Confiança baixa"
        description={`A IA declarou ${
          evaluation.confidence != null ? `${Math.round(evaluation.confidence * 100)}%` : "?"
        } de confiança, abaixo do limiar configurado (${thresholdPct}%). Quer salvar as notas sugeridas mesmo assim?`}
        confirmText="Salvar"
        cancelText="Voltar"
        onConfirm={() => doSubmit()}
      />
      {/* Salvar no alto à direita, FORA da grade da capa: dentro dela a coluna
          sobra pouco e ele empurraria o Atual/Sugerido pra outra linha. */}
      <div className="flex justify-end">
        {/* `changing` = critérios que a gravação de fato muda. Vazio só quando há
            notas atuais e o usuário mantém todas (o painel já avisa "salvar não
            muda nada"). Na primeira avaliação tudo conta como mudança → liberado. */}
        <SaveButton
          size="sm"
          onClick={handleSubmit}
          disabled={submitting || changing.length === 0}
          disabledReason={changing.length === 0 ? "Nenhuma alteração para salvar" : undefined}
        >
          {submitting ? "Salvando..." : "Salvar"}
        </SaveButton>
      </div>

      {/* Capa + aplicar-a-todos + resumo. A grade NÃO é mais condicionada ao
          `summary`: ela carrega o aplicar-a-todos, e uma avaliação sem resumo
          sumia com o controle inteiro. */}
      <div className="grid gap-3 rounded-md bg-muted/50 p-3 text-sm sm:grid-cols-[96px_1fr]">
        <div className="relative h-36 w-24 overflow-hidden rounded-md border bg-muted">
            {coverUrl && !coverFailed ? (
              <Image
                src={getCoverImageSrc(coverUrl)}
                alt={`Capa de ${workId}`}
                fill
                sizes="96px"
                unoptimized
                className="h-full w-full object-cover"
                onError={() => setCoverFailed(true)}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-muted-foreground">
                Sem capa
              </div>
            )}
          </div>
          <div className="min-w-0">
            {/* Aplicar a todos + confiança no MESMO controle: o selo "Atual 55%" e o
                botão "Atual" sempre falaram do mesmo conjunto de notas. Separados,
                ocupavam duas linhas dizendo a mesma coisa duas vezes. */}
            {/* PRIMEIRA avaliação da obra: não há "atual" pra escolher, então não há
                aplicar-a-todos — mas a confiança precisa aparecer assim mesmo. Ela
                mora dentro dos botões, e sem este ramo sumia da tela inteira. */}
            {!hasCurrent && evaluation.confidence != null && (
              <div className="mb-2">
                <span
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-semibold tabular-nums",
                    confidenceTextClass(evaluation.confidence)
                  )}
                  title={CONFIDENCE_TOOLTIP}
                >
                  Confiança {Math.round(evaluation.confidence * 100)}%
                </span>
              </div>
            )}

            {hasCurrent && scores.length > 0 && (
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="whitespace-nowrap text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Aplicar a todos
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => applyToAll("current")}
                    className="h-auto flex-col items-start gap-0.5 px-3 py-1.5"
                    aria-label="Aplicar a nota atual a todos os critérios"
                    title="Mantém as notas em vigor em todos os critérios."
                  >
                    <span className="text-xs font-semibold leading-none">Atual</span>
                    <span
                      className={cn(
                        "text-[10px] font-semibold leading-none tabular-nums",
                        // Régua diferente ⇒ NEUTRO de propósito. A escala
                        // verde/amarelo/vermelho dos dois lados era metade do
                        // convite a comparar: um "82% verde" ao lado de um "75%
                        // verde" lê como queda mesmo quando as escalas diferem.
                        currentEvaluation?.confidence == null || crossRuler
                          ? "font-medium text-muted-foreground"
                          : confidenceTextClass(currentEvaluation.confidence)
                      )}
                    >
                      {currentEvaluation?.confidence != null
                        ? `confiança ${Math.round(currentEvaluation.confidence * 100)}%`
                        : "sem avaliação IA"}
                    </span>
                    {(currentRulerLabel || currentRulerDate) && (
                      <span className="text-[9px] font-medium leading-none tabular-nums text-muted-foreground/80">
                        {[currentRulerLabel, currentRulerDate].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={submitting}
                    onClick={() => applyToAll("suggested")}
                    className="h-auto flex-col items-start gap-0.5 px-3 py-1.5"
                    aria-label="Aplicar a nota sugerida a todos os critérios"
                    title={CONFIDENCE_TOOLTIP}
                  >
                    <span className="text-xs font-semibold leading-none">Sugerido</span>
                    <span
                      className={cn(
                        "text-[10px] font-semibold leading-none tabular-nums",
                        evaluation.confidence == null
                          ? "font-medium text-muted-foreground"
                          : confidenceTextClass(evaluation.confidence)
                      )}
                    >
                      {evaluation.confidence != null
                        ? `confiança ${Math.round(evaluation.confidence * 100)}%`
                        : "confiança não declarada"}
                    </span>
                    {(suggestedRulerLabel || suggestedRulerDate) && (
                      <span className="text-[9px] font-medium leading-none tabular-nums text-muted-foreground/80">
                        {[suggestedRulerLabel, suggestedRulerDate].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </Button>
                </div>

                {crossRuler && (
                  <p className="mt-2 rounded-md bg-sky-50 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground dark:bg-sky-950/40">
                    <span className="font-semibold text-foreground">
                      Réguas diferentes — não compare os dois números.
                    </span>{" "}
                    {crossRuler.currentAboveCeiling && crossRuler.suggestedCeiling ? (
                      <>
                        A confiança atual (
                        {Math.round((currentEvaluation?.confidence ?? 0) * 100)}%) é{" "}
                        <span className="font-medium text-foreground">inalcançável</span> pro{" "}
                        {crossRuler.suggestedModelLabel ?? "modelo de hoje"}, que nunca passou de{" "}
                        {Math.round(crossRuler.suggestedCeiling.max * 100)}% em{" "}
                        {crossRuler.suggestedCeiling.n} avaliações. A queda é aritmética, não
                        um sinal de piora.
                      </>
                    ) : (
                      <>
                        As duas confianças vieram de configs diferentes
                        {crossRuler.currentLabel && crossRuler.suggestedLabel
                          ? ` (${crossRuler.currentLabel} → ${crossRuler.suggestedLabel})`
                          : ""}
                        , que têm tetos diferentes.
                        {crossRuler.suggestedCeiling
                          ? ` O ${crossRuler.suggestedModelLabel} nunca passou de ${Math.round(
                              crossRuler.suggestedCeiling.max * 100
                            )}% em ${crossRuler.suggestedCeiling.n} avaliações.`
                          : ""}
                      </>
                    )}{" "}
                    Confiança mede{" "}
                    <span className="font-medium text-foreground">
                      quanta evidência o modelo teve
                    </span>
                    , não se a nota está certa.
                  </p>
                )}
                <p className="mt-1.5 text-[11px] tabular-nums text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {diffCount} de {scores.length}
                  </span>{" "}
                  {diffCount === 1 ? "critério tem" : "critérios têm"} nota diferente.{" "}
                  {changing.length === 0 ? (
                    <>Você está mantendo todas as notas atuais — salvar não muda nada.</>
                  ) : (
                    <>
                      Salvando agora,{" "}
                      <span className="font-medium text-foreground">{changing.length}</span>{" "}
                      {changing.length === 1 ? "muda" : "mudam"} · variação média{" "}
                      <span className="font-medium text-foreground">
                        {avgAbsDelta.toFixed(1)}
                      </span>
                    </>
                  )}
                </p>
              </div>
            )}

            {evaluation.summary}
            {reviewUsage.kind === "unavailable" && noReviewsReason && (
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Motivo:</span>{" "}
                {NO_REVIEWS_REASON_LABEL[noReviewsReason]}.{" "}
                {NO_REVIEWS_REASON_CTA[noReviewsReason] && (
                  <Link
                    href={`/titles/${titleToSlug(workTitle)}#external-sources`}
                    className="font-medium text-primary underline-offset-2 hover:underline"
                  >
                    {NO_REVIEWS_REASON_CTA[noReviewsReason]}
                  </Link>
                )}
              </p>
            )}
            {(showOpusButton || showHaikuButton) && (
              <div className="mt-2 flex flex-wrap gap-2">
                {showOpusButton && (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!!reevaluatingModel || submitting}
                    onClick={() => void handleReevaluate("opus")}
                    title="Modelo alternativo. A Nota Prevista continua usando calibração do Sonnet."
                  >
                    {reevaluatingModel === "opus" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                    Reavaliar com Opus 4.7
                  </Button>
                )}
                {showHaikuButton && (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!!reevaluatingModel || submitting}
                    onClick={() => void handleReevaluate("haiku")}
                    title="A/B: modelo mais rápido e barato. A Nota Prevista continua usando calibração do Sonnet."
                  >
                    {reevaluatingModel === "haiku" ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                    Reavaliar com Haiku 4.5
                  </Button>
                )}
              </div>
            )}
          </div>
      </div>

      {debugContext && (
        <details
          open={showDebug}
          onToggle={(e) => setShowDebug((e.target as HTMLDetailsElement).open)}
          className="group overflow-hidden rounded-lg border border-border/70 border-l-2 border-l-sky-400/50 bg-muted/20 text-xs [&_summary::-webkit-details-marker]:hidden"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 hover:bg-muted/40">
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
            <span className="text-sm leading-none">📋</span>
            <span className="whitespace-nowrap text-[13px] font-medium text-foreground/90">
              Dados usados na avaliação
            </span>
            {debugCounts && (
              <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1">
                {debugCounts.genres > 0 && (
                  <span className="whitespace-nowrap rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {debugCounts.genres} gêneros
                  </span>
                )}
                {debugCounts.tags > 0 && (
                  <span className="whitespace-nowrap rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {debugCounts.tags} tags
                  </span>
                )}
                {debugCounts.reviews > 0 && (
                  <span className="whitespace-nowrap rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {debugCounts.reviews} reviews
                  </span>
                )}
              </span>
            )}
          </summary>
          <div className="space-y-3 border-t border-border/60 px-3 pb-3 pt-3 text-foreground">
            {debugContext.title && (
              <div>
                <p className="font-semibold">Título</p>
                <p className="text-muted-foreground">{debugContext.title}</p>
              </div>
            )}
            {debugContext.synopsis != null && (
              <div>
                <p className="font-semibold">
                  Sinopse{" "}
                  <span
                    className={
                      "ml-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium " +
                      (debugContext.synopsisIsManual
                        ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                        : "border-amber-300 bg-amber-50 text-amber-700")
                    }
                  >
                    {debugContext.synopsisIsManual ? "manual" : "auto/externa"}
                  </span>
                  {debugContext.synopsisOmittedFromPrompt && (
                    <span className="ml-2 text-[11px] font-normal text-amber-700">
                      (omitida do prompt — usando [C1]…[Cn])
                    </span>
                  )}
                </p>
                <p className="whitespace-pre-wrap text-muted-foreground">
                  {debugContext.synopsis || "(vazia)"}
                </p>
              </div>
            )}
            {debugContext.genres && debugContext.genres.length > 0 && (
              <div>
                <p className="font-semibold">Gêneros ({debugContext.genres.length})</p>
                <p className="text-muted-foreground">{debugContext.genres.join(", ")}</p>
              </div>
            )}
            {debugContext.tagsGrouped && debugContext.tagsGrouped.length > 0 && (
              <div>
                <p className="font-semibold">
                  Tags por grupo (
                  {debugContext.tagsGrouped.reduce((acc, g) => acc + g.names.length, 0)})
                </p>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {debugContext.tagsGrouped.map((g, i) => (
                    <li key={i}>
                      <span className="font-medium text-foreground">{g.group ?? "(sem grupo)"}:</span>{" "}
                      {g.names.join(", ")}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {debugContext.externalContext && debugContext.externalContext.length > 0 && (
              <div>
                <p className="font-semibold">
                  Contexto externo ({debugContext.externalContext.length})
                </p>
                <ul className="mt-1 space-y-2 text-muted-foreground">
                  {debugContext.externalContext.map((c, i) => (
                    <li key={i} className="whitespace-pre-wrap">
                      <span className="font-medium text-foreground">[C{i + 1}]</span> {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {debugContext.sourcedReviews && debugContext.sourcedReviews.length > 0 && (
              <div>
                <p className="font-semibold">
                  Reviews externas ({debugContext.sourcedReviews.length})
                </p>
                <ul className="mt-1 space-y-2 text-muted-foreground">
                  {debugContext.sourcedReviews.map((r) => (
                    <li key={r.id} className="whitespace-pre-wrap">
                      <span className="font-medium text-foreground">[{r.id}]</span>{" "}
                      <span className="text-[11px]">
                        ({r.source}, match {Math.round(r.matchScore * 100)}%
                        {r.userRating != null ? `, nota: ${r.userRating}/10` : ""}
                        , &ldquo;{r.sourceTitle}&rdquo;)
                      </span>
                      <br />
                      {r.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {debugContext.legacyReviews && debugContext.legacyReviews.length > 0 && (
              <div>
                <p className="font-semibold">
                  Reviews (legado) ({debugContext.legacyReviews.length})
                </p>
                <ul className="mt-1 space-y-2 text-muted-foreground">
                  {debugContext.legacyReviews.map((r) => (
                    <li key={r.id} className="whitespace-pre-wrap">
                      <span className="font-medium text-foreground">[{r.id}]</span> {r.text}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {debugContext.r19Detected && (
              <p className="text-amber-700">⚠️ Marcador R19 detectado nas evidências.</p>
            )}
          </div>
        </details>
      )}

      <div className="space-y-3">
        {scores.map((s) => {
          const info = CRITERIA_INFO[s.criterionSlug]
          const hasCurrentScore = s.currentScore !== undefined
          const isCurrent = s.mode === "current"
          const isSuggested = s.mode === "suggested"
          // Justificativa referente ao modo selecionado: a atual vem da avaliação
          // anterior (pode não existir se a nota atual não veio de IA).
          const justForMode = isCurrent ? s.currentJustification : s.justification
          return (
            <div key={s.criterionSlug} className="space-y-2 p-3 border rounded-md">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-sm font-medium">
                  {info?.emoji} {info?.name ?? s.criterionSlug}
                </Label>
                {s.wasEdited && (
                  <span className="text-xs text-amber-600 font-medium">Editado</span>
                )}
              </div>

              <div
                className={cn(
                  "grid gap-1 rounded-md border bg-muted/30 p-1",
                  hasCurrentScore ? "grid-cols-2" : "grid-cols-1"
                )}
              >
                {hasCurrentScore && (
                  <Button
                    type="button"
                    size="sm"
                    variant={isCurrent ? "default" : "ghost"}
                    onClick={() => selectMode(s.criterionSlug, "current")}
                    className="h-auto flex-col gap-0.5 py-1.5"
                  >
                    <span className="text-[10px] uppercase tracking-wide opacity-80">
                      Atual
                    </span>
                    <span className="font-mono text-base font-bold leading-none">
                      {s.currentScore!.toFixed(1)}
                    </span>
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant={isSuggested ? "default" : "ghost"}
                  onClick={() => selectMode(s.criterionSlug, "suggested")}
                  className="h-auto flex-col gap-0.5 py-1.5"
                >
                  <span className="text-[10px] uppercase tracking-wide opacity-80">
                    Sugerido
                  </span>
                  <span className="font-mono text-base font-bold leading-none">
                    {s.suggestedScore.toFixed(1)}
                  </span>
                </Button>
              </div>

              {(justForMode || isCurrent) && (
                <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide">
                    <span className={isCurrent ? "text-muted-foreground" : "text-primary"}>
                      Justificativa · {isCurrent ? "atual" : "sugerida"}
                    </span>
                  </p>
                  {justForMode ? (
                    <p className="text-xs text-muted-foreground">{justForMode}</p>
                  ) : (
                    <p className="text-xs italic text-muted-foreground/70">
                      Sem justificativa — a nota atual não veio de avaliação IA.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

    </div>
  )
}

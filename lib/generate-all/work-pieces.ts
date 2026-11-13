import { MIN_USEFUL_REVIEWS_FOR_EVAL, hasEnoughReviewsForEval } from "@/lib/ai-evaluation/eval-evidence"
import { interestPredictLabel } from "@/lib/ui/interest-predict-label"
import { WORK_ACTION_LABELS, reviewsSynthesisLabel } from "@/lib/ui/work-action-labels"
import { MIN_USEFUL_REVIEWS_FOR_DIGEST, hasEnoughReviewsForDigest } from "@/lib/reviews/digest-gate"

/**
 * O que o "Gerar tudo" encontraria nesta obra, e o que isso diz sobre o botão.
 *
 * Medido em 13/11/2026 na nuvem: das 1.083 obras ativas, só **3 não têm notas**, que é o
 * caso para o qual a cascata foi feita. Nas outras 1.080, clicar refaz o que já existe
 * (~US$0,13) e ACEITA uma avaliação nova sem revisão, por cima das notas revisadas. O
 * que falta nelas costuma ser uma peça só, com botão próprio e mais barato: 384 sem
 * Veredito, 128 sem síntese das reviews, 15 sem Interesse.
 *
 * Por isso o botão não é desligado: ele muda de aparência ("Refazer tudo", discreto) e o
 * cartão aponta o botão da peça que falta. A régua é "tem nota", a mesma de
 * `hasCriteriaScores` na página da obra, nunca o `ai_eval_status`: nota também vem de
 * import e de edição manual.
 */

export interface GenerateAllPieces {
  synopsis: boolean
  summary: boolean
  digest: boolean
  tags: boolean
  scores: boolean
  interest: boolean
  verdict: boolean
  embedding: boolean
}

export type GenerateAllPieceKey = keyof GenerateAllPieces

export interface GenerateAllWorkState {
  pieces: GenerateAllPieces
  /** Há uma avaliação concluída esperando revisão (`ai_eval_status = review_pending`). */
  reviewPending: boolean
  /** Reviews úteis (o 💬, `work_card_counts`). `null` = não foi possível ler. */
  usefulReviews: number | null
  /** `estimateCascadeUsd()` — o mesmo número da confirmação da cascata. */
  estimatedUsd: number
}

/** As 8 etapas, na ordem em que a cascata as roda. */
export const GENERATE_ALL_STEPS: ReadonlyArray<{ key: GenerateAllPieceKey; label: string }> = [
  { key: "synopsis", label: "Sinopse consolidada" },
  { key: "summary", label: "Resumo das reviews" },
  { key: "digest", label: "Síntese das reviews" },
  { key: "tags", label: "Tags inferidas" },
  { key: "scores", label: "Notas dos atributos" },
  { key: "interest", label: "Interesse" },
  { key: "verdict", label: "Veredito" },
  { key: "embedding", label: "Embedding" },
]

export interface MissingPiece {
  key: GenerateAllPieceKey
  label: string
  /** O botão que resolve só esta peça, e onde ele fica. */
  action: string
  where: string
  /** O botão existe, mas recusaria: a peça espera evidência (ex.: síntese abaixo do piso). */
  blocked: string | null
}

export type GenerateAllAdvice =
  /** Obra sem notas: o caso da cascata. `fewReviews` quando ainda não vale avaliar. */
  | { kind: "generate"; fewReviews: { useful: number; min: number } | null }
  /** Avaliação esperando revisão: refazer a descartaria. */
  | { kind: "review"; missing: MissingPiece[] }
  /** Tem notas e falta alguma peça: os botões delas. */
  | { kind: "missing"; missing: MissingPiece[] }
  /** Tem tudo. */
  | { kind: "complete" }

export interface GenerateAllView {
  /** `generate` = botão cheio; `redo` = discreto, rótulo "Refazer tudo". */
  mode: "generate" | "redo"
  label: string
  ready: number
  total: number
  rows: Array<{ key: GenerateAllPieceKey; label: string; has: boolean }>
  advice: GenerateAllAdvice
  usefulReviews: number | null
  /** Abaixo do piso de avaliação (`MIN_USEFUL_REVIEWS_FOR_EVAL`). */
  fewReviews: boolean
  minUsefulReviews: number
  reviewPending: boolean
  estimatedUsd: number
}

function actionFor(key: GenerateAllPieceKey, pieces: GenerateAllPieces): { action: string; where: string } | null {
  switch (key) {
    case "synopsis":
      return { action: WORK_ACTION_LABELS.regenerateSynopsis, where: "no card Sinopses" }
    case "summary":
    case "digest":
      return { action: reviewsSynthesisLabel(pieces.summary), where: "na aba Análise da IA" }
    case "tags":
      return { action: WORK_ACTION_LABELS.inferTags, where: "na aba Gêneros e Tags" }
    case "interest":
      return { action: interestPredictLabel({ hasPrediction: false, stale: false }), where: "no card Sinopses" }
    case "verdict":
      return { action: WORK_ACTION_LABELS.calculateVerdict, where: "no Veredito IA, aba Notas & Avaliações" }
    case "embedding":
      return { action: WORK_ACTION_LABELS.updateEmbeddings, where: "nas Configurações da curadoria" }
    case "scores":
      return null
  }
}

export function describeGenerateAll(state: GenerateAllWorkState): GenerateAllView {
  const { pieces } = state
  const rows = GENERATE_ALL_STEPS.map((s) => ({ key: s.key, label: s.label, has: pieces[s.key] }))
  const ready = rows.filter((r) => r.has).length
  const useful = state.usefulReviews
  const fewReviews = useful != null && !hasEnoughReviewsForEval(useful)

  // Resumo e síntese saem do MESMO botão do card de reviews: quando faltam os dois, uma
  // linha só, senão o cartão mandaria clicar duas vezes no mesmo lugar.
  const missing: MissingPiece[] = []
  for (const r of rows) {
    if (r.has || r.key === "scores") continue
    if (r.key === "digest" && !pieces.summary) continue
    const a = actionFor(r.key, pieces)
    if (!a) continue
    const label = r.key === "summary" && !pieces.digest ? "Resumo e síntese das reviews" : r.label
    // A síntese tem piso próprio (`MIN_USEFUL_REVIEWS_FOR_DIGEST`): abaixo dele o botão do card
    // de reviews existe e recusa. Mandar clicar nele seria prometer o que não acontece.
    const blocked =
      r.key === "digest" && useful != null && !hasEnoughReviewsForDigest(useful)
        ? `precisa de ${MIN_USEFUL_REVIEWS_FOR_DIGEST} reviews úteis`
        : null
    missing.push({ key: r.key, label, ...a, blocked })
  }

  let advice: GenerateAllAdvice
  if (!pieces.scores) {
    advice = {
      kind: "generate",
      fewReviews: fewReviews && useful != null ? { useful, min: MIN_USEFUL_REVIEWS_FOR_EVAL } : null,
    }
  } else if (state.reviewPending) {
    advice = { kind: "review", missing }
  } else if (missing.length > 0) {
    advice = { kind: "missing", missing }
  } else {
    advice = { kind: "complete" }
  }

  const mode = pieces.scores ? "redo" : "generate"
  return {
    mode,
    label: mode === "redo" ? "Refazer tudo" : "Gerar tudo",
    ready,
    total: rows.length,
    rows,
    advice,
    usefulReviews: useful,
    fewReviews,
    minUsefulReviews: MIN_USEFUL_REVIEWS_FOR_EVAL,
    reviewPending: state.reviewPending,
    estimatedUsd: state.estimatedUsd,
  }
}

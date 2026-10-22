import { deduplicateReviews } from "@/lib/ai-evaluation/review-dedup"
import type { SourcedReview } from "@/lib/external/types"

/**
 * Identificador versionado da política de seleção de reviews (`selectReviewsForEvaluation`):
 * rodízio entre fontes como ORDEM, sem teto por fonte; dedup antes do corte, com a régua de
 * contenção (`review-dedup.ts`) e a versão mais completa de cada cópia; corte em 30.
 *
 * Mudou a seleção ou a régua de duplicata? Troque o sufixo.
 *
 * Como ler o `evaluationContext`:
 *  - COM o bloco `reviewSelection`: a política é a que ele nomeia.
 *  - SEM o bloco: a política NÃO se infere só pela ausência. As avaliações gravadas antes desta
 *    mudança usaram a cota `min(12, ceil(30/fontes))` e a dedup só por Jaccard; mas o cadastro
 *    (`/catalog/new`, `evaluateCandidateForCreate`) já seleciona com esta política e não grava
 *    `evaluationContext` nenhum (limitação conhecida, não tratada aqui). Nunca reconstruir a política
 *    de uma avaliação antiga.
 */
export const REVIEW_SELECTION_POLICY = "w3-contencao-v1"

export interface ReviewSelectionRecord {
  policy: typeof REVIEW_SELECTION_POLICY
  /** Capacidade global de reviews raspadas (as manuais ficam fora dela). */
  capacity: number
  /** Pool de onde a seleção escolheu (fresco ∪ persistido, sem fontes rejeitadas), antes da dedup. */
  poolRaw: number
  /** O mesmo pool depois da dedup da seleção (cópias da mesma manifestação contadas uma vez). */
  poolDedup: number
  /** Reviews raspadas que chegaram ao prompt. */
  selected: number
  /** O que a seleção devolveu, antes da dedup do prompt contra as manuais (normalmente = `selected`). */
  selectedBySelector: number
  bySourcePool: Record<string, number>
  bySourceSelected: Record<string, number>
  /** Quantas reviews do pool vieram do persistido (`work_reviews`) e não da busca fresca. */
  recoveredFromPersisted: number | null
  /** Reviews manuais no prompt — entram antes e por fora da capacidade. */
  manualOutsideCapacity: number
}

function porFonte(reviews: SourcedReview[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of reviews) out[r.source] = (out[r.source] ?? 0) + 1
  return out
}

/**
 * Monta a lista que vai ao prompt (manuais primeiro, depois as selecionadas) e o registro do que foi
 * usado. O registro sai do que o PROMPT recebe — a mesma dedup que `prepareReviews` aplica —, não do
 * que se pretendia mandar.
 */
export function montarReviewsDaAvaliacao(args: {
  pool: SourcedReview[]
  selecionadas: SourcedReview[]
  manuais: SourcedReview[]
  capacidade: number
  recuperadas: number | null
}): { efetivas: SourcedReview[]; reviewSelection: ReviewSelectionRecord } {
  const efetivas = [...args.manuais, ...args.selecionadas]
  const noPrompt = deduplicateReviews(efetivas)
  const raspadasNoPrompt = noPrompt.filter((r) => !r.isManual)
  return {
    efetivas,
    reviewSelection: {
      policy: REVIEW_SELECTION_POLICY,
      capacity: args.capacidade,
      poolRaw: args.pool.length,
      poolDedup: deduplicateReviews(args.pool, { preferirVersaoMaisCompleta: true }).length,
      selected: raspadasNoPrompt.length,
      selectedBySelector: args.selecionadas.length,
      bySourcePool: porFonte(args.pool),
      bySourceSelected: porFonte(raspadasNoPrompt),
      recoveredFromPersisted: args.recuperadas,
      manualOutsideCapacity: noPrompt.length - raspadasNoPrompt.length,
    },
  }
}

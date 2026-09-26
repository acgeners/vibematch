/**
 * A cascata "Gerar tudo" MARCA a pendência de recálculo; não roda o recálculo global.
 *
 * 🔴 Teste COMPORTAMENTAL, não de grafia. O defeito era `recalculateScoresNow()` (force=true)
 * no passo `recalculate_scores`: a cascata roda UMA VEZ POR OBRA, então "Gerar tudo" em N
 * obras produzia N recálculos do catálogo inteiro. Um teste que só procurasse a string num
 * arquivo passaria verde com a chamada movida para outro módulo — aqui a cascata é INVOCADA
 * e os dois donos são espiados.
 *
 * ⚠️ O que se afirma é "esta cascata não FORÇA recalc global", não "o A2 acabou": os call
 * sites de `server/comix/resolver.ts` são outro commit, e a varredura que cobre TODOS vive
 * em `recalc-so-em-dono-declarado.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

const markRecalcPending = vi.fn(async () => {})
const recalculateScoresNow = vi.fn(async () => ({ status: "ok" as const }))
vi.mock("@/server/recalc/queue", () => ({
  markRecalcPending: (...a: unknown[]) => markRecalcPending(...(a as [])),
  recalculateScoresNow: () => recalculateScoresNow(),
}))

vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: vi.fn(async () => ({ ok: true })) }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
  }),
}))

// Passos da cascata — todos no-op: o que se mede é o passo do recalc.
vi.mock("@/lib/ai-recommendation/consolidate-for-work", () => ({
  consolidateSynopsisForWork: vi.fn(async () => ({})),
}))
vi.mock("@/lib/orchestration/integrations/reviews", () => ({ ensureReviewSummary: vi.fn(async () => ({})) }))
vi.mock("@/server/actions/review-digest", () => ({ generateWorkReviewDigest: vi.fn(async () => ({})) }))
vi.mock("@/lib/tags/auto-infer", () => ({ inferAndPersistTagsForWork: vi.fn(async () => ({})) }))
vi.mock("@/server/actions/ai", () => ({
  // Forma REAL que `runAiEvaluationStep` consome: { data: { evaluation: { id, ai_evaluation_scores[] } } }.
  triggerAiEvaluation: vi.fn(async () => ({
    data: {
      evaluation: {
        id: "eval-1",
        ai_evaluation_scores: [{ criterion_slug: "romance", suggested_score: 7 }],
      },
    },
  })),
  submitAiReview: vi.fn(async () => ({})),
}))
vi.mock("@/lib/ai-evaluation/synopsis-quality-runner", () => ({ autoPredictSynopsisQuality: vi.fn(async () => ({})) }))
vi.mock("@/server/actions/recommendations", () => ({ rerankSingleWorkAction: vi.fn(async () => ({})) }))
vi.mock("@/server/embeddings/refresh", () => ({ refreshEmbeddingForWork: vi.fn(async () => ({})) }))
vi.mock("@/server/comix/resolver", () => ({
  ensureComixReady: vi.fn(async () => ({ confirmed: true })),
  resolveComixDataResilient: vi.fn(async () => {}),
}))
vi.mock("@/lib/external/comick-health", () => ({ ensureComicKReady: vi.fn(async () => ({ confirmed: true })) }))
vi.mock("@/lib/external/acquire-reviews", () => ({ acquireAndPersistWorkReviews: vi.fn(async () => {}) }))
vi.mock("@/server/queries/work-reviews", () => ({ countWorkReviews: vi.fn(async () => 5) }))

const { generateAllWorkData } = await import("@/server/actions/generate-all")

beforeEach(() => {
  markRecalcPending.mockClear()
  recalculateScoresNow.mockClear()
})

describe("generateAllWorkData: o recálculo global é DEFERIDO", () => {
  it("uma obra NÃO dispara recalc global — marca pendência", async () => {
    const r = await generateAllWorkData("obra-1", { proceed: true, proceedWithoutReviews: true })
    // A cascata tem de CHEGAR ao fim: se parar antes, "não chamou o recalc" seria tautologia.
    expect(r.status).not.toBe("failed")

    expect(recalculateScoresNow).not.toHaveBeenCalled()
    expect(markRecalcPending).toHaveBeenCalledTimes(1)
  })

  it("declara a MATERIALIDADE (`category_scores`) em vez de marcar por 'não sei'", async () => {
    await generateAllWorkData("obra-1", { proceed: true, proceedWithoutReviews: true })

    expect(markRecalcPending).toHaveBeenCalledWith(
      "generateAllWorkData",
      expect.objectContaining({ changed: ["category_scores"] }),
    )
  })

  it("🔴 N obras ⇒ ZERO recalcs globais e N marcações — era N recalcs do catálogo", async () => {
    for (const id of ["a", "b", "c", "d", "e"]) {
      await generateAllWorkData(id, { proceed: true, proceedWithoutReviews: true })
    }

    // O alvo do plano era N → 1. A cascata contribui com 0; o 1 vem dos donos
    // existentes (finalizePendingBatch / maybeTriggerStaleRecalc / botão).
    expect(recalculateScoresNow).not.toHaveBeenCalled()
    expect(markRecalcPending).toHaveBeenCalledTimes(5)
  })
})

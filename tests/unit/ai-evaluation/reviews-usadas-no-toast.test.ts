import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * 🔴 O toast "Avaliação de X pronta (N reviews)" dizia "(sem reviews externas)" em TODA
 * avaliação. O N era quantos IDs (R1, R2…) o modelo citou em `review_usage` — campo que
 * saiu da tool no eval-2 (2026-07-07). Hoje é quantas reviews FORAM AO PROMPT, nos dois
 * caminhos: a chamada nova e o cache.
 */

vi.mock("server-only", () => ({}))

const spies = vi.hoisted(() => ({ createLoggedMessage: vi.fn() }))
vi.mock("@/lib/ai-evaluation/criteria-guard", () => ({ exigirCriteriosNoBanco: async () => {}, exigirVersaoCanonica: async () => {} }))
vi.mock("@/lib/ai/anthropic-client", () => ({
  createLoggedMessage: spies.createLoggedMessage,
  anotarPayloadRecusado: vi.fn(async () => {}),
  getAnthropicClient: () => ({}),
}))
vi.mock("@/server/queries/ai-cache", () => ({ recordCacheEventAsync: vi.fn(), readAiCache: vi.fn(async () => null), writeAiCache: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    throw new Error("sem banco no teste")
  },
}))
vi.mock("@/lib/server/covers/fetch-cover-for-model", () => ({
  fetchCoverForModelWithStatus: vi.fn(async () => ({ image: null, status: "not_requested" })),
  isImageRelatedModelError: () => false,
}))

import { requestAiEvaluation, reviewsSentToPromptFromContext } from "@/lib/ai-evaluation/service"
import type { AiEvaluationRequest } from "@/lib/ai-evaluation/service"
import type { SourcedReview } from "@/lib/external/types"
import { CRITERION_SLUGS } from "@/types/domain"

const rev = (text: string, source = "mangaupdates"): SourcedReview =>
  ({ source, sourceTitle: "Obra", matchScore: 0.95, text, textLength: text.length }) as SourcedReview
const termos = (i: number) => Array.from({ length: 10 }, (_, k) => `palavra${i}y${k}`).join(" ")

const pedido = (reviews: SourcedReview[]): AiEvaluationRequest =>
  ({
    workId: "00000000-0000-0000-0007-000000000001",
    title: "Obra do toast",
    synopsis: "Sinopse.",
    genres: [],
    tags: [],
    sourcedReviews: reviews,
    platformRatings: [],
    externalContext: [],
  }) as unknown as AiEvaluationRequest

const onze = {
  summary: "Resumo válido.",
  confidence: 0.8,
  art: {
    judging_reviews: [],
    quality_signal: "INCONCLUSIVE",
    quality_evidence: [],
    change_signal: "NO_CLEAR_SIGNAL",
    change_evidence: [],
    justification: "Sem evidência.",
  },
  scores: CRITERION_SLUGS.map((criterion) => ({ criterion, score: 5, justification: "Faixa 4-6: presente." })),
}

beforeEach(() => {
  spies.createLoggedMessage.mockReset()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("reviewsUsed = reviews que foram ao prompt", () => {
  it("chamada nova: conta as reviews enviadas, mesmo sem o modelo citar nenhum ID", async () => {
    spies.createLoggedMessage.mockResolvedValueOnce({
      apiCallId: "call-toast",
      message: { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "submit_evaluation", input: onze }] },
    })
    const res = await requestAiEvaluation(
      pedido([rev(`Primeira ${termos(1)}.`), rev(`Segunda ${termos(2)}.`, "comix"), rev(`Terceira ${termos(3)}.`, "kitsu")]),
    )
    expect(res.reviewsUsed).toBe(3)
  })

  it("cache: lê a contagem do contexto gravado", () => {
    expect(reviewsSentToPromptFromContext({ evaluationContext: { sourcedReviewsAfterDedup: 27, legacyReviewsAfterDedup: 0 } })).toBe(27)
    expect(reviewsSentToPromptFromContext({ evaluationContext: { sourcedReviews: [{}, {}] } })).toBe(2)
    // O arranjo antigo lia `reviewAudit.usedReviewIds`, que é [] desde 07/2026 — e dava 0 aqui.
    expect(
      reviewsSentToPromptFromContext({ reviewAudit: { usedReviewIds: [] }, evaluationContext: { sourcedReviewsAfterDedup: 12 } }),
    ).toBe(12)
    expect(reviewsSentToPromptFromContext(null)).toBe(0)
  })
})

import { vi, describe, it, expect, afterEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/server/actions/review-digest", () => ({ generateWorkReviewDigest: vi.fn() }))
vi.mock("@/server/actions/reviews", () => ({ refetchWorkReviews: vi.fn() }))
vi.mock("@/server/actions/update-status", () => ({ getWorkUpdateStatus: vi.fn() }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => vi.fn(async () => true) }))

import { render, screen, cleanup } from "@testing-library/react"
import { WorkReviewsCard } from "@/components/titles/work-reviews-card"
import type { WorkReviewsSnapshot } from "@/server/queries/work-reviews"

/** O aviso da versão normal concorda com o número: "1 review … fica" × "N reviews … ficam". */
const ISO = "2026-10-11T00:00:00.000Z"
const snapshot: WorkReviewsSnapshot = {
  fetchedAt: ISO, total: 5, bySource: [], manual: [],
  summary: null, summaryAt: null, digest: null, digestAt: null, digestN: null, digestVersion: null,
}

describe("aviso das reviews ocultas na versão normal", () => {
  afterEach(cleanup)
  it("singular", () => {
    render(<WorkReviewsCard workId="w1" snapshot={snapshot} editionView={{ synthesisHidden: false, reviewsHidden: 1 }} />)
    expect(screen.getByText(/1 review citando conteúdo sexual explícito fica na versão R18\./)).toBeTruthy()
    expect(screen.queryByText(/review citando conteúdo sexual explícito ficam/)).toBeNull()
  })
  it("plural", () => {
    render(<WorkReviewsCard workId="w1" snapshot={snapshot} editionView={{ synthesisHidden: false, reviewsHidden: 9 }} />)
    expect(screen.getByText(/9 reviews citando conteúdo sexual explícito ficam na versão R18\./)).toBeTruthy()
  })
})

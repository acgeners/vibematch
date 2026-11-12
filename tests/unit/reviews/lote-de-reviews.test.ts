import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  BROKEN_STREAK_TO_ABORT,
  runCatalogReviewBatch,
  summarizeReviewBatch,
} from "@/lib/reviews/catalog-review-batch"
import type { ReviewBatchWorkResult } from "@/lib/reviews/catalog-review-batch"

// Lote "Reviews do catálogo" (`/curation/settings?g=fontes`). Ele roda HORAS (~37 s por obra), e
// por isso o que importa aqui é o que decide parar: a pessoa pedindo, o bypass caído no meio, o
// gate recusando — e, na action, quando a obra pode ir para o fim da fila (`reviews_checked_at`).

const ok = (workId: string, gained = 0): ReviewBatchWorkResult => ({
  workId,
  attempted: true,
  gained,
  failedSources: [],
  checked: true,
})
const failing = (workId: string, failedSources: string[]): ReviewBatchWorkResult => ({
  workId,
  attempted: true,
  gained: 0,
  failedSources,
  checked: false,
})

describe("runCatalogReviewBatch — o laço", () => {
  it("percorre todas e anda o progresso obra a obra", async () => {
    const progress: Array<[number, number]> = []
    const out = await runCatalogReviewBatch(["a", "b", "c"], {
      refresh: async (id) => [ok(id, 1)],
      shouldStop: () => false,
      onProgress: (d, t) => progress.push([d, t]),
    })
    expect(out.results.map((r) => r.workId)).toEqual(["a", "b", "c"])
    expect(out.stoppedByUser).toBe(false)
    expect(out.abortedReason).toBeNull()
    expect(progress).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]])
  })

  it("Parar encerra ENTRE obras, com o que já rodou", async () => {
    let stop = false
    const refresh = vi.fn(async (id: string) => {
      if (id === "b") stop = true // a pessoa clica em Parar enquanto "b" está rodando
      return [ok(id)]
    })
    const out = await runCatalogReviewBatch(["a", "b", "c", "d"], { refresh, shouldStop: () => stop })
    expect(out.results.map((r) => r.workId)).toEqual(["a", "b"])
    expect(out.stoppedByUser).toBe(true)
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it(`🔴 aborta sozinho com Comix E Mangago falhando juntos em ${BROKEN_STREAK_TO_ABORT} obras seguidas (bypass fora)`, async () => {
    const refresh = vi.fn(async (id: string) => [failing(id, ["comix", "mangago", "animeplanet"])])
    const out = await runCatalogReviewBatch(["a", "b", "c", "d", "e"], { refresh, shouldStop: () => false })
    expect(refresh).toHaveBeenCalledTimes(BROKEN_STREAK_TO_ABORT)
    expect(out.abortedReason).toMatch(/FlareSolverr/)
  })

  it("link morto SÓ da Comix não aborta: é problema da obra, não do bypass", async () => {
    const refresh = vi.fn(async (id: string) => [failing(id, ["comix"])])
    const out = await runCatalogReviewBatch(["a", "b", "c", "d", "e"], { refresh, shouldStop: () => false })
    expect(refresh).toHaveBeenCalledTimes(5)
    expect(out.abortedReason).toBeNull()
  })

  it("uma obra boa no meio zera a sequência", async () => {
    const seq = ["x", "x", "ok", "x", "x", "ok"]
    let i = 0
    const out = await runCatalogReviewBatch(["a", "b", "c", "d", "e", "f"], {
      refresh: async (id) => [seq[i++] === "ok" ? ok(id) : failing(id, ["comix", "mangago"])],
      shouldStop: () => false,
    })
    expect(out.results).toHaveLength(6)
    expect(out.abortedReason).toBeNull()
  })

  it("erro em obras seguidas também aborta, com a mensagem do erro", async () => {
    const out = await runCatalogReviewBatch(["a", "b", "c", "d"], {
      refresh: async (id) => [{ ...ok(id), checked: false, error: "conexão recusada" }],
      shouldStop: () => false,
    })
    expect(out.results).toHaveLength(BROKEN_STREAK_TO_ABORT)
    expect(out.abortedReason).toMatch(/conexão recusada/)
  })

  it("🔴 lista vazia (o gate recusou) LANÇA — senão o indicador diria 'pronto' sem ter buscado nada", async () => {
    await expect(
      runCatalogReviewBatch(["a"], { refresh: async () => [], shouldStop: () => false }),
    ).rejects.toThrow(/sem permissão/)
  })
})

describe("summarizeReviewBatch — o que a pessoa lê no fim", () => {
  it("as que mais ganharam primeiro, e as com fonte em falha com o porquê", () => {
    const titles = new Map([["a", "Alfa"], ["b", "Beta"], ["c", "Gama"], ["d", "Delta"]])
    const s = summarizeReviewBatch(
      {
        total: 6,
        stoppedByUser: true,
        abortedReason: null,
        results: [ok("a", 3), ok("b", 12), failing("c", ["mangago"]), { ...ok("d"), checked: false, error: "boom" }],
      },
      titles,
    )
    expect(s.processed).toBe(4)
    expect(s.worksWithGain).toBe(2)
    expect(s.totalGained).toBe(15)
    expect(s.top).toEqual([{ title: "Beta", gained: 12 }, { title: "Alfa", gained: 3 }])
    expect(s.failed).toEqual([{ title: "Gama", reason: "mangago" }, { title: "Delta", reason: "boom" }])
    expect(s.remaining).toBe(2)
  })
})

// ── A action: quando a obra vai para o fim da fila, e quanto ela ganhou ─────────────────────

const refreshWorkReviewsLean = vi.fn()
const getWorkTagReviewCounts = vi.fn()
const updates: Array<{ table: string; patch: Record<string, unknown>; id: unknown }> = []

vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }))
vi.mock("next/cache", () => ({ revalidateTag: () => {} }))
vi.mock("@/server/queries/current-user", () => ({ ensureAdmin: async () => ({ ok: true }) }))
vi.mock("@/lib/background/update-jobs", () => ({ startUpdateJob: () => {}, finishUpdateJob: () => {} }))
vi.mock("@/server/queries/work-card-meta", () => ({
  getWorkTagReviewCounts: (ids: string[]) => getWorkTagReviewCounts(ids),
}))
vi.mock("@/lib/external/acquire-reviews", () => ({
  refreshWorkReviewsLean: (id: string) => refreshWorkReviewsLean(id),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: unknown) => {
          updates.push({ table, patch, id })
          return { error: null }
        },
      }),
    }),
  }),
}))

import { refreshReviewsForWorks } from "@/server/actions/reviews"

const counts = (...values: number[]) => {
  for (const v of values) getWorkTagReviewCounts.mockImplementationOnce(async (ids: string[]) => new Map([[ids[0], { tagCount: 0, reviewCount: v }]]))
}

beforeEach(() => {
  vi.clearAllMocks()
  updates.length = 0
})

describe("refreshReviewsForWorks — a action", () => {
  it("gained é o 💬 depois menos o 💬 antes, e a busca completa grava reviews_checked_at", async () => {
    counts(10, 17)
    refreshWorkReviewsLean.mockResolvedValueOnce({ attempted: true, failedSources: [] })
    const [r] = await refreshReviewsForWorks(["w1"])
    expect(r).toMatchObject({ workId: "w1", gained: 7, checked: true })
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ table: "works", id: "w1" })
    expect(updates[0].patch).toHaveProperty("reviews_checked_at")
  })

  it("🔴 com QUALQUER fonte em falha, NÃO grava reviews_checked_at — a obra volta primeiro na próxima rodada", async () => {
    counts(10, 12)
    refreshWorkReviewsLean.mockResolvedValueOnce({ attempted: true, failedSources: ["mangago"] })
    const [r] = await refreshReviewsForWorks(["w1"])
    expect(r).toMatchObject({ gained: 2, checked: false, failedSources: ["mangago"] })
    expect(updates).toHaveLength(0)
  })

  it("erro na busca também não grava, e volta no resultado", async () => {
    counts(10, 10)
    refreshWorkReviewsLean.mockResolvedValueOnce({ attempted: true, failedSources: [], error: "falhou a leitura" })
    const [r] = await refreshReviewsForWorks(["w1"])
    expect(r).toMatchObject({ checked: false, error: "falhou a leitura" })
    expect(updates).toHaveLength(0)
  })

  it("o 💬 caindo (review apagada) não vira ganho negativo", async () => {
    counts(10, 8)
    refreshWorkReviewsLean.mockResolvedValueOnce({ attempted: true, failedSources: [] })
    const [r] = await refreshReviewsForWorks(["w1"])
    expect(r.gained).toBe(0)
  })
})

// ── A busca enxuta: custo de IA zero, e gravação que não regrava ────────────────────────────

describe("refreshWorkReviewsLean — custo zero", () => {
  it("grava cada fonte com skipPaidEnrichment E accumulate, sem hidratar as fontes", async () => {
    vi.resetModules()
    vi.doUnmock("@/lib/external/acquire-reviews")
    const saveWorkReviews = vi.fn<(workId: string, reviews: unknown[], opts?: unknown) => Promise<void>>(async () => {})
    const fetchContext = vi.fn()
    vi.doMock("@/lib/external/persist-reviews", () => ({ saveWorkReviews }))
    vi.doMock("@/lib/external/index", () => ({
      buildCandidateFromExternalIds: () => ({ title: "Obra" }),
      fetchExternalEvaluationContextForCandidate: fetchContext,
      collectReviewsFromCandidate: async (_c: unknown, onSource: (r: unknown[]) => Promise<void>) => {
        await onSource([{ source: "mangago", text: "review longa o bastante para contar como útil aqui" }])
        return { reviews: [], failedSources: ["comix"], linkStatus: {} }
      },
    }))
    const chain = (result: unknown): Record<string, unknown> =>
      new Proxy({}, {
        get(_t, prop) {
          if (prop === "then") return (res: (v: unknown) => void) => Promise.resolve(result).then(res)
          return () => chain(result)
        },
      }) as Record<string, unknown>
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => ({
        from: (table: string) =>
          chain(
            table === "works"
              ? { data: { title: "Obra", original_title: null, alternative_titles: [] }, error: null }
              : { data: [{ source: "mangago", external_id: "x", is_rejected: false }], error: null },
          ),
      }),
    }))
    const { refreshWorkReviewsLean: lean } = await import("@/lib/external/acquire-reviews")
    const out = await lean("w1")
    expect(out).toEqual({ attempted: true, failedSources: ["comix"] })
    expect(fetchContext).not.toHaveBeenCalled()
    expect(saveWorkReviews).toHaveBeenCalledTimes(1)
    expect(saveWorkReviews.mock.calls[0][2]).toEqual({ skipPaidEnrichment: true, accumulate: true })
  })
})

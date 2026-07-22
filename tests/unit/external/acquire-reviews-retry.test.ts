import { describe, it, expect, vi, beforeEach } from "vitest"
import { classifySummaryReadiness } from "@/lib/orchestration/integrations/reviews"
import { hashReviewInputs, packReviewSummaryMeta } from "@/lib/ai-recommendation/review-summarizer"

// Lacuna #3: uma fonte que estoura o timeout não some com barulho — ela some em silêncio,
// e o resumo/digest saem de um POOL PARCIAL custando o mesmo que o completo. Pior: o gate
// de materialidade (crescimento ≥ max(2, 20%)) faz a chegada tardia dessas reviews ser
// ignorada, congelando o recorte como se fosse o universo.
//
// O que este arquivo defende são os DOIS lados da moeda, porque errar qualquer um custa
// dinheiro de verdade:
//   1. a 2ª passada tem que acontecer, e SÓ nas fontes que falharam;
//   2. o `force` não pode virar desculpa pra repagar LLM quando nada mudou.

type SaveOpts = { skipPaidEnrichment?: boolean; forcePaidEnrichment?: boolean; awaitDigest?: boolean }
type Collected = { reviews: unknown[]; failedSources: string[] }

const saveWorkReviews =
  vi.fn<(workId: string, reviews: unknown[], opts?: SaveOpts) => Promise<void>>(async () => {})
const collectReviewsFromCandidate =
  vi.fn<(c: unknown, cb: unknown, onlySources?: string[]) => Promise<Collected>>()
const fetchExternalEvaluationContextForCandidate =
  vi.fn<(c: unknown, o: unknown) => Promise<{ allReviews: unknown[]; failedSources: string[] }>>()

vi.mock("@/lib/external/persist-reviews", () => ({
  saveWorkReviews: (w: string, r: unknown[], o?: SaveOpts) => saveWorkReviews(w, r, o),
}))

vi.mock("@/lib/external/index", () => ({
  buildCandidateFromExternalIds: (work: unknown, ids: unknown) => ({ title: "Obra", ids, work }),
  fetchExternalEvaluationContextForCandidate: (c: unknown, o: unknown) =>
    fetchExternalEvaluationContextForCandidate(c, o),
  collectReviewsFromCandidate: (c: unknown, cb: unknown, only?: string[]) =>
    collectReviewsFromCandidate(c, cb, only),
}))

const chain = (result: unknown): Record<string, unknown> =>
  new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => void) => Promise.resolve(result).then(res)
        return () => chain(result)
      },
    },
  ) as Record<string, unknown>

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) =>
      chain(
        table === "works"
          ? { data: { title: "Obra", original_title: null, alternative_titles: [] }, error: null }
          : {
              data: [
                { source: "anilist", external_id: "1", is_rejected: false },
                { source: "mangaupdates", external_id: "2", is_rejected: false },
              ],
              error: null,
            },
      ),
  }),
}))

import { acquireAndPersistWorkReviews } from "@/lib/external/acquire-reviews"

const review = (source: string, n: number) => ({
  source,
  sourceTitle: "Obra",
  matchScore: 1,
  text: `review ${source} ${n} com texto longo o bastante pra valer`,
  textLength: 45,
})

const lastSaveOpts = (): SaveOpts => saveWorkReviews.mock.calls.at(-1)?.[2] ?? {}
const lastSavePool = (): unknown[] => saveWorkReviews.mock.calls.at(-1)?.[1] ?? []

beforeEach(() => vi.clearAllMocks())

describe("acquireAndPersistWorkReviews — 2ª passada quando uma fonte falha", () => {
  it("nenhuma falha: NÃO retenta e NÃO força enriquecimento pago", async () => {
    fetchExternalEvaluationContextForCandidate.mockResolvedValue({
      allReviews: [review("anilist", 1)],
      failedSources: [],
    })
    await acquireAndPersistWorkReviews("w1")
    expect(collectReviewsFromCandidate).not.toHaveBeenCalled()
    expect(lastSaveOpts().forcePaidEnrichment).toBe(false)
  })

  it("fonte falhou: retenta SÓ ela (não o plano inteiro)", async () => {
    fetchExternalEvaluationContextForCandidate.mockResolvedValue({
      allReviews: [review("anilist", 1)],
      failedSources: ["mangaupdates"],
    })
    collectReviewsFromCandidate.mockResolvedValue({
      reviews: [review("mangaupdates", 1)],
      failedSources: [],
    })
    await acquireAndPersistWorkReviews("w1")
    expect(collectReviewsFromCandidate).toHaveBeenCalledTimes(1)
    // 3º argumento = onlySources. Retentar tudo dobraria o scraping à toa.
    expect(collectReviewsFromCandidate.mock.calls[0][2]).toEqual(["mangaupdates"])
  })

  it("recuperou reviews: força o regen (fura o gate de 20%) e soma ao pool", async () => {
    fetchExternalEvaluationContextForCandidate.mockResolvedValue({
      allReviews: [review("anilist", 1)],
      failedSources: ["mangaupdates"],
    })
    collectReviewsFromCandidate.mockResolvedValue({
      reviews: [review("mangaupdates", 1)],
      failedSources: [],
    })
    const total = await acquireAndPersistWorkReviews("w1")
    expect(lastSaveOpts().forcePaidEnrichment).toBe(true)
    expect(lastSavePool()).toHaveLength(2)
    expect(total).toBe(2)
  })

  it("2ª passada falhou de novo: NÃO força — não paga LLM por nada", async () => {
    fetchExternalEvaluationContextForCandidate.mockResolvedValue({
      allReviews: [review("anilist", 1)],
      failedSources: ["mangago"],
    })
    collectReviewsFromCandidate.mockResolvedValue({ reviews: [], failedSources: ["mangago"] })
    await acquireAndPersistWorkReviews("w1")
    expect(lastSaveOpts().forcePaidEnrichment).toBe(false)
    expect(lastSavePool()).toHaveLength(1)
  })

  it("o save final é UM só — o enriquecimento pago não roda duas vezes", async () => {
    fetchExternalEvaluationContextForCandidate.mockResolvedValue({
      allReviews: [review("anilist", 1)],
      failedSources: ["mangaupdates"],
    })
    collectReviewsFromCandidate.mockResolvedValue({
      reviews: [review("mangaupdates", 1)],
      failedSources: [],
    })
    await acquireAndPersistWorkReviews("w1")
    const pagos = saveWorkReviews.mock.calls.filter(
      (c) => !(c[2] as { skipPaidEnrichment?: boolean } | undefined)?.skipPaidEnrichment,
    )
    expect(pagos).toHaveLength(1)
  })
})

describe("classifySummaryReadiness — o `force` não pode virar cheque em branco", () => {
  const reviews = [{ text: "uma review qualquer com tamanho suficiente", userRating: null }]
  const hash = hashReviewInputs(reviews)

  it("mesmo conteúdo (hash igual): FRESH mesmo sob force — não repaga Haiku", () => {
    const r = classifySummaryReadiness({
      reviewCount: 1,
      currentHash: hash,
      nowN: 1,
      storedSummary: "resumo",
      storedMeta: packReviewSummaryMeta(hash, 1),
      force: true,
    })
    expect(r.state).toBe("fresh")
  })

  it("conteúdo novo mas crescimento pequeno: imaterial SEM force, stale COM force", () => {
    const args = {
      reviewCount: 21,
      currentHash: "hash-novo",
      nowN: 21,
      storedSummary: "resumo",
      storedMeta: packReviewSummaryMeta("hash-velho", 20),
    }
    expect(classifySummaryReadiness(args).state).toBe("immaterial")
    const forced = classifySummaryReadiness({ ...args, force: true })
    expect(forced).toEqual({ state: "stale", reason: "forced" })
  })

  it("sem reviews: force não inventa trabalho", () => {
    const r = classifySummaryReadiness({
      reviewCount: 0,
      currentHash: "x",
      nowN: 0,
      storedSummary: null,
      storedMeta: null,
      force: true,
    })
    expect(r.state).toBe("not_applicable")
  })
})

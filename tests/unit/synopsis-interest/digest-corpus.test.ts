import { describe, it, expect } from "vitest"
import {
  manualExternalRowsToCanonicalInput,
  readScrapedExternalReviews,
  readManuallyEnteredExternalReviews,
  readCanonicalReviewCorpus,
  buildCanonicalDigestPlanItem,
  readCanonicalDigestInput,
  EXPERIMENT_DIGEST_SOURCE,
} from "@/lib/synopsis-interest/digest-corpus"

const T = (n: number) => "x".repeat(Math.max(n, 0))

/** Fake do client supabase: registra as tabelas consultadas; responde por tabela. */
function fakeSb(byTable: Record<string, Array<Record<string, unknown>>>, recorded: string[]) {
  return {
    from(table: string) {
      recorded.push(table)
      return {
        select() {
          return { eq() { return Promise.resolve({ data: byTable[table] ?? [], error: null }) } }
        },
      }
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe("digest-corpus — mapeador manual_external (puro)", () => {
  it("origin=manual_external, source minúsculo, externalId/url preservados", () => {
    const out = manualExternalRowsToCanonicalInput([
      { id: "r1", source: "ComiX", text: T(50) },
    ])
    expect(out[0]).toMatchObject({ reviewId: "r1", origin: "manual_external", source: "comix", externalId: null, sourceUrl: null })
  })
})

describe("digest-corpus — loaders leem SOMENTE sua tabela", () => {
  it("14. readScrapedExternalReviews lê só work_reviews", async () => {
    const rec: string[] = []
    const sb = fakeSb({ work_reviews: [{ id: "a", source: "anilist", text: T(50) }] }, rec)
    const out = await readScrapedExternalReviews("w1", sb)
    expect(rec).toEqual(["work_reviews"])
    expect(out[0].origin).toBe("external_scraped")
  })
  it("15. readManuallyEnteredExternalReviews lê só work_external_reviews_manual", async () => {
    const rec: string[] = []
    const sb = fakeSb({ work_external_reviews_manual: [{ id: "b", source: "comix", external_review_id: "x", source_url: null, text: T(50) }] }, rec)
    const out = await readManuallyEnteredExternalReviews("w1", sb)
    expect(rec).toEqual(["work_external_reviews_manual"])
    expect(out[0].origin).toBe("manual_external")
  })
})

describe("digest-corpus — corpus canônico combinado", () => {
  it("17+18. combina as duas fontes e dedup preserva proveniência", async () => {
    const same = T(60)
    const rec: string[] = []
    const sb = fakeSb(
      {
        work_reviews: [{ id: "a", source: "anilist", text: same }],
        work_external_reviews_manual: [{ id: "b", source: "comix", external_review_id: "x", source_url: null, text: same }],
      },
      rec,
    )
    const c = await readCanonicalReviewCorpus("w1", sb)
    expect(rec.sort()).toEqual(["work_external_reviews_manual", "work_reviews"])
    expect(c.usefulReviewCount).toBe(1)
    expect(c.reviews[0].provenance.map((p) => p.origin).sort()).toEqual(["external_scraped", "manual_external"])
  })

  it("19. assinatura independe da ordem retornada pelo banco", async () => {
    const rows = [
      { id: "a", source: "anilist", text: T(50) },
      { id: "b", source: "mangaupdates", text: T(60) },
      { id: "c", source: "kitsu", text: T(70) },
    ]
    const sigOf = async (order: typeof rows) => (await readCanonicalReviewCorpus("w1", fakeSb({ work_reviews: order }, []))).reviewCorpusSignature
    const s1 = await sigOf(rows)
    const s2 = await sigOf([...rows].reverse())
    expect(s1).toBe(s2)
  })

  it("21. corpus vazio gera no_reviews_available", async () => {
    const c = await readCanonicalReviewCorpus("w1", fakeSb({}, []))
    expect(c.state).toBe("no_reviews_available")
    expect(c.noReviewsAvailable).toBe(true)
    expect(c.usefulReviewCount).toBe(0)
    expect(c.scale).toBe(0)
  })

  it("22. review curta (<40) é persistível mas NÃO entra no corpus do digest", async () => {
    const sb = fakeSb(
      { work_external_reviews_manual: [{ id: "s", source: "comix", external_review_id: "x", source_url: null, text: "curto" }] },
      [],
    )
    // o mapeador a aceita (persistível)…
    const mapped = manualExternalRowsToCanonicalInput([{ id: "s", source: "comix", text: "curto" }])
    expect(mapped).toHaveLength(1)
    // …mas o corpus a exclui (utilidade ≥40)
    const c = await readCanonicalReviewCorpus("w1", sb)
    expect(c.usefulReviewCount).toBe(0)
    expect(c.state).toBe("no_reviews_available")
  })

  it("23. duas reviews úteis ⇒ corpus available com 2 (cobertura mínima)", async () => {
    const sb = fakeSb(
      {
        work_reviews: [{ id: "a", source: "anilist", text: T(50) }],
        work_external_reviews_manual: [{ id: "b", source: "comix", external_review_id: "x", source_url: null, text: T(60) }],
      },
      [],
    )
    const c = await readCanonicalReviewCorpus("w1", sb)
    expect(c.usefulReviewCount).toBe(2)
    expect(c.state).toBe("available")
  })

  it("§5. teto 40 SÓ na amostra do digest; usefulCount/assinatura cobrem TODAS as úteis", async () => {
    const rows = Array.from({ length: 45 }, (_, i) => ({ id: `r${i}`, source: "anilist", text: `review distinta numero ${i} com texto suficientemente longo para ser util` }))
    const c = await readCanonicalReviewCorpus("w1", fakeSb({ work_reviews: rows }, []))
    expect(c.usefulReviewCount).toBe(45) // todas as úteis contam
    expect(c.reviews).toHaveLength(45) // assinatura cobre todas
    expect(c.sample).toHaveLength(40) // só a amostra é limitada
    expect(c.scale).toBe(40) // scale = min(úteis, 40)
    const execInput = await readCanonicalDigestInput("w1", fakeSb({ work_reviews: rows }, []))
    expect(execInput).toHaveLength(40)
  })

  it("20. planner item e executor input derivam do MESMO corpus canônico", async () => {
    const byTable = {
      work_reviews: [{ id: "a", source: "anilist", text: T(50) }, { id: "c", source: "kitsu", text: T(45) }],
      work_external_reviews_manual: [{ id: "b", source: "comix", external_review_id: "x", source_url: null, text: T(60) }],
    }
    const corpus = await readCanonicalReviewCorpus("w1", fakeSb(byTable, []))
    const planItem = await buildCanonicalDigestPlanItem("w1", fakeSb(byTable, []))
    const execInput = await readCanonicalDigestInput("w1", fakeSb(byTable, []))
    // planner: mesma assinatura/contagem do corpus
    expect(planItem.reviewCorpusSignature).toBe(corpus.reviewCorpusSignature)
    expect(planItem.usefulReviewCount).toBe(corpus.usefulReviewCount)
    // executor: mesmo recorte (sample), sem nota pessoal, fonte UNIFORME (text-only)
    expect(execInput).toHaveLength(corpus.sample.length)
    expect(execInput.every((r) => r.userRating === null)).toBe(true)
    expect(new Set(execInput.map((r) => r.source))).toEqual(new Set([EXPERIMENT_DIGEST_SOURCE]))
  })
})

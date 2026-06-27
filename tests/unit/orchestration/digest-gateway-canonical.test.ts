import { describe, it, expect } from "vitest"
import { SupabaseDigestGateway } from "@/lib/orchestration/integrations/reviews"

/** Fase 2 / 2A — o gateway do digest passou a ler o CORPUS CANÔNICO (work_reviews +
 * work_external_reviews_manual), deduplicado e leakage-proof (sem userRating). NÃO lê
 * work_manual_reviews (opinião pessoal da usuária). Mesma fonte validada na golden-3. */

const T = (n: number, ch = "x") => ch.repeat(Math.max(n, 0))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fakeSb(byTable: Record<string, Array<Record<string, unknown>>>, recorded: string[] = []): any {
  return {
    from(table: string) {
      recorded.push(table)
      return { select() { return { eq() { return Promise.resolve({ data: byTable[table] ?? [], error: null }) } } } }
    },
  }
}

describe("Fase 2 / 2A — SupabaseDigestGateway.readReviews usa corpus canônico", () => {
  it("inclui work_reviews E work_external_reviews_manual, com userRating sempre null", async () => {
    const sb = fakeSb({
      work_reviews: [{ id: "a", source: "anilist", text: T(60, "a") }],
      work_external_reviews_manual: [{ id: "b", source: "comix", text: T(60, "b") }],
    })
    const out = await new SupabaseDigestGateway(sb).readReviews("w1")
    expect(out.map((r) => r.source).sort()).toEqual(["anilist", "comix"])
    expect(out.every((r) => r.userRating === null)).toBe(true)
    expect(out.length).toBe(2)
  })

  it("NÃO consulta work_manual_reviews (anti-leakage), só as duas fontes externas", async () => {
    const recorded: string[] = []
    const sb = fakeSb({}, recorded)
    await new SupabaseDigestGateway(sb).readReviews("w1")
    expect(recorded).toContain("work_reviews")
    expect(recorded).toContain("work_external_reviews_manual")
    expect(recorded).not.toContain("work_manual_reviews")
  })

  it("reviews curtas (<40 chars) são descartadas pelo filtro de utilidade do corpus", async () => {
    const sb = fakeSb({
      work_reviews: [{ id: "a", source: "anilist", text: T(60, "a") }, { id: "c", source: "mal", text: "curta" }],
      work_external_reviews_manual: [],
    })
    const out = await new SupabaseDigestGateway(sb).readReviews("w1")
    expect(out.length).toBe(1)
    expect(out[0].source).toBe("anilist")
  })
})

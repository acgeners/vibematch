import { describe, expect, it } from "vitest"
import { mergeFreshWithPersistedReviews } from "@/lib/external/review-merge"
import type { SourcedReview, ExternalSourceId } from "@/lib/external/types"

function review(source: ExternalSourceId, text: string, extra: Partial<SourcedReview> = {}): SourcedReview {
  return {
    source,
    sourceTitle: "Obra",
    matchScore: 1,
    text,
    textLength: text.length,
    ...extra,
  }
}

describe("mergeFreshWithPersistedReviews", () => {
  it("recupera do pool persistido as reviews que a busca fresca não trouxe", () => {
    const fresh = [review("myanimelist", "só o MAL respondeu")]
    const persisted = [
      review("myanimelist", "só o MAL respondeu"),
      review("mangago", "review do mangago"),
      review("comix", "review da comix"),
    ]
    const { merged, recovered } = mergeFreshWithPersistedReviews(fresh, persisted)
    expect(recovered).toBe(2)
    expect(merged.map((r) => r.source)).toEqual(["myanimelist", "mangago", "comix"])
  })

  it("frescas vêm primeiro e vencem a dedup (fonte+texto normalizado)", () => {
    const fresh = [review("comick", "mesmo texto", { userRating: 9 })]
    const persisted = [review("comick", "  mesmo texto  ", { userRating: 5 })]
    const { merged, recovered } = mergeFreshWithPersistedReviews(fresh, persisted)
    expect(recovered).toBe(0)
    expect(merged).toHaveLength(1)
    expect(merged[0].userRating).toBe(9)
  })

  it("mesmo texto em fontes DIFERENTES não é duplicata", () => {
    const fresh = [review("comick", "great art")]
    const persisted = [review("mangago", "great art")]
    const { merged, recovered } = mergeFreshWithPersistedReviews(fresh, persisted)
    expect(recovered).toBe(1)
    expect(merged).toHaveLength(2)
  })

  it("filtra fontes rejeitadas do pool persistido", () => {
    const persisted = [
      review("mangago", "fonte rejeitada depois da aquisição"),
      review("comix", "fonte ainda aceita"),
    ]
    const { merged, recovered } = mergeFreshWithPersistedReviews([], persisted, ["mangago"])
    expect(recovered).toBe(1)
    expect(merged.map((r) => r.source)).toEqual(["comix"])
  })

  it("busca fresca vazia → recupera o pool inteiro (caso do fallback F0.3b antigo)", () => {
    const persisted = [review("mangago", "a"), review("comix", "b")]
    const { merged, recovered } = mergeFreshWithPersistedReviews([], persisted)
    expect(recovered).toBe(2)
    expect(merged).toHaveLength(2)
  })

  it("sem recuperação, devolve o MESMO array fresco (preserva input_hash do cache)", () => {
    const fresh = [review("mangaupdates", "review completa")]
    const { merged, recovered } = mergeFreshWithPersistedReviews(fresh, [
      review("mangaupdates", "review completa"),
    ])
    expect(recovered).toBe(0)
    expect(merged).toBe(fresh)
  })
})

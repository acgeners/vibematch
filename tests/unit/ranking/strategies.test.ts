import { describe, it, expect } from "vitest"
import { rankByCalcScore } from "@/lib/ranking/strategies/rank-by-calc-score"
import { rankByExpectedScore } from "@/lib/ranking/strategies/rank-by-expected-score"
import { rankByDecisionScore } from "@/lib/ranking/strategies/rank-by-decision-score"
import { rankByPersonalFit } from "@/lib/ranking/strategies/rank-by-personal-fit"
import { rankByAlignmentScore } from "@/lib/ranking/strategies/rank-by-alignment-score"
import { rankByMoodWithinTier } from "@/lib/ranking/strategies/rank-by-mood-within-tier"
import { buildShadowRankings } from "@/lib/ranking/strategies/build-shadow-rankings"
import type { RankingCandidate } from "@/lib/ranking/strategies/types"

function cand(p: Partial<RankingCandidate> & { workId: string }): RankingCandidate {
  return {
    predictionSnapshotId: `ps-${p.workId}`,
    displayedRank: 1,
    displayedTier: 1,
    predictedScore: null,
    calcScore: null,
    personalFit: null,
    alignmentScore: null,
    decisionScore: null,
    moodAdjustedScore: null,
    ...p,
  }
}

describe("rankByNumericScore-based strategies", () => {
  it("calc_score ordena por desc; null vai pro fim como inelegível", () => {
    const items = rankByCalcScore([
      cand({ workId: "a", calcScore: 7 }),
      cand({ workId: "b", calcScore: 9 }),
      cand({ workId: "c", calcScore: null }),
    ])
    const eligible = items.filter((i) => i.eligible)
    expect(eligible.map((i) => i.workId)).toEqual(["b", "a"])
    expect(eligible.map((i) => i.rankPosition)).toEqual([1, 2])
    const c = items.find((i) => i.workId === "c")!
    expect(c.eligible).toBe(false)
    expect(c.rankPosition).toBeNull()
    expect(c.exclusionReason).toBe("sem calc_score")
  })

  it("expected_score usa predicted_score do snapshot", () => {
    const items = rankByExpectedScore([
      cand({ workId: "a", predictedScore: 6.2 }),
      cand({ workId: "b", predictedScore: 8.1 }),
    ])
    expect(items.filter((i) => i.eligible).map((i) => i.workId)).toEqual(["b", "a"])
  })

  it("decision_score: ausência vira inelegível (não zero)", () => {
    const items = rankByDecisionScore([
      cand({ workId: "a", decisionScore: 5 }),
      cand({ workId: "b", decisionScore: null }),
    ])
    expect(items.find((i) => i.workId === "b")!.eligible).toBe(false)
    expect(items.find((i) => i.workId === "b")!.exclusionReason).toBe("sem decision_score")
    // 'a' não é empurrado por um 0 implícito de 'b'
    expect(items.find((i) => i.workId === "a")!.rankPosition).toBe(1)
  })

  it("alignment_score registra inelegibilidade com cobertura parcial", () => {
    const items = rankByAlignmentScore([
      cand({ workId: "a", alignmentScore: 80 }),
      cand({ workId: "b", alignmentScore: null }),
      cand({ workId: "c", alignmentScore: 60 }),
    ])
    expect(items.filter((i) => i.eligible).map((i) => i.workId)).toEqual(["a", "c"])
    expect(items.find((i) => i.workId === "b")!.exclusionReason).toBe("sem alignment_score")
  })

  it("personal_fit é determinístico (mesma entrada → mesma saída)", () => {
    const input = [
      cand({ workId: "a", personalFit: 0.5 }),
      cand({ workId: "b", personalFit: 0.7 }),
    ]
    expect(rankByPersonalFit(input)).toEqual(rankByPersonalFit(input))
  })

  it("empates usam workId crescente (determinístico)", () => {
    const items = rankByCalcScore([
      cand({ workId: "z", calcScore: 8 }),
      cand({ workId: "a", calcScore: 8 }),
      cand({ workId: "m", calcScore: 8 }),
    ])
    expect(items.map((i) => i.workId)).toEqual(["a", "m", "z"])
  })

  it("não muta a lista recebida", () => {
    const input = Object.freeze([
      cand({ workId: "a", calcScore: 1 }),
      cand({ workId: "b", calcScore: 2 }),
    ])
    expect(() => rankByCalcScore(input)).not.toThrow()
    expect(input.map((c) => c.workId)).toEqual(["a", "b"])
  })

  it("NaN/Infinity são tratados como ausentes (inelegíveis)", () => {
    const items = rankByCalcScore([
      cand({ workId: "a", calcScore: Number.NaN }),
      cand({ workId: "b", calcScore: Number.POSITIVE_INFINITY }),
      cand({ workId: "c", calcScore: 5 }),
    ])
    expect(items.filter((i) => i.eligible).map((i) => i.workId)).toEqual(["c"])
  })
})

describe("rankByMoodWithinTier", () => {
  it("reordena dentro do tier e NUNCA move obra entre tiers", () => {
    const items = rankByMoodWithinTier([
      cand({ workId: "a", displayedTier: 1, moodAdjustedScore: 5 }),
      cand({ workId: "b", displayedTier: 1, moodAdjustedScore: 8 }),
      cand({ workId: "c", displayedTier: 2, moodAdjustedScore: 9 }), // mood maior, mas tier 2
    ])
    const byWork = new Map(items.map((i) => [i.workId, i]))
    // dentro do tier 1: b (8) antes de a (5)
    expect(byWork.get("b")!.rankPosition).toBe(1)
    expect(byWork.get("a")!.rankPosition).toBe(2)
    // c fica no tier 2 (rank 3) apesar do mood 9 — não cruza a fronteira
    expect(byWork.get("c")!.tier).toBe(2)
    expect(byWork.get("c")!.rankPosition).toBe(3)
  })

  it("inelegível sem mood ou sem tier (com motivo distinto)", () => {
    const items = rankByMoodWithinTier([
      cand({ workId: "a", displayedTier: 1, moodAdjustedScore: null }),
      cand({ workId: "b", displayedTier: null, moodAdjustedScore: 5 }),
    ])
    const a = items.find((i) => i.workId === "a")!
    const b = items.find((i) => i.workId === "b")!
    expect(a.eligible).toBe(false)
    expect(a.exclusionReason).toBe("sem mood ajustado")
    expect(b.eligible).toBe(false)
    expect(b.exclusionReason).toBe("sem tier exibido")
  })

  it("é determinístico e não muta a entrada", () => {
    const input = Object.freeze([
      cand({ workId: "b", displayedTier: 1, moodAdjustedScore: 8 }),
      cand({ workId: "a", displayedTier: 1, moodAdjustedScore: 8 }),
    ])
    const r1 = rankByMoodWithinTier(input)
    const r2 = rankByMoodWithinTier(input)
    expect(r1).toEqual(r2)
    // empate de mood → workId asc
    expect(r1.map((i) => i.workId)).toEqual(["a", "b"])
  })
})

describe("buildShadowRankings", () => {
  const candidates = [
    cand({ workId: "a", displayedRank: 1, displayedTier: 1, calcScore: 7, predictedScore: 7.5, decisionScore: 7.2, personalFit: 0.6, alignmentScore: 70, moodAdjustedScore: 7 }),
    cand({ workId: "b", displayedRank: 2, displayedTier: 1, calcScore: 6, predictedScore: 6.9, decisionScore: 6.5, personalFit: 0.4, alignmentScore: null, moodAdjustedScore: 6.5 }),
  ]

  it("displayed_current reproduz a ordem exibida e é marcada como exibida", () => {
    const results = buildShadowRankings({ candidates, moodActive: false })
    const displayed = results.find((r) => r.key === "displayed_current")!
    expect(displayed.isDisplayedStrategy).toBe(true)
    expect(displayed.items.map((i) => i.rankPosition)).toEqual([1, 2])
    expect(displayed.items[0].tier).toBe(1)
  })

  it("mood_within_tier NÃO é gerada sem mood ativo", () => {
    const results = buildShadowRankings({ candidates, moodActive: false })
    expect(results.find((r) => r.key === "mood_within_tier")).toBeUndefined()
  })

  it("mood_within_tier é gerada quando moodActive", () => {
    const results = buildShadowRankings({ candidates, moodActive: true })
    expect(results.find((r) => r.key === "mood_within_tier")).toBeDefined()
  })

  it("só uma estratégia é marcada como exibida", () => {
    const results = buildShadowRankings({ candidates, moodActive: true })
    expect(results.filter((r) => r.isDisplayedStrategy).length).toBe(1)
  })
})

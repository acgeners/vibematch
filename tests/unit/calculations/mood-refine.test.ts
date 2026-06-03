import { describe, it, expect } from "vitest"
import {
  computeMoodAdjusted,
  computeMoodFit,
  isMoodActive,
  sortByMoodAdjusted,
  MOOD_SWING,
  type MoodWork,
  type MoodRefine,
} from "@/lib/calculations/mood-refine"

// Cluster de 3 obras tecnicamente empatadas (base ~8.2), variando nos atributos.
function cluster(): MoodWork[] {
  return [
    { id: "A", decisionScore: 8.2, scores: { romance: 9, drama: 2, action_adventure: 3 }, totalChapters: 200, personalFit: 0.2, totalVotes: 5000, synopsisQuality: "♥♥♥♥" },
    { id: "B", decisionScore: 8.2, scores: { romance: 5, drama: 8, action_adventure: 6 }, totalChapters: 80,  personalFit: 0.5, totalVotes: 500,  synopsisQuality: "♥♥" },
    { id: "C", decisionScore: 8.1, scores: { romance: 2, drama: 5, action_adventure: 9 }, totalChapters: 120, personalFit: 0.4, totalVotes: 9000, synopsisQuality: "♥" },
  ]
}

const NONE: MoodRefine = { attributes: {} }

describe("isMoodActive", () => {
  it("false quando vazio, true quando há qualquer dimensão", () => {
    expect(isMoodActive(NONE)).toBe(false)
    expect(isMoodActive({ attributes: { romance: 1 } })).toBe(true)
    expect(isMoodActive({ attributes: {}, chapters: "curto" })).toBe(true)
    expect(isMoodActive({ attributes: {}, alignment: true })).toBe(true)
    expect(isMoodActive({ attributes: {}, popularity: true })).toBe(true)
    expect(isMoodActive({ attributes: {}, synopsis: true })).toBe(true)
  })
})

describe("computeMoodAdjusted", () => {
  it("sem dimensão ativa, devolve a base inalterada", () => {
    const adj = computeMoodAdjusted(cluster(), NONE)
    expect(adj.get("A")).toBeCloseTo(8.2, 5)
    expect(adj.get("B")).toBeCloseTo(8.2, 5)
    expect(adj.get("C")).toBeCloseTo(8.1, 5)
  })

  it("priorizar romance coloca a obra de maior romance no topo", () => {
    const order = sortByMoodAdjusted(cluster(), { attributes: { romance: 1 } }).map((w) => w.id)
    expect(order[0]).toBe("A") // romance 9
    expect(order[order.length - 1]).toBe("C") // romance 2
  })

  it("evitar drama (peso -1) penaliza a obra de maior drama", () => {
    const adj = computeMoodAdjusted(cluster(), { attributes: { drama: -1 } })
    expect(adj.get("A")!).toBeGreaterThan(adj.get("B")!) // B tem drama 8 (maior)
  })

  it("peso ++ (2) pesa mais que + (1) na média ponderada", () => {
    // Romance +1 vs Ação +2: a ordem deve pender mais pra Ação (C tem ação 9).
    const so = computeMoodAdjusted(cluster(), { attributes: { romance: 1, action_adventure: 2 } })
    const eq = computeMoodAdjusted(cluster(), { attributes: { romance: 1, action_adventure: 1 } })
    // Com ação valendo o dobro, C (ação alta, romance baixo) sobe relativamente.
    expect(so.get("C")! - so.get("A")!).toBeGreaterThan(eq.get("C")! - eq.get("A")!)
  })

  it("capítulos curto favorece menos capítulos", () => {
    const order = sortByMoodAdjusted(cluster(), { attributes: {}, chapters: "curto" }).map((w) => w.id)
    expect(order[0]).toBe("B") // 80 caps
    expect(order[order.length - 1]).toBe("A") // 200 caps
  })

  it("popularidade favorece mais votos", () => {
    const order = sortByMoodAdjusted(cluster(), { attributes: {}, popularity: true }).map((w) => w.id)
    expect(order[0]).toBe("C") // 9000 votos
  })

  it("sinopse favorece maior interesse (mais ♥)", () => {
    const order = sortByMoodAdjusted(cluster(), { attributes: {}, synopsis: true }).map((w) => w.id)
    expect(order[0]).toBe("A") // ♥♥♥♥
    expect(order[order.length - 1]).toBe("C") // ♥
  })

  it("a correção fica dentro de ±MOOD_SWING da base (limite do MAE)", () => {
    const mood: MoodRefine = { attributes: { romance: 2, drama: -2 }, chapters: "curto", popularity: true, synopsis: true }
    const works = cluster()
    const adj = computeMoodAdjusted(works, mood)
    for (const w of works) {
      expect(Math.abs(adj.get(w.id)! - w.decisionScore!)).toBeLessThanOrEqual(MOOD_SWING + 1e-9)
    }
  })

  it("obra sem Prioridade base fica null e não quebra a média", () => {
    const works: MoodWork[] = [
      ...cluster(),
      { id: "D", decisionScore: null, scores: { romance: 10 }, totalChapters: 50, personalFit: 0.9, totalVotes: 100, synopsisQuality: "♥♥♥" },
    ]
    const adj = computeMoodAdjusted(works, { attributes: { romance: 1 } })
    expect(adj.get("D")).toBeNull()
    expect(adj.get("A")).not.toBeNull()
  })

  it("computeMoodFit retorna null pra todas quando mood vazio", () => {
    expect(computeMoodFit(cluster(), NONE).get("A")).toBeNull()
  })
})

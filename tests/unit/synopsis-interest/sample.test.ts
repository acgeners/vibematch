import { describe, it, expect } from "vitest"
import { buildGoldenSample, summarizeSample, type SampleCandidate } from "@/lib/synopsis-interest/sample"
import { SYNOPSIS_QUALITIES } from "@/types/domain"

function candidates(perLevel: number): SampleCandidate[] {
  const out: SampleCandidate[] = []
  for (const level of SYNOPSIS_QUALITIES) {
    for (let i = 0; i < perLevel; i += 1) out.push({ workId: `${level}-w${i}`, stratum: level })
  }
  return out
}

describe("buildGoldenSample (Plano 3)", () => {
  const pool = candidates(25) // 25/nível disponível; pedimos 20

  it("é determinístico (mesma entrada ⇒ mesma amostra)", () => {
    const a = buildGoldenSample(pool)
    const b = buildGoldenSample(pool.slice().reverse()) // ordem de entrada não importa
    expect(a.map((s) => `${s.slotKey}:${s.workId}:${s.split}`)).toEqual(
      b.map((s) => `${s.slotKey}:${s.workId}:${s.split}`),
    )
  })

  it("seleciona 80 únicos (20/nível) + 10 repetições", () => {
    const slots = buildGoldenSample(pool)
    const sum = summarizeSample(slots)
    expect(sum.uniqueWorks).toBe(80)
    expect(sum.repeats).toBe(10)
    expect(slots.length).toBe(90)
  })

  it("split dev=50 / holdout=30 com TODOS os 4 níveis nos dois", () => {
    const slots = buildGoldenSample(pool)
    const unique = slots.filter((s) => !s.isRepeat)
    expect(unique.filter((s) => s.split === "development").length).toBe(50)
    expect(unique.filter((s) => s.split === "holdout").length).toBe(30)
    const sum = summarizeSample(slots)
    for (const level of SYNOPSIS_QUALITIES) {
      expect(sum.byStratum[level]!.development).toBeGreaterThan(0)
      expect(sum.byStratum[level]!.holdout).toBeGreaterThan(0)
    }
  })

  it("repetições referenciam originais válidos e não contam como únicas", () => {
    const slots = buildGoldenSample(pool)
    const uniqueKeys = new Set(slots.filter((s) => !s.isRepeat).map((s) => s.slotKey))
    const repeats = slots.filter((s) => s.isRepeat)
    for (const r of repeats) {
      expect(r.repeatOf).not.toBeNull()
      expect(uniqueKeys.has(r.repeatOf!)).toBe(true)
    }
  })

  it("shuffleOrder é uma permutação 1..N", () => {
    const slots = buildGoldenSample(pool)
    const orders = slots.map((s) => s.shuffleOrder).sort((a, b) => a - b)
    expect(orders).toEqual(Array.from({ length: slots.length }, (_, i) => i + 1))
  })

  it("nível com menos obras que perLevel pega o que houver", () => {
    const scarce: SampleCandidate[] = [
      ...candidates(25).filter((c) => c.stratum !== "♥"),
      ...Array.from({ length: 5 }, (_, i) => ({ workId: `heart-${i}`, stratum: "♥" as const })),
    ]
    const slots = buildGoldenSample(scarce)
    const hearts = slots.filter((s) => !s.isRepeat && s.stratum === "♥")
    expect(hearts.length).toBe(5) // só 5 disponíveis
  })
})

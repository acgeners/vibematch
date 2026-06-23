import { describe, it, expect } from "vitest"
import {
  predictionSnapshotSchema,
  buildDedupKey,
  getPredictionDateBucket,
  computeDerivedErrors,
  decideResolution,
} from "@/lib/server/predictions/prediction-context"

const U = "11111111-1111-4111-8111-111111111111"
const W = "22222222-2222-4222-8222-222222222222"
const W2 = "33333333-3333-4333-8333-333333333333"
const R1 = "44444444-4444-4444-8444-444444444444"
const R2 = "55555555-5555-4555-8555-555555555555"

// Contexto base de EVENTO individual (sem ranking).
const ev = {
  userId: U,
  workId: W,
  formulaVersion: "v9",
  predictionContext: "work_opened" as const,
  moodKey: null as string | null,
  capturedAt: "2026-06-17T13:00:00.000Z",
  rankingSnapshotId: null as string | null,
}

describe("buildDedupKey — ranking", () => {
  const rk = { ...ev, predictionContext: "recommendation" as const, rankingSnapshotId: R1 }

  it("mesma obra no mesmo ranking → mesma chave (deduplica)", () => {
    expect(buildDedupKey(rk)).toBe(buildDedupKey({ ...rk, capturedAt: "2026-06-17T20:00:00.000Z" }))
  })
  it("mesma obra em dois rankings no mesmo dia → chaves diferentes (dois snapshots)", () => {
    expect(buildDedupKey({ ...rk, rankingSnapshotId: R1 })).not.toBe(
      buildDedupKey({ ...rk, rankingSnapshotId: R2 }),
    )
  })
  it("duas obras no mesmo ranking → chaves diferentes", () => {
    expect(buildDedupKey({ ...rk, workId: W })).not.toBe(buildDedupKey({ ...rk, workId: W2 }))
  })
  it("a chave de ranking ignora fórmula/mood (uma run = uma fórmula)", () => {
    expect(buildDedupKey({ ...rk, formulaVersion: "v10", moodKey: "cozy" })).toBe(buildDedupKey(rk))
  })
})

describe("buildDedupKey — evento individual", () => {
  it("mesma obra/contexto/dia → mesma chave", () => {
    expect(buildDedupKey(ev)).toBe(buildDedupKey({ ...ev, capturedAt: "2026-06-17T18:00:00.000Z" }))
  })
  it("mood diferente → chave nova", () => {
    expect(buildDedupKey({ ...ev, moodKey: "cozy" })).not.toBe(buildDedupKey(ev))
  })
  it("dia diferente (em São Paulo) → chave nova", () => {
    // 2026-06-18T05:00Z = 02:00 SP do dia 18 → bucket muda
    expect(buildDedupKey({ ...ev, capturedAt: "2026-06-18T05:00:00.000Z" })).not.toBe(buildDedupKey(ev))
  })
  it("mudança de fórmula → chave nova", () => {
    expect(buildDedupKey({ ...ev, formulaVersion: "v10" })).not.toBe(buildDedupKey(ev))
  })
  it("contexto diferente → chave nova", () => {
    expect(buildDedupKey({ ...ev, predictionContext: "want_to_read" })).not.toBe(buildDedupKey(ev))
  })
})

describe("getPredictionDateBucket (America/Sao_Paulo)", () => {
  it("23h local (02:00Z do dia seguinte) cai no dia local anterior", () => {
    expect(getPredictionDateBucket(new Date("2026-06-18T02:00:00.000Z"))).toBe("2026-06-17")
  })
  it("00h local (03:00Z) já é o novo dia local", () => {
    expect(getPredictionDateBucket(new Date("2026-06-18T03:00:00.000Z"))).toBe("2026-06-18")
  })
  it("duas horas na mesma noite local → mesmo bucket", () => {
    const a = getPredictionDateBucket(new Date("2026-06-17T23:30:00.000Z")) // 20:30 SP
    const b = getPredictionDateBucket(new Date("2026-06-18T02:30:00.000Z")) // 23:30 SP mesmo dia
    expect(a).toBe(b)
  })
  it("difere de UTC perto da meia-noite", () => {
    const d = new Date("2026-06-18T02:00:00.000Z")
    expect(getPredictionDateBucket(d, "UTC")).toBe("2026-06-18")
    expect(getPredictionDateBucket(d, "America/Sao_Paulo")).toBe("2026-06-17")
  })
})

describe("computeDerivedErrors", () => {
  it("erro = actual - predicted; abs e quadrático coerentes", () => {
    expect(computeDerivedErrors(7, 9)).toEqual({ signedError: 2, absError: 2, sqError: 4 })
    expect(computeDerivedErrors(9, 7)).toEqual({ signedError: -2, absError: 2, sqError: 4 })
  })
})

describe("decideResolution", () => {
  it("pendente → resolve com a nota real", () => {
    const a = decideResolution({ resolvedAt: null, actualUserScore: null }, 9)
    expect(a.kind).toBe("resolve")
    if (a.kind === "resolve") expect(a.actualUserScore).toBe(9)
  })
  it("já resolvido com a MESMA nota → noop (idempotente)", () => {
    expect(decideResolution({ resolvedAt: "2026-06-17T00:00:00Z", actualUserScore: 8 }, 8).kind).toBe("noop")
  })
  it("já resolvido com nota DIFERENTE → relabel (NÃO supersede; preserva original)", () => {
    expect(decideResolution({ resolvedAt: "2026-06-17T00:00:00Z", actualUserScore: 8 }, 6).kind).toBe("relabel")
  })
  it("NUNCA re-resolve um snapshot já resolvido (previsão original preservada)", () => {
    for (const s of [8, 6, 10, 0]) {
      expect(decideResolution({ resolvedAt: "2026-06-17T00:00:00Z", actualUserScore: 8 }, s).kind).not.toBe("resolve")
    }
  })
})

describe("predictionSnapshotSchema", () => {
  const valid = {
    workId: W,
    userId: U,
    predictedScore: 7.5,
    calcScore: 7.1,
    personalFit: 0.4,
    alignmentScore: 80,
    decisionScore: 7.6,
    tier: 1,
    tierBandWidth: 0.5,
    predictedIsStub: false,
    formulaVersion: "v9",
    modelVersion: "claude-sonnet-4-6",
    promptVersion: "v19",
    trainingSampleSize: 191,
    cvMae: 0.58,
    moodKey: null,
    predictionContext: "recommendation",
    rankingSnapshotId: R1,
  }

  it("aceita um snapshot completo válido", () => {
    expect(predictionSnapshotSchema.safeParse(valid).success).toBe(true)
  })
  it("aceita componentes opcionais ausentes (null)", () => {
    const r = predictionSnapshotSchema.safeParse({
      ...valid,
      calcScore: null,
      personalFit: null,
      alignmentScore: null,
      decisionScore: null,
      tier: null,
      tierBandWidth: null,
      modelVersion: null,
      promptVersion: null,
      trainingSampleSize: null,
      cvMae: null,
      rankingSnapshotId: null,
    })
    expect(r.success).toBe(true)
  })
  it("rejeita workId não-uuid, score não-finito, contexto/tier/banda inválidos", () => {
    expect(predictionSnapshotSchema.safeParse({ ...valid, workId: "abc" }).success).toBe(false)
    expect(predictionSnapshotSchema.safeParse({ ...valid, predictedScore: Infinity }).success).toBe(false)
    expect(predictionSnapshotSchema.safeParse({ ...valid, predictionContext: "nope" }).success).toBe(false)
    expect(predictionSnapshotSchema.safeParse({ ...valid, tier: 0 }).success).toBe(false)
    expect(predictionSnapshotSchema.safeParse({ ...valid, tierBandWidth: -1 }).success).toBe(false)
  })
})

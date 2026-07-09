import { describe, it, expect } from "vitest"
import {
  deterministicUuidV5,
  rankingSnapshotIdFor,
  predictionSnapshotSchema,
  buildDedupKey,
} from "@/lib/server/predictions/prediction-context"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe("deterministicUuidV5", () => {
  it("gera UUID v5 válido e estável para o mesmo name", () => {
    const a = deterministicUuidV5("ranking::u::2026-07-08::v1::{}::none")
    const b = deterministicUuidV5("ranking::u::2026-07-08::v1::{}::none")
    expect(a).toBe(b)
    expect(a).toMatch(UUID_RE)
  })
  it("names diferentes geram ids diferentes", () => {
    expect(deterministicUuidV5("a")).not.toBe(deterministicUuidV5("b"))
  })
})

describe("rankingSnapshotIdFor", () => {
  const base = {
    userId: "11111111-1111-1111-1111-111111111111",
    dayBucket: "2026-07-08",
    formulaVersion: "v1",
    filtersKey: '{"publicationStatus":["Completed"]}',
    moodKey: null as string | null,
  }
  it("é determinístico (mesmos inputs → mesmo id) — habilita dedup diário", () => {
    expect(rankingSnapshotIdFor(base)).toBe(rankingSnapshotIdFor(base))
  })
  it("muda quando filtros mudam", () => {
    expect(rankingSnapshotIdFor(base)).not.toBe(
      rankingSnapshotIdFor({ ...base, filtersKey: '{"publicationStatus":["all"]}' }),
    )
  })
  it("muda quando o dia muda", () => {
    expect(rankingSnapshotIdFor(base)).not.toBe(
      rankingSnapshotIdFor({ ...base, dayBucket: "2026-07-09" }),
    )
  })
  it("muda quando o mood muda", () => {
    expect(rankingSnapshotIdFor(base)).not.toBe(
      rankingSnapshotIdFor({ ...base, moodKey: "leve" }),
    )
  })
})

describe("dedup_key com ranking_snapshot_id", () => {
  it("colapsa a mesma obra na mesma run (ignoreDuplicates → no-op)", () => {
    const rid = rankingSnapshotIdFor({
      userId: "u1",
      dayBucket: "2026-07-08",
      formulaVersion: "v1",
      filtersKey: "{}",
      moodKey: null,
    })
    const k1 = buildDedupKey({ userId: "u1", workId: "w1", formulaVersion: "v1", predictionContext: "ranking_snapshot", moodKey: null, capturedAt: "2026-07-08T10:00:00Z", rankingSnapshotId: rid })
    const k2 = buildDedupKey({ userId: "u1", workId: "w1", formulaVersion: "v1", predictionContext: "ranking_snapshot", moodKey: null, capturedAt: "2026-07-08T23:00:00Z", rankingSnapshotId: rid })
    expect(k1).toBe(k2)
    expect(k1).toBe(`ranking::${rid}::work::w1`)
  })
})

describe("predictionSnapshotSchema — rankPosition", () => {
  const valid = {
    workId: "11111111-1111-4111-8111-111111111111",
    userId: "22222222-2222-4222-8222-222222222222",
    predictedScore: 7.5,
    calcScore: 7.2,
    personalFit: 0.3,
    alignmentScore: null,
    decisionScore: 7.5,
    tier: 1,
    tierBandWidth: 0.5,
    predictedIsStub: false,
    formulaVersion: "v1",
    modelVersion: null,
    promptVersion: null,
    trainingSampleSize: 200,
    cvMae: 0.58,
    moodKey: null,
    predictionContext: "ranking_snapshot" as const,
    rankingSnapshotId: "33333333-3333-4333-8333-333333333333",
  }

  it("aceita rankPosition ausente (path de recomendação) → opcional", () => {
    expect(predictionSnapshotSchema.safeParse(valid).success).toBe(true)
  })
  it("aceita rankPosition 1-based positivo", () => {
    expect(predictionSnapshotSchema.safeParse({ ...valid, rankPosition: 3 }).success).toBe(true)
  })
  it("rejeita rankPosition <= 0", () => {
    expect(predictionSnapshotSchema.safeParse({ ...valid, rankPosition: 0 }).success).toBe(false)
  })
  it("aceita rankPosition null", () => {
    expect(predictionSnapshotSchema.safeParse({ ...valid, rankPosition: null }).success).toBe(true)
  })
})

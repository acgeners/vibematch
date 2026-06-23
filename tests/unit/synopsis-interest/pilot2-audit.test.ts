import { describe, it, expect } from "vitest"
import {
  computeBase2ContentSignature,
  computeBase2BindingSignature,
  computeCarryoverMapSignature,
  validateCarryoverMap,
  digestPlanScopeIssues,
  sumPerWorkCost,
  planChanged,
  computeDigestPlanSignature,
  buildHistoricalDigestPlanView,
  DIGEST_PLAN_ARTIFACT_STATUS,
  type Base2WorkEntry,
  type CarryoverMapEntry,
  type DigestPlanItem,
} from "@/lib/synopsis-interest/pilot2-audit"

const works: Base2WorkEntry[] = [
  { workId: "b", canonicalSynopsis: "sinopse B", tags: ["x", "y"], split: "development", stratum: "♥♥" },
  { workId: "a", canonicalSynopsis: "sinopse A", tags: ["y", "x"], split: "holdout", stratum: "♥" },
]

describe("pilot2-audit — base-2 content signature", () => {
  it("independe de captured_at e da ORDEM", () => {
    const s1 = computeBase2ContentSignature(works)
    const s2 = computeBase2ContentSignature([...works].reverse())
    expect(s2).toBe(s1)
    // adicionar captured_at (campo extra) não muda (a função só lê campos conhecidos)
    const withCaptured = works.map((w) => ({ ...w, captured_at: "2026-06-20T00:00:00Z" })) as Base2WorkEntry[]
    expect(computeBase2ContentSignature(withCaptured)).toBe(s1)
  })
  it("muda quando o conteúdo muda", () => {
    expect(computeBase2ContentSignature(works)).not.toBe(
      computeBase2ContentSignature(works.map((w) => (w.workId === "a" ? { ...w, canonicalSynopsis: "outra" } : w))),
    )
  })
})

describe("pilot2-audit — base-2 ↔ manifesto (binding)", () => {
  const base = {
    goldenVersion: "pilot-2",
    baseSnapshotVersion: "base-2",
    base2Signature: "9d181e86",
    base2FileSha256: "ff",
    pilot2ManifestSha256: "aa",
    selectionListHash: "078a6405",
    repeatsListHash: "e8fd516a",
    base1Signature: "634571c2",
    tasteProfileVersion: "v7",
  }
  it("muda se a hash do manifesto, selectionListHash ou repeatsListHash mudar", () => {
    const s0 = computeBase2BindingSignature(base)
    expect(computeBase2BindingSignature({ ...base, pilot2ManifestSha256: "bb" })).not.toBe(s0)
    expect(computeBase2BindingSignature({ ...base, selectionListHash: "zzz" })).not.toBe(s0)
    expect(computeBase2BindingSignature({ ...base, repeatsListHash: "zzz" })).not.toBe(s0)
    expect(computeBase2BindingSignature(base)).toBe(s0) // determinístico
  })
})

describe("pilot2-audit — mapa de carryovers", () => {
  function map(n: number): CarryoverMapEntry[] {
    return Array.from({ length: n }, (_, i) => ({
      workId: `c${i}`,
      pilot1Slot: `S${i}`,
      pilot2Slot: `S${i + 100}`,
      split: "development" as const,
      stratum: "♥♥" as const,
      origin: "carryover" as const,
      displaySignature: "0".repeat(64),
    }))
  }
  it("valida 51 entradas por work_id; assinatura independe da ordem", () => {
    const m = map(51)
    expect(validateCarryoverMap(m).ok).toBe(true)
    expect(computeCarryoverMapSignature(m)).toBe(computeCarryoverMapSignature([...m].reverse()))
  })
  it("rejeita contagem != 51 ou duplicado", () => {
    expect(validateCarryoverMap(map(50)).ok).toBe(false)
    const dup = map(51)
    dup[1] = { ...dup[0] }
    expect(validateCarryoverMap(dup).ok).toBe(false)
  })
})

describe("pilot2-audit — escopo do plano de digests", () => {
  const items: DigestPlanItem[] = [
    { workId: "n1", state: "digest_missing_with_reviews", scale: 10, reviewCorpusSignature: "r1", likelyUsd: 0.045, upperBoundUsd: 0.0675 },
    { workId: "n2", state: "digest_missing_with_reviews", scale: 5, reviewCorpusSignature: "r2", likelyUsd: 0.03975, upperBoundUsd: 0.059625 },
  ]
  const ctx = { carryoverIds: new Set(["carry1"]), noReviewsIds: new Set(["nr1"]), pilot2NewIds: new Set(["n1", "n2"]) }
  it("plano válido: só novas com reviews, sem carryover/no_reviews", () => {
    expect(digestPlanScopeIssues(items, ctx)).toEqual([])
  })
  it("detecta carryover / no_reviews / fora-do-pilot2 / scale<=0", () => {
    const bad: DigestPlanItem[] = [
      ...items,
      { workId: "carry1", state: "x", scale: 3, reviewCorpusSignature: "r", likelyUsd: 0, upperBoundUsd: 0 },
      { workId: "nr1", state: "x", scale: 3, reviewCorpusSignature: "r", likelyUsd: 0, upperBoundUsd: 0 },
      { workId: "n3", state: "x", scale: 0, reviewCorpusSignature: "r", likelyUsd: 0, upperBoundUsd: 0 },
    ]
    const issues = digestPlanScopeIssues(bad, ctx)
    expect(issues.some((i) => /carryover/.test(i))).toBe(true)
    expect(issues.some((i) => /no_reviews/.test(i))).toBe(true)
    expect(issues.some((i) => /fora das 39/.test(i))).toBe(true)
    expect(issues.some((i) => /scale<=0/.test(i))).toBe(true)
  })
  it("agregado = soma por obra (e upper = 1.5 × likely no total)", () => {
    const agg = sumPerWorkCost(items)
    expect(agg.likelyUsd).toBeCloseTo(0.045 + 0.03975, 9)
    expect(agg.upperBoundUsd).toBeCloseTo(0.0675 + 0.059625, 9)
    expect(agg.upperBoundUsd).toBeCloseTo(agg.likelyUsd * 1.5, 9)
  })
})

describe("pilot2-audit — supersessão visível SEM tocar no hash histórico (B2.2N)", () => {
  // mesmas versões v0 do script (SEM corpusPolicyVersion) — reproduz a planSignature histórica
  const input = {
    versions: { model: "claude-sonnet-4-6", digestVersion: "digest-v1", schemaVersion: "v1", promptVersion: "digest-v1", pricingVersion: "static@x", costPolicyVersion: "safety-1.5+micro-0.02" },
    base2Signature: "9d181e86",
    pilot2ManifestSha256: "23885f64",
    eligible: [{ workId: "n1", reviewCorpusSignature: "r1" }, { workId: "n2", reviewCorpusSignature: "r2" }],
  }

  it("prova SIMULTÂNEA: assinatura histórica igual · saída marca superseded · não-executável", () => {
    const view = buildHistoricalDigestPlanView(input)

    // (1) a assinatura histórica é EXATAMENTE computeDigestPlanSignature(input) — status NÃO entra no hash
    expect(view.planSignature).toBe(computeDigestPlanSignature(input))
    // o hash histórico é livre de política: injetar corpusPolicyVersion MUDARIA o hash ⇒
    // como o script NÃO injeta, 295fe2d6… é preservada por construção
    expect(
      computeDigestPlanSignature({ ...input, versions: { ...input.versions, corpusPolicyVersion: "text-only-v1" } }),
    ).not.toBe(view.planSignature)
    expect(Object.keys(input.versions)).not.toContain("corpusPolicyVersion")

    // (2) a saída marca o artefato como SUPERSEDED (v0 → text-only-v1)
    expect(view.status).toMatchObject({
      artifactStatus: "superseded",
      corpusPolicyVersion: "v0",
      supersededBy: "text-only-v1",
    })
    expect(DIGEST_PLAN_ARTIFACT_STATUS.reason).toMatch(/corpus policy changed/i)

    // (3) a auditoria NÃO apresenta o plano como vigente/executável
    expect(view.status.executable).toBe(false)
  })

  it("o status é de SAÍDA: NÃO altera a reprodução determinística da assinatura", () => {
    expect(buildHistoricalDigestPlanView(input).planSignature).toBe(buildHistoricalDigestPlanView(input).planSignature)
  })
})

describe("pilot2-audit — plan_changed", () => {
  it("muda no corpus → plan_changed; assinatura do plano determinística", () => {
    const v = { model: "claude-sonnet-4-6", digestVersion: "digest-v1" }
    const s1 = computeDigestPlanSignature({ versions: v, base2Signature: "b", pilot2ManifestSha256: "m", eligible: [{ workId: "n1", reviewCorpusSignature: "r1" }] })
    const s2 = computeDigestPlanSignature({ versions: v, base2Signature: "b", pilot2ManifestSha256: "m", eligible: [{ workId: "n1", reviewCorpusSignature: "CHANGED" }] })
    expect(planChanged(s1, s2)).toBe(true)
    expect(planChanged(s1, s1)).toBe(false)
    // independe da ordem dos elegíveis
    const sA = computeDigestPlanSignature({ versions: v, base2Signature: "b", pilot2ManifestSha256: "m", eligible: [{ workId: "n1", reviewCorpusSignature: "r1" }, { workId: "n2", reviewCorpusSignature: "r2" }] })
    const sB = computeDigestPlanSignature({ versions: v, base2Signature: "b", pilot2ManifestSha256: "m", eligible: [{ workId: "n2", reviewCorpusSignature: "r2" }, { workId: "n1", reviewCorpusSignature: "r1" }] })
    expect(sA).toBe(sB)
  })
})

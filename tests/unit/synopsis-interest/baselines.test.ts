import { describe, it, expect } from "vitest"
import { baselineD1, baselineD2, type BaselineWork } from "@/lib/synopsis-interest/baselines"
import type { TasteProfilePayload } from "@/lib/ai-recommendation/types"

const profile: TasteProfilePayload = {
  loved_tags: [
    { name: "romance", group: null, strength: 0.9 },
    { name: "isekai", group: null, strength: 0.7 },
    { name: "strong female lead", group: null, strength: 0.8 },
  ],
  avoided_tags: [{ name: "tragedy", group: null, strength: 0.9 }],
  loved_themes: ["slow burn romance", "strong female lead", "political intrigue"],
  avoided_themes: ["rape", "incest"],
  criterion_preferences: {},
  narrative_patterns: [],
  summary: "",
}

const longSyn =
  "A determined heroine navigates a slow burn romance amid political intrigue in a reborn isekai world, building alliances while protecting her family."

describe("baselineD1 (tags only)", () => {
  it("é determinístico", () => {
    const w: BaselineWork = { tags: [{ name: "romance", group: null }], synopsis: longSyn }
    expect(baselineD1(w, profile)).toEqual(baselineD1(w, profile))
  })
  it("obra com tags amadas pontua MAIS que obra com tag evitada", () => {
    const loved: BaselineWork = { tags: [{ name: "romance", group: null }, { name: "isekai", group: null }], synopsis: null }
    const avoided: BaselineWork = { tags: [{ name: "tragedy", group: null }], synopsis: null }
    expect(baselineD1(loved, profile).score).toBeGreaterThan(baselineD1(avoided, profile).score)
    expect(baselineD1(loved, profile).level).toBeGreaterThanOrEqual(baselineD1(avoided, profile).level)
  })
  it("retorna nível 1..4 e quality coerente", () => {
    const r = baselineD1({ tags: [{ name: "romance", group: null }], synopsis: null }, profile)
    expect(r.level).toBeGreaterThanOrEqual(1)
    expect(r.level).toBeLessThanOrEqual(4)
    expect(["♥", "♥♥", "♥♥♥", "♥♥♥♥"]).toContain(r.quality)
  })
})

describe("tags=[] (caso S078: no_tags) — determinístico, sem divisão por zero", () => {
  it("D1 com tags=[] retorna nível válido 1..4 e score finito (sem NaN)", () => {
    const r = baselineD1({ tags: [], synopsis: longSyn }, profile)
    expect(r.level).toBeGreaterThanOrEqual(1)
    expect(r.level).toBeLessThanOrEqual(4)
    expect(Number.isFinite(r.score)).toBe(true)
    expect(baselineD1({ tags: [], synopsis: longSyn }, profile)).toEqual(r) // determinístico
  })
  it("D2 com tags=[] ainda extrai sinal da sinopse e é finito", () => {
    const r = baselineD2({ tags: [], synopsis: longSyn }, profile)
    expect(r.level).toBeGreaterThanOrEqual(1)
    expect(r.level).toBeLessThanOrEqual(4)
    expect(Number.isFinite(r.score)).toBe(true)
    expect(baselineD2({ tags: [], synopsis: longSyn }, profile)).toEqual(r)
  })
  it("D1/D2 com tags=[] E sinopse=null não quebram (piso determinístico)", () => {
    expect(Number.isFinite(baselineD1({ tags: [], synopsis: null }, profile).score)).toBe(true)
    expect(Number.isFinite(baselineD2({ tags: [], synopsis: null }, profile).score)).toBe(true)
  })
})

describe("baselineD2 (tags + keywords)", () => {
  it("é determinístico", () => {
    const w: BaselineWork = { tags: [{ name: "romance", group: null }], synopsis: longSyn }
    expect(baselineD2(w, profile)).toEqual(baselineD2(w, profile))
  })

  it("sinopse placeholder/curta → pouco-informativo (nível baixo)", () => {
    const r = baselineD2({ tags: [{ name: "romance", group: null }], synopsis: "Sinopse indisponível." }, profile)
    expect(r.signals.lowInfo).toBe(1)
    expect(r.level).toBeLessThanOrEqual(2)
  })

  it("temas amados no texto REFORÇAM vs D1 (mesmas tags)", () => {
    const w: BaselineWork = { tags: [{ name: "romance", group: null }], synopsis: longSyn }
    const d1 = baselineD1(w, profile).score
    const d2 = baselineD2(w, profile).score
    expect(d2).toBeGreaterThan(d1)
    expect(baselineD2(w, profile).signals.coverage).toBeGreaterThan(0)
  })

  it("tema evitado no texto DERRUBA o score", () => {
    const clean: BaselineWork = { tags: [{ name: "romance", group: null }], synopsis: "A gentle slow burn romance between two rivals." }
    const withAvoided: BaselineWork = { tags: [{ name: "romance", group: null }], synopsis: "A slow burn romance shadowed by rape and abuse throughout the plot." }
    expect(baselineD2(withAvoided, profile).score).toBeLessThan(baselineD2(clean, profile).score)
    expect(baselineD2(withAvoided, profile).signals.avoidedHits).toBeGreaterThan(0)
  })

  it("negação evita falso hit de tema evitado", () => {
    const negated: BaselineWork = { tags: [{ name: "romance", group: null }], synopsis: "A wholesome story with no rape, no incest, just a slow burn romance and political intrigue." }
    // 'rape'/'incest' aparecem mas negados → não contam como avoidedHits
    expect(baselineD2(negated, profile).signals.avoidedHits).toBe(0)
  })
})

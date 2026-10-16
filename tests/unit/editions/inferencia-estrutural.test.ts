import { describe, expect, it } from "vitest"
import { ADULT_LABEL_FLOOR, R15_FROM_R19_CEILING } from "@/lib/ai-evaluation/adult-content-rules"
import {
  ADULT_EDITION_SEXUAL_FLOOR,
  LEGACY_STANDARD_BASE_RULE,
  SEXUAL_EXTERNAL_RATINGS,
  STANDARD_EDITION_BASE,
  STRUCTURAL_RULES,
  planStructuralInference,
  sexualNatureSignals,
  standardEditionLabel,
} from "@/lib/editions/structural-inference"
import type { CurrentEditionRow, StructuralFacts, StructuralTagFacts } from "@/lib/editions/structural-inference"

/**
 * A política 6/7 da nota de Conteúdo Adulto por versão (aprovada em 2026-10-15) — módulo puro.
 * Os casos com nome de obra saíram do catálogo real (ensaio de 2026-10-15 nas 140 mixed).
 */

const tag = (name: string, tier: string | null, subgroup: string | null, flags: { ind?: boolean; strong?: boolean } = {}): StructuralTagFacts => ({
  name,
  tier,
  subgroup,
  adultIndicator: flags.ind ?? true,
  adultIndicatorStrong: flags.strong ?? false,
})
const ATO = tag("Cunnilingus", "explicit", "explicit", { strong: true })
const R19 = tag("R19", "label", "rating-labels", { strong: true })
const ADULT = tag("Adult", "label", "rating-labels")
const WHIPPING = tag("Whipping", null, "explicit")
const SEXUAL_ASSAULT = tag("Sexual Assault", null, "sexual-themes", { ind: false })

const row = (source: CurrentEditionRow["source"], score: number | null, extra: Partial<CurrentEditionRow> = {}): CurrentEditionRow => ({
  source,
  score,
  decidedBy: "audit",
  rule: null,
  ...extra,
})
const BASE_LEGADA = row("inferred_base", 5, { rule: LEGACY_STANDARD_BASE_RULE })
const NAO_AVALIADO = row("not_rated", null)

const fatos = (over: Partial<StructuralFacts> = {}): StructuralFacts => ({
  isMixed: true,
  r18ExtraChapters: false,
  standardLines: ["Original Webtoon: R15: Ridibooks"],
  tags: [ATO, R19],
  muGenres: [],
  externalRatings: [],
  current: { normal: BASE_LEGADA, r18: NAO_AVALIADO },
  ...over,
})

describe("os valores derivam da régua, não são números soltos", () => {
  it("base da padrão = teto R15 da avaliação; piso da adulta = piso do rótulo adulto", () => {
    expect(STANDARD_EDITION_BASE).toBe(R15_FROM_R19_CEILING)
    expect(ADULT_EDITION_SEXUAL_FLOOR).toBe(ADULT_LABEL_FLOOR)
    expect([STANDARD_EDITION_BASE, ADULT_EDITION_SEXUAL_FLOOR]).toEqual([6, 7])
  })
  it("classificação externa que confirma = a que a régua já põe no piso adulto ou acima", () => {
    expect([...SEXUAL_EXTERNAL_RATINGS].sort()).toEqual(["erotica", "pornographic"])
  })
})

describe("caso A — R15 + natureza sexual confirmada", () => {
  it("padrão vai a 6 (sobre a base legada 5,0) e adulta a 7 (sobre o 'não avaliado' da auditoria)", () => {
    const p = planStructuralInference(fatos())
    expect(p.decisions.normal).toMatchObject({ kind: "infer", target: { score: 6, rule: STRUCTURAL_RULES.standardBase }, over: BASE_LEGADA })
    expect(p.decisions.r18).toMatchObject({ kind: "infer", target: { score: 7, rule: STRUCTURAL_RULES.adultFloor }, over: NAO_AVALIADO })
  })
  it("obra mixed nova (sem nenhuma linha) recebe as duas", () => {
    const p = planStructuralInference(fatos({ current: {} }))
    expect(p.decisions.normal).toMatchObject({ kind: "infer", over: null })
    expect(p.decisions.r18).toMatchObject({ kind: "infer", over: null })
  })
})

describe("o que confirma a natureza sexual — e o que NÃO", () => {
  const confirma = (f: Partial<Parameters<typeof sexualNatureSignals>[0]>) =>
    sexualNatureSignals({ tags: [], muGenres: [], externalRatings: [], adultEditionRow: null, ...f }).length > 0

  it("confirmam: ato explícito, circunstância sexual com piso, tag forte do subgrupo, Sexual Content, Smut no MU, erotica/pornographic", () => {
    expect(confirma({ tags: [ATO] })).toBe(true)
    expect(confirma({ tags: [tag("First-Time Intercourse", "label", "sexual-themes", { ind: false })] })).toBe(true)
    expect(confirma({ tags: [tag("Creampie", null, "sexual-acts", { strong: true })] })).toBe(true)
    expect(confirma({ tags: [tag("Sexual Content", "label", "rating-labels")] })).toBe(true)
    expect(confirma({ muGenres: ["Smut"] })).toBe(true)
    expect(confirma({ externalRatings: ["erotica"] })).toBe(true)
  })

  it("rótulo de IDADE sozinho não confirma (Adult, Mature, R19 — tag ou gênero)", () => {
    expect(confirma({ tags: [ADULT, R19], muGenres: ["Adult", "Mature"] })).toBe(false)
  })

  it("violência não confirma — Whipping está no subgrupo 'explicit', mas sem nível de nota (caso real: Torture/Whipping)", () => {
    expect(confirma({ tags: [WHIPPING, tag("Torture", null, "oppression", { ind: false }), R19, ADULT] })).toBe(false)
  })

  it("descritor sem piso não confirma (Big Breasts, Nudity) e violência sexual também não (mig 203)", () => {
    expect(confirma({ tags: [tag("Big Breasts", null, "explicit"), tag("Nudity", null, "sexual-themes"), SEXUAL_ASSAULT] })).toBe(false)
  })

  it("classificação 'suggestive' é faixa 4–6: não confirma", () => {
    expect(confirma({ externalRatings: ["suggestive"] })).toBe(false)
  })

  it("versão adulta já avaliada (fonte forte) confirma; o PRÓPRIO piso inferido não se confirma sozinho", () => {
    expect(confirma({ adultEditionRow: row("reused_existing", 9) })).toBe(true)
    expect(confirma({ adultEditionRow: row("curator_confirmed", 9, { decidedBy: "curator" }) })).toBe(true)
    expect(confirma({ adultEditionRow: row("inferred_base", 7, { rule: STRUCTURAL_RULES.adultFloor }) })).toBe(false)
  })

  it("mixed sem natureza sexual: nenhuma das duas é inferida (a base legada vira conflito)", () => {
    const p = planStructuralInference(fatos({ tags: [R19, ADULT], muGenres: ["Adult"] }))
    expect(p.decisions.r18).toMatchObject({ kind: "none", reason: /não confirmada/ })
    expect(p.decisions.normal).toMatchObject({ kind: "conflict", reason: /não confirmada/ })
  })

  it("adulta só por violência: nenhuma inferência", () => {
    const p = planStructuralInference(fatos({ tags: [WHIPPING, R19], current: {} }))
    expect(p.decisions.r18.kind).toBe("none")
    expect(p.decisions.normal.kind).toBe("none")
  })
})

describe("subtipos em que a padrão NÃO recebe base", () => {
  it("extras: padrão sem base; adulta recebe o piso se sexual", () => {
    const p = planStructuralInference(fatos({ r18ExtraChapters: true, current: { normal: NAO_AVALIADO, r18: NAO_AVALIADO } }))
    expect(p.decisions.normal).toMatchObject({ kind: "none", reason: "conteúdo adulto só nos extras" })
    expect(p.decisions.r18).toMatchObject({ kind: "infer", target: { score: 7 } })
  })
  it("R12 e R17: padrão sem base (a base legada vira conflito); adulta segue a regra", () => {
    for (const [linha, rotulo] of [["Original Webtoon: R12: Naver", "abaixo de R15"], ["Official Translations: R17: Tapas", "R17"]] as const) {
      const p = planStructuralInference(fatos({ standardLines: [linha] }))
      expect(p.standardLabel).toBe(rotulo)
      expect(p.decisions.normal).toMatchObject({ kind: "conflict", reason: new RegExp(rotulo) })
      expect(p.decisions.r18).toMatchObject({ kind: "infer", target: { score: 7 } })
    }
  })
})

describe("notas mais fortes nunca são tocadas", () => {
  it.each([
    ["reused_existing", row("reused_existing", 9)],
    ["ai_evaluated", row("ai_evaluated", 8, { decidedBy: "ai" })],
    ["curator_confirmed", row("curator_confirmed", 9, { decidedBy: "curator" })],
  ] as const)("%s na adulta e na padrão ⇒ preserve", (_n, forte) => {
    const p = planStructuralInference(fatos({ current: { normal: forte, r18: forte } }))
    expect(p.decisions.normal.kind).toBe("preserve")
    expect(p.decisions.r18.kind).toBe("preserve")
  })
  it("'não avaliado' registrado pela CURADORIA é decisão humana: preserve", () => {
    const p = planStructuralInference(fatos({ current: { r18: row("not_rated", null, { decidedBy: "curator" }) } }))
    expect(p.decisions.r18).toMatchObject({ kind: "preserve", reason: /curadoria/ })
  })
})

describe("ciclo de vida: reprocessar, evidência que chega depois, evidência que some", () => {
  const PROPRIA_PADRAO = row("inferred_base", 6, { rule: STRUCTURAL_RULES.standardBase })
  const PROPRIO_PISO = row("inferred_base", 7, { rule: STRUCTURAL_RULES.adultFloor })

  it("inferência própria ainda válida: keep (reprocessar é idempotente)", () => {
    const p = planStructuralInference(fatos({ current: { normal: PROPRIA_PADRAO, r18: PROPRIO_PISO } }))
    expect(p.decisions.normal.kind).toBe("keep")
    expect(p.decisions.r18.kind).toBe("keep")
  })

  it("sinal sexual chegando DEPOIS de a obra virar mixed: antes nada, depois o piso", () => {
    const antes = planStructuralInference(fatos({ tags: [R19], current: {} }))
    expect(antes.decisions.r18.kind).toBe("none")
    const depois = planStructuralInference(fatos({ tags: [R19, ATO], current: {} }))
    expect(depois.decisions.r18).toMatchObject({ kind: "infer", target: { score: 7 } })
  })

  it("sinal corrigido/removido: as inferências PRÓPRIAS são retiradas", () => {
    const p = planStructuralInference(fatos({ tags: [R19], current: { normal: PROPRIA_PADRAO, r18: PROPRIO_PISO } }))
    expect(p.decisions.normal).toMatchObject({ kind: "retract", reason: /não confirmada/ })
    expect(p.decisions.r18).toMatchObject({ kind: "retract", reason: /não confirmada/ })
  })

  it("a padrão deixa de valer quando a curadoria marca extras; o piso da adulta fica", () => {
    const p = planStructuralInference(fatos({ r18ExtraChapters: true, current: { normal: PROPRIA_PADRAO, r18: PROPRIO_PISO } }))
    expect(p.decisions.normal).toMatchObject({ kind: "retract", reason: "conteúdo adulto só nos extras" })
    expect(p.decisions.r18.kind).toBe("keep")
  })

  it("obra que deixou de ser mixed: retira as próprias e não toca a base legada (conflito)", () => {
    const p = planStructuralInference(fatos({ isMixed: false, current: { normal: BASE_LEGADA, r18: PROPRIO_PISO } }))
    expect(p.decisions.r18).toMatchObject({ kind: "retract", reason: "obra não é mixed" })
    expect(p.decisions.normal).toMatchObject({ kind: "conflict" })
  })

  it("a base legada só é ATUALIZADA (5 → 6), nunca retirada sozinha", () => {
    expect(planStructuralInference(fatos()).decisions.normal).toMatchObject({ kind: "infer", over: BASE_LEGADA })
    expect(planStructuralInference(fatos({ tags: [] })).decisions.normal.kind).toBe("conflict")
  })
})

describe("rótulo da versão padrão — os dois formatos de evidência", () => {
  it("auditoria e save do MU: R15/R16 sustentam; abaixo de R15 e R17 excluem; sem rótulo é desconhecido", () => {
    expect(standardEditionLabel(["Original Webtoon: R15: Ridibooks", "Official Translations: R15: English"])).toBe("R15")
    expect(standardEditionLabel(["Original Webtoon: R16: Lezhin"])).toBe("R15")
    expect(standardEditionLabel(["Original Webtoon: R12: Naver"])).toBe("abaixo de R15")
    expect(standardEditionLabel(["Original Webtoon: R15", "Official Translations: R17: Tapas"])).toBe("R17")
    expect(standardEditionLabel(["Original Webtoon: Ridibooks"])).toBe("desconhecido")
    expect(standardEditionLabel([])).toBe("desconhecido")
  })
})

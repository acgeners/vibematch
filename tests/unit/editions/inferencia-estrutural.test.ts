import { describe, expect, it } from "vitest"
import { EXPLICIT_FLOOR, R15_FROM_R19_CEILING } from "@/lib/ai-evaluation/adult-content-rules"
import {
  ADULT_EDITION_SEXUAL_FLOOR,
  EDITION_EXPLICIT_THRESHOLD,
  LEGACY_STANDARD_BASE_RULE,
  SEXUAL_EXTERNAL_RATINGS,
  STANDARD_EDITION_BASE,
  STRUCTURAL_RULES,
  TAG_SOURCES_THAT_CONFIRM,
  decisionWrites,
  editionBoundsViolation,
  independentSexualSignals,
  planStructuralInference,
  sexualNatureSignals,
  standardEditionLabel,
} from "@/lib/editions/structural-inference"
import type { CurrentEditionRow, StructuralFacts, StructuralTagFacts } from "@/lib/editions/structural-inference"

/**
 * A política da nota de Conteúdo Adulto por versão (6/7 em 2026-10-15; fronteira editorial 6/9 em
 * 2026-10-16) — módulo puro.
 * Os casos com nome de obra saíram do catálogo real (ensaio de 2026-10-15 nas 140 mixed).
 */

const tag = (
  name: string,
  tier: string | null,
  subgroup: string | null,
  flags: { ind?: boolean; strong?: boolean; source?: string | null } = {},
): StructuralTagFacts => ({
  name,
  tier,
  subgroup,
  adultIndicator: flags.ind ?? true,
  adultIndicatorStrong: flags.strong ?? false,
  // `null` = legado/formulário/fontes: a procedência mais comum do catálogo.
  source: "source" in flags ? flags.source : null,
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
  it("base da padrão = teto R15 da avaliação; piso da adulta = limiar explícito da régua", () => {
    expect(STANDARD_EDITION_BASE).toBe(R15_FROM_R19_CEILING)
    expect(ADULT_EDITION_SEXUAL_FLOOR).toBe(EXPLICIT_FLOOR)
    expect([STANDARD_EDITION_BASE, ADULT_EDITION_SEXUAL_FLOOR]).toEqual([6, 9])
  })
  it("classificação externa que confirma = a que a régua já põe no piso adulto ou acima", () => {
    expect([...SEXUAL_EXTERNAL_RATINGS].sort()).toEqual(["erotica", "pornographic"])
  })
})

describe("caso A — R15 + natureza sexual confirmada", () => {
  it("padrão vai a 6 (sobre a base legada 5,0) e adulta a 9 (sobre o 'não avaliado' da auditoria)", () => {
    const p = planStructuralInference(fatos())
    expect(p.decisions.normal).toMatchObject({ kind: "infer", target: { score: 6, rule: STRUCTURAL_RULES.standardBase }, over: BASE_LEGADA })
    expect(p.decisions.r18).toMatchObject({ kind: "infer", target: { score: 9, rule: STRUCTURAL_RULES.adultFloor }, over: NAO_AVALIADO })
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
    expect(confirma({ adultEditionRow: row("inferred_base", 9, { rule: STRUCTURAL_RULES.adultFloor }) })).toBe(false)
    // Abaixo da faixa explícita a própria nota não confirma: não pode criar o piso que violaria.
    expect(confirma({ adultEditionRow: row("reused_existing", 8.5) })).toBe(false)
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

describe("a procedência do vínculo da tag decide se ela pode confirmar (2026-10-16)", () => {
  const sinais = (f: Partial<Parameters<typeof sexualNatureSignals>[0]>) =>
    sexualNatureSignals({ tags: [], muGenres: [], externalRatings: [], adultEditionRow: null, ...f })
  const sexualContent = (source: string | null | undefined) => tag("Sexual Content", "label", "rating-labels", { source })
  const AGE_E_VIOLENCIA = [ADULT, R19, WHIPPING, tag("Gore", null, "violence", { ind: false })]

  it("a lista de permissão é exatamente legado/fontes, backfill das fontes e curadoria", () => {
    expect([...TAG_SOURCES_THAT_CONFIRM].sort((a, b) => String(a).localeCompare(String(b)))).toEqual(["curadoria", "imported", null])
  })

  it("Sexual Content de fonte externa (backfill), de curadoria e do legado/formulário confirma", () => {
    for (const source of ["imported", "curadoria", null]) expect(sinais({ tags: [sexualContent(source)] })).toEqual(["tag sexual: Sexual Content"])
  })

  it("Sexual Content só inferida pela IA NÃO confirma — é a prosa que a política já recusa, com outro nome", () => {
    expect(sinais({ tags: [sexualContent("ai_inferred")] })).toEqual([])
  })

  it("a exclusão é da PROCEDÊNCIA, não do tipo de tag: ato explícito inferido pela IA também não confirma", () => {
    expect(sinais({ tags: [tag("Cunnilingus", "explicit", "explicit", { strong: true, source: "ai_inferred" })] })).toEqual([])
    expect(sinais({ tags: [tag("First-Time Intercourse", "label", "sexual-themes", { ind: false, source: "ai_inferred" })] })).toEqual([])
  })

  it("procedência fora da lista (marcador de sinopse, nova) e procedência NÃO LIDA não confirmam", () => {
    expect(sinais({ tags: [sexualContent("synopsis_marker")] })).toEqual([])
    expect(sinais({ tags: [sexualContent("escritor_novo")] })).toEqual([])
    expect(sinais({ tags: [sexualContent(undefined)] })).toEqual([])
  })

  it("tag de IA + outro sinal forte: confirma pelo OUTRO sinal, e a tag de IA não aparece como evidência", () => {
    expect(sinais({ tags: [sexualContent("ai_inferred")], muGenres: ["Smut"] })).toEqual(["gênero do MangaUpdates: smut"])
    expect(sinais({ tags: [sexualContent("ai_inferred")], externalRatings: ["erotica"] })).toEqual(["classificação externa: erotica"])
    expect(sinais({ tags: [sexualContent("ai_inferred"), tag("First-Time Intercourse", "label", "sexual-themes", { ind: false })] })).toEqual([
      "tag sexual: First-Time Intercourse",
    ])
  })

  it("o resto da régua não muda: Smut/Hentai do MU e erotica/pornographic confirmam; idade e violência não", () => {
    expect(sinais({ muGenres: ["Smut"] })).toEqual(["gênero do MangaUpdates: smut"])
    expect(sinais({ muGenres: ["Hentai"] })).toEqual(["gênero do MangaUpdates: hentai"])
    expect(sinais({ externalRatings: ["erotica"] })).toEqual(["classificação externa: erotica"])
    expect(sinais({ externalRatings: ["pornographic"] })).toEqual(["classificação externa: pornographic"])
    expect(sinais({ tags: AGE_E_VIOLENCIA, muGenres: ["Adult", "Mature"], externalRatings: ["suggestive"] })).toEqual([])
  })

  describe("as três adultas do legado que se confirmavam só por tag de IA (fatos lidos da nuvem em 2026-10-16)", () => {
    const SC_IA = sexualContent("ai_inferred")
    const casos: Array<[string, Partial<StructuralFacts>]> = [
      ["Lucia", { tags: [SC_IA, ADULT, R19], muGenres: ["Mature"], externalRatings: ["suggestive"], current: { normal: row("reused_existing", 6), r18: NAO_AVALIADO } }],
      ["The Tyrant's Comfort Doll", { tags: [SC_IA, tag("Nudity", null, "sexual-themes"), R19], muGenres: ["Adult"] }],
      ["I Became the Villain's Mother", { tags: [SC_IA, R19], muGenres: [] }],
    ]
    for (const [obra, f] of casos) {
      it(`${obra}: a adulta segue sem nota — e a base legada da padrão vira conflito, não sobe para 6`, () => {
        const p = planStructuralInference(fatos(f))
        expect(p.sexualSignals).toEqual([])
        expect(p.decisions.r18).toMatchObject({ kind: "none", reason: /não confirmada/ })
        expect(p.decisions.normal.kind).toBe(obra === "Lucia" ? "preserve" : "conflict")
      })
    }

    it("contraprova: obras com tag de IA E sinal forte (Lycan, Tangled Up, Villainess in Love) seguem com o piso", () => {
      const comOutroSinal: Array<Partial<StructuralFacts>> = [
        { tags: [SC_IA, R19], muGenres: ["Romance", "Smut"] },
        { tags: [SC_IA, R19], externalRatings: ["erotica"] },
        { tags: [SC_IA, tag("Drunken Intercourse", "label", "sexual-themes", { ind: false }), tag("First-Time Intercourse", "label", "sexual-themes", { ind: false }), R19] },
      ]
      for (const f of comOutroSinal) {
        const p = planStructuralInference(fatos(f))
        expect(p.decisions.r18).toMatchObject({ kind: "infer", target: { score: 9, rule: STRUCTURAL_RULES.adultFloor } })
        expect(p.sexualSignals.some((s) => s.includes("Sexual Content"))).toBe(false)
      }
    })
  })
})

describe("subtipos em que a padrão NÃO recebe base", () => {
  it("extras: padrão sem base; adulta recebe o piso se sexual", () => {
    const p = planStructuralInference(fatos({ r18ExtraChapters: true, current: { normal: NAO_AVALIADO, r18: NAO_AVALIADO } }))
    expect(p.decisions.normal).toMatchObject({ kind: "none", reason: "conteúdo adulto só nos extras" })
    expect(p.decisions.r18).toMatchObject({ kind: "infer", target: { score: 9 } })
  })
  it("R12 e R17: padrão sem base (a base legada vira conflito); adulta segue a regra", () => {
    for (const [linha, rotulo] of [["Original Webtoon: R12: Naver", "abaixo de R15"], ["Official Translations: R17: Tapas", "R17"]] as const) {
      const p = planStructuralInference(fatos({ standardLines: [linha] }))
      expect(p.standardLabel).toBe(rotulo)
      expect(p.decisions.normal).toMatchObject({ kind: "conflict", reason: new RegExp(rotulo) })
      expect(p.decisions.r18).toMatchObject({ kind: "infer", target: { score: 9 } })
    }
  })
})

describe("notas mais fortes nunca são tocadas", () => {
  it.each([
    ["reused_existing", row("reused_existing", 6), row("reused_existing", 9)],
    ["ai_evaluated", row("ai_evaluated", 5, { decidedBy: "ai" }), row("ai_evaluated", 9.5, { decidedBy: "ai" })],
    ["curator_confirmed", row("curator_confirmed", 4, { decidedBy: "curator" }), row("curator_confirmed", 9, { decidedBy: "curator" })],
  ] as const)("%s dentro da fronteira, na adulta e na padrão ⇒ preserve", (_n, padrao, adulta) => {
    const p = planStructuralInference(fatos({ current: { normal: padrao, r18: adulta } }))
    expect(p.decisions.normal.kind).toBe("preserve")
    expect(p.decisions.r18.kind).toBe("preserve")
  })
  it("'não avaliado' registrado pela CURADORIA é decisão humana: preserve", () => {
    const p = planStructuralInference(fatos({ current: { r18: row("not_rated", null, { decidedBy: "curator" }) } }))
    expect(p.decisions.r18).toMatchObject({ kind: "preserve", reason: /curadoria/ })
  })
})

describe("a FRONTEIRA editorial: padrão abaixo do explícito, adulta sexual a partir dele (2026-10-16)", () => {
  const SMUT_E_EROTICA = { muGenres: ["Romance", "Smut"], externalRatings: ["erotica"] }

  it("o limiar é o da régua (EXPLICIT_FLOOR = 9): o piso da adulta É o limiar, e a base da padrão fica abaixo", () => {
    expect(EDITION_EXPLICIT_THRESHOLD).toBe(EXPLICIT_FLOOR)
    expect(EDITION_EXPLICIT_THRESHOLD).toBe(9)
    expect(ADULT_EDITION_SEXUAL_FLOOR).toBe(EDITION_EXPLICIT_THRESHOLD)
    expect(STANDARD_EDITION_BASE).toBeLessThan(EDITION_EXPLICIT_THRESHOLD)
    // A automação nunca produz nota fora da fronteira que ela mesma impõe.
    expect(editionBoundsViolation("normal", STANDARD_EDITION_BASE, true)).toBeNull()
    expect(editionBoundsViolation("r18", ADULT_EDITION_SEXUAL_FLOOR, true)).toBeNull()
  })

  it("o predicado: padrão ≥ 9 viola sempre; adulta < 9 viola só com natureza sexual confirmada", () => {
    expect(editionBoundsViolation("normal", 8.5, false)).toBeNull()
    expect(editionBoundsViolation("normal", 9, false)).toBe("padrao_na_faixa_explicita")
    expect(editionBoundsViolation("r18", 8.5, true)).toBe("adulta_abaixo_do_explicito")
    expect(editionBoundsViolation("r18", 6, true)).toBe("adulta_abaixo_do_explicito")
    expect(editionBoundsViolation("r18", 9, true)).toBeNull()
    expect(editionBoundsViolation("r18", 10, true)).toBeNull()
    expect(editionBoundsViolation("r18", 6, false)).toBeNull()
  })

  it("Lily Busch's Fake Marriage: R18 6,0 da curadoria vira CONFLITO — nunca sobrescrita pela inferência", () => {
    const p = planStructuralInference(
      fatos({
        tags: [tag("Sexual Content", "label", "rating-labels", { source: "ai_inferred" }), R19],
        ...SMUT_E_EROTICA,
        current: { normal: BASE_LEGADA, r18: row("curator_confirmed", 6, { decidedBy: "curator" }) },
      }),
    )
    expect(p.sexualSignals).toEqual(["gênero do MangaUpdates: smut", "classificação externa: erotica"])
    expect(p.decisions.r18).toMatchObject({ kind: "conflict", reason: /curator_confirmed.*abaixo da faixa explícita/ })
    expect(decisionWrites(p.decisions.r18)).toBe(false)
    // A padrão dela segue a política normal (base 6 sobre a legada 5,0).
    expect(p.decisions.normal).toMatchObject({ kind: "infer", target: { score: 6 } })
  })

  it("nota forte da padrão na faixa explícita também é conflito; adulta forte < 9 SEM natureza sexual é preservada", () => {
    expect(planStructuralInference(fatos({ current: { normal: row("reused_existing", 9) } })).decisions.normal).toMatchObject({ kind: "conflict" })
    const violencia = planStructuralInference(fatos({ tags: [WHIPPING, R19], current: { r18: row("ai_evaluated", 7.5, { decidedBy: "ai" }) } }))
    expect(violencia.decisions.r18.kind).toBe("preserve")
  })

  it("a validação da curadoria lê a natureza sexual SEM a nota da própria versão (ela não trava a si mesma)", () => {
    const so_a_nota = { tags: [], muGenres: [], externalRatings: [] }
    expect(sexualNatureSignals({ ...so_a_nota, adultEditionRow: row("curator_confirmed", 9.5, { decidedBy: "curator" }) })).not.toEqual([])
    expect(independentSexualSignals(so_a_nota)).toEqual([])
    expect(independentSexualSignals({ tags: [], ...SMUT_E_EROTICA })).toEqual(["gênero do MangaUpdates: smut", "classificação externa: erotica"])
  })
})

describe("ciclo de vida: reprocessar, evidência que chega depois, evidência que some", () => {
  const PROPRIA_PADRAO = row("inferred_base", 6, { rule: STRUCTURAL_RULES.standardBase })
  const PROPRIO_PISO = row("inferred_base", 9, { rule: STRUCTURAL_RULES.adultFloor })

  it("inferência própria ainda válida: keep (reprocessar é idempotente)", () => {
    const p = planStructuralInference(fatos({ current: { normal: PROPRIA_PADRAO, r18: PROPRIO_PISO } }))
    expect(p.decisions.normal.kind).toBe("keep")
    expect(p.decisions.r18.kind).toBe("keep")
  })

  it("sinal sexual chegando DEPOIS de a obra virar mixed: antes nada, depois o piso", () => {
    const antes = planStructuralInference(fatos({ tags: [R19], current: {} }))
    expect(antes.decisions.r18.kind).toBe("none")
    const depois = planStructuralInference(fatos({ tags: [R19, ATO], current: {} }))
    expect(depois.decisions.r18).toMatchObject({ kind: "infer", target: { score: 9 } })
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

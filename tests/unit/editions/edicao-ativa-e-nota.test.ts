import { describe, it, expect } from "vitest"
import {
  ABSENT_EDITION_PREDICTION,
  adultContentFor,
  defaultMixedEdition,
  EDITION_AWARE_SCORING_CONTRACTS,
  editionScoreProvenance,
  EDITION_SCORE_SOURCES,
  EDITION_SCORE_STRENGTH,
  predictionForEdition,
  resolveMixedEdition,
  scoresForEdition,
  type EditionScoreRow,
} from "@/lib/editions/mixed-edition"
import { SCORING_CONTRACT } from "@/lib/calculations/scoring-contract"
import {
  isR18ExclusiveWarning,
  tagEditionClass,
  mentionsExplicitSexualContent,
  tagsForEdition,
  warningsForEdition,
} from "@/lib/editions/edition-content"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const linha = (edition: "normal" | "r18", score: number | null, source: EditionScoreRow["source"]): EditionScoreRow => ({
  work_id: "w", edition, criterion_slug: "adult_content", score, source,
  status: source === "not_rated" ? "not_rated" : source === "inferred_base" ? "provisional" : "rated",
  confidence: source === "inferred_base" ? "baixa" : null,
})

describe("qual edição está ativa (precedência fechada em 2026-10-10)", () => {
  it("ocultar 18+ força a normal — mesmo com preferência R18", () => {
    expect(resolveMixedEdition({ hideAdult: true, preference: "r18" })).toEqual({ edition: "normal", source: "hide_adult", requiresConfirmation: false })
  })
  it("?adult=hide força a normal", () => {
    expect(resolveMixedEdition({ hideAdult: false, adultFilter: "hide", preference: "r18" }).edition).toBe("normal")
  })
  it("ocultar 18+ + pedir a R18 na mão ⇒ R18 COM confirmação (a preferência não é tocada)", () => {
    expect(resolveMixedEdition({ hideAdult: true, urlEdition: "r18", preference: null })).toEqual({ edition: "r18", source: "url", requiresConfirmation: true })
  })
  it("?adult=only força a R18 — vence a URL e a preferência", () => {
    expect(resolveMixedEdition({ hideAdult: false, adultFilter: "only", urlEdition: "normal", preference: "normal" })).toEqual({ edition: "r18", source: "adult_filter_only", requiresConfirmation: false })
  })
  it("?edition= escolhe a edição", () => {
    expect(resolveMixedEdition({ hideAdult: false, urlEdition: "r18", preference: "normal" }).edition).toBe("r18")
    expect(resolveMixedEdition({ hideAdult: false, urlEdition: "normal", preference: "r18" }).edition).toBe("normal")
  })
  it("sem URL nem filtro vale a preferência da conta", () => {
    expect(resolveMixedEdition({ hideAdult: false, preference: "r18" })).toEqual({ edition: "r18", source: "preference", requiresConfirmation: false })
  })
  it("sem preferência ⇒ NORMAL", () => {
    expect(resolveMixedEdition({ hideAdult: false })).toEqual({ edition: "normal", source: "fallback", requiresConfirmation: false })
  })
  it("a edição padrão do recálculo é a mesma régua sem URL e sem filtro", () => {
    expect(defaultMixedEdition({ hideAdult: false, preference: "r18" })).toBe("r18")
    expect(defaultMixedEdition({ hideAdult: true, preference: "r18" })).toBe("normal")
    expect(defaultMixedEdition({ hideAdult: false, preference: null })).toBe("normal")
  })
})

describe("adultContentFor(work, edição) — nunca a nota de outra edição", () => {
  const rows = [linha("normal", 5, "inferred_base"), linha("r18", 9.5, "reused_existing")]

  it("obra NÃO-mixed segue a nota legada", () => {
    expect(adultContentFor({ isMixed: false, legacyScore: 7, editionRows: rows }, "normal")).toEqual({ kind: "legacy", score: 7 })
  })
  it("mixed + normal usa a normal; mixed + R18 usa a R18", () => {
    expect(adultContentFor({ isMixed: true, legacyScore: 9.5, editionRows: rows }, "normal")).toMatchObject({ kind: "edition", score: 5 })
    expect(adultContentFor({ isMixed: true, legacyScore: 9.5, editionRows: rows }, "r18")).toMatchObject({ kind: "edition", score: 9.5 })
  })
  it("normal sem nota NÃO herda a R18", () => {
    const r = adultContentFor({ isMixed: true, legacyScore: 9.5, editionRows: [linha("normal", null, "not_rated"), linha("r18", 9.5, "reused_existing")] }, "normal")
    expect(r.kind).toBe("absent")
  })
  it("R18 sem nota NÃO herda a normal (nem a legada)", () => {
    const r = adultContentFor({ isMixed: true, legacyScore: 8, editionRows: [linha("normal", 5, "inferred_base"), linha("r18", null, "not_rated")] }, "r18")
    expect(r.kind).toBe("absent")
  })
  it("mixed sem linha nenhuma ⇒ ausência (nunca a nota misturada)", () => {
    expect(adultContentFor({ isMixed: true, legacyScore: 9, editionRows: [] }, "normal").kind).toBe("absent")
    expect(adultContentFor({ isMixed: true, legacyScore: 9, editionRows: undefined }, "r18").kind).toBe("absent")
  })
  it("scoresForEdition troca ou REMOVE adult_content, sem tocar o resto", () => {
    const base = { adult_content: 9, romance: 7 }
    expect(scoresForEdition(base, { kind: "legacy", score: 9 })).toBe(base)
    expect(scoresForEdition(base, adultContentFor({ isMixed: true, legacyScore: 9, editionRows: rows }, "normal"))).toEqual({ adult_content: 5, romance: 7 })
    expect(scoresForEdition(base, { kind: "absent", edition: "normal", row: null })).toEqual({ romance: 7 })
    expect(base.adult_content).toBe(9)
  })
})

describe("procedência: o baseline não se passa por avaliação", () => {
  it("baseline = 'Nota-base provisória (inferida)' e diz que NÃO é avaliação", () => {
    const p = editionScoreProvenance(adultContentFor({ isMixed: true, legacyScore: 9, editionRows: [linha("normal", 5, "inferred_base")] }, "normal"))
    expect(p?.label).toBe("Nota-base provisória (inferida)")
    expect(p?.detail).toMatch(/Não é avaliação/)
  })
  it("ausência = 'Não avaliado para esta edição'", () => {
    expect(editionScoreProvenance({ kind: "absent", edition: "r18", row: null })?.label).toBe("Não avaliado para esta edição")
  })
  it("baseline = provisório + inferido + baixa confiança, e não existe fonte 'por regra'", () => {
    expect(EDITION_SCORE_SOURCES).not.toContain("rule_derived")
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/213_scores_por_edicao.sql"), "utf8")
    expect(sql).toMatch(/when 'inferred_base' then 'provisional'/)
    expect(sql).toMatch(/source <> 'inferred_base' or confidence = 'baixa'/)
  })
  it("a força da procedência é a MESMA da migration 213 (inferred_base < avaliada/manual)", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/213_scores_por_edicao.sql"), "utf8")
    const fn = sql.slice(sql.indexOf("function public.work_edition_score_strength"), sql.indexOf("$$;", sql.indexOf("function public.work_edition_score_strength")))
    for (const src of EDITION_SCORE_SOURCES) {
      const m = fn.match(new RegExp(`when '${src}' then (\\d)`))
      expect(m, src).not.toBeNull()
      expect(Number(m![1]), src).toBe(EDITION_SCORE_STRENGTH[src])
    }
    expect(EDITION_SCORE_STRENGTH.inferred_base).toBeLessThan(EDITION_SCORE_STRENGTH.reused_existing)
    expect(EDITION_SCORE_STRENGTH.inferred_base).toBeLessThan(EDITION_SCORE_STRENGTH.ai_evaluated)
    expect(EDITION_SCORE_STRENGTH.inferred_base).toBeLessThan(EDITION_SCORE_STRENGTH.curator_confirmed)
  })
})

describe("tags por edição: TRÊS classes, todas das flags do banco (pós-210)", () => {
  it("indicador FORTE ou tier explícito ⇒ R18 (família R19, Smut, atos explícitos)", () => {
    expect(tagEditionClass({ adult_indicator: true, adult_indicator_strong: true, adult_score_tier: "label" })).toBe("r18") // R19
    expect(tagEditionClass({ adult_indicator: true, adult_indicator_strong: true, adult_score_tier: "explicit" })).toBe("r18") // Smut
    expect(tagEditionClass({ adult_indicator: false, adult_indicator_strong: false, adult_score_tier: "explicit" })).toBe("r18")
  })
  it("adulta FRACA ou tier label sem força ⇒ edição DESCONHECIDA (Adult, Sexual Content, Nudity, First-Time Intercourse)", () => {
    expect(tagEditionClass({ adult_indicator: true, adult_indicator_strong: false, adult_score_tier: "label" })).toBe("desconhecida")
    expect(tagEditionClass({ adult_indicator: true, adult_indicator_strong: false, adult_score_tier: null })).toBe("desconhecida")
    expect(tagEditionClass({ adult_indicator: false, adult_indicator_strong: false, adult_score_tier: "label" })).toBe("desconhecida")
  })
  it("'R19 disponível' (marks_r19_edition) e tag sem sinal adulto ⇒ COMPARTILHADA — inclusive violência sexual (mig 203)", () => {
    expect(tagEditionClass({ adult_indicator: false, marks_r19_edition: true })).toBe("compartilhada")
    expect(tagEditionClass({ adult_indicator: false, adult_indicator_strong: false, adult_score_tier: null })).toBe("compartilhada")
    expect(tagEditionClass({})).toBe("compartilhada")
  })
  it("na NORMAL saem a R18 e a desconhecida; na R18 e em obra não-mixed ficam todas", () => {
    const tags = [
      { id: "r19", adult_indicator: true, adult_indicator_strong: true, adult_score_tier: "label" },
      { id: "cunnilingus", adult_score_tier: "explicit" },
      { id: "adult", adult_indicator: true, adult_score_tier: "label" },
      { id: "r19-disponivel", marks_r19_edition: true },
      { id: "sexual-assault", adult_indicator: false },
      { id: "romance" },
    ]
    expect(tagsForEdition(tags, "normal").map((t) => t.id)).toEqual(["r19-disponivel", "sexual-assault", "romance"])
    expect(tagsForEdition(tags, "r18")).toHaveLength(6)
    expect(tagsForEdition(tags, null)).toHaveLength(6)
  })
  it("avisos: sexo explícito é da R18; violência sexual, violência e 'censuradas' ficam nas duas", () => {
    expect(isR18ExclusiveWarning("Cenas sexuais explícitas (smut)")).toBe(true)
    expect(isR18ExclusiveWarning("Conteúdo sexual explícito (não censurado em algumas versões)")).toBe(true)
    expect(isR18ExclusiveWarning("Cenas de conteúdo sexual (versão erótica disponível)")).toBe(true)
    expect(isR18ExclusiveWarning("Estupro/abuso sexual explícito e menções a pedofilia")).toBe(false)
    expect(isR18ExclusiveWarning("Violência gráfica e assassinato")).toBe(false)
    expect(isR18ExclusiveWarning("cenas de conteúdo sexual (censuradas)")).toBe(false)
    expect(isR18ExclusiveWarning("Conteúdo sexual sugestivo/sensual")).toBe(false)
    expect(warningsForEdition(["Cenas sexuais explícitas (smut)", "Violência gráfica"], "normal", (w) => w)).toEqual(["Violência gráfica"])
    expect(warningsForEdition(["Cenas sexuais explícitas (smut)"], "r18", (w) => w)).toHaveLength(1)
  })
  it("texto livre que cita sexo explícito é detectado; prosa comum não", () => {
    expect(mentionsExplicitSexualContent("the smut is perfect")).toBe(true)
    expect(mentionsExplicitSexualContent("consenso de cenas de sexo explícito")).toBe(true)
    expect(mentionsExplicitSexualContent("you have to read the uncensored version")).toBe(true)
    // as duas ordens (buraco achado na verificação visual de 2026-10-11)
    expect(mentionsExplicitSexualContent("misturando fantasia élfica e conteúdo sexual explícito recorrente")).toBe(true)
    expect(mentionsExplicitSexualContent("lots of explicit sexual content")).toBe(true)
    expect(mentionsExplicitSexualContent("a sexually explicit story")).toBe(true)
    expect(mentionsExplicitSexualContent("cenas sexualmente explícitas")).toBe(true)
    expect(mentionsExplicitSexualContent("conteúdo sexual sugestivo, nada explícito")).toBe(false)
    expect(mentionsExplicitSexualContent("great art and pacing, the FL is smart")).toBe(false)
    expect(mentionsExplicitSexualContent(null)).toBe(false)
  })
})

describe("Nota Prevista por edição — predictionForEdition", () => {
  const porEdicao = {
    normal: { expected_score: 7.1, expected_baseline: 7.1, expected_quality_adj: 0, expected_is_stub: false, chance_score: 61, chance_is_stub: false },
    r18: { expected_score: 6.4, expected_baseline: 6.4, expected_quality_adj: 0, expected_is_stub: false, chance_score: 44, chance_is_stub: false },
  }
  const linhaMixed = { expected_score: 7.1, chance_score: 61, expected_edition: "normal", expected_by_edition: porEdicao, scoring_contract: SCORING_CONTRACT, platform_avg: 8 }

  it("o contrato atual é dos que conhecem edição (sem isto a página nunca mostraria previsão de mixed)", () => {
    expect(EDITION_AWARE_SCORING_CONTRACTS.has(SCORING_CONTRACT)).toBe(true)
    expect(EDITION_AWARE_SCORING_CONTRACTS.has("s9-fantasy-b-v1")).toBe(false)
  })
  it("não-mixed passa INTACTA (mesma referência)", () => {
    const row = { expected_score: 8, chance_score: 70 }
    expect(predictionForEdition(row, false, "r18")).toEqual({ row, view: "own" })
    expect(predictionForEdition(row, false, "r18").row).toBe(row)
  })
  it("mixed + normal ⇒ a da normal; mixed + R18 ⇒ a da R18 (catálogo intacto)", () => {
    expect(predictionForEdition(linhaMixed, true, "normal").row).toMatchObject({ expected_score: 7.1, chance_score: 61, platform_avg: 8 })
    expect(predictionForEdition(linhaMixed, true, "r18").row).toMatchObject({ expected_score: 6.4, chance_score: 44, platform_avg: 8 })
  })
  it("linha gravada por contrato que NÃO conhece edição ⇒ não calculada (nunca a previsão misturada)", () => {
    const velha = { ...linhaMixed, scoring_contract: "s9-fantasy-b-v1" }
    const r = predictionForEdition(velha, true, "normal")
    expect(r.view).toBe("absent")
    expect(r.row).toMatchObject(ABSENT_EDITION_PREDICTION)
  })
  it("sem expected_by_edition (linha anterior) ⇒ não calculada", () => {
    expect(predictionForEdition({ expected_score: 9, scoring_contract: SCORING_CONTRACT }, true, "r18").view).toBe("absent")
  })
  it("edição SEM nota ⇒ expected_score null nela, e a outra edição continua com a sua", () => {
    const semR18 = { ...linhaMixed, expected_by_edition: { ...porEdicao, r18: { ...porEdicao.r18, expected_score: null, expected_baseline: null, expected_quality_adj: null } } }
    expect(predictionForEdition(semR18, true, "r18").row.expected_score).toBeNull()
    expect(predictionForEdition(semR18, true, "normal").row.expected_score).toBe(7.1)
  })
  it("numeric do PostgREST como string vira número", () => {
    const comString = { ...linhaMixed, expected_by_edition: { ...porEdicao, normal: { ...porEdicao.normal, expected_score: "7.10" } } }
    expect(predictionForEdition(comString, true, "normal").row.expected_score).toBe(7.1)
  })
})

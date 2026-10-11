import { describe, it, expect } from "vitest"
import { buildWork, computeRecalc, type RawWork, type RecalcEditionContext } from "@/server/actions/calculations"
import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"
import { asPersistedEditionPrediction, groupEditionRows, type EditionPrediction, type EditionScoreRow, type MixedEdition } from "@/lib/editions/mixed-edition"
import type { FormulaConfig, ScoreWeight } from "@/types/domain"

/**
 * A Nota Prevista de uma obra `mixed` usa o `adult_content` da EDIÇÃO (migs 213/214) — e só na
 * PREVISÃO. O treino segue com o legado de `category_scores`, porque os rótulos não dizem qual
 * edição a pessoa leu. Duas consequências que este arquivo trava:
 *   · o MODELO é idêntico com ou sem edição (mesmos coeficientes), e nenhuma obra não-mixed muda;
 *   · obra mixed sem nota na edição fica SEM Nota Prevista (o gate dos 9 atributos), nunca com a
 *     nota da outra edição.
 */

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)
}

const MIXED = Array.from({ length: 10 }, (_, k) => `w${String(45 + k).padStart(3, "0")}`) // 45–49 rotuladas, 50–54 não

function catalogo(): RawWork[] {
  const r = rng(11)
  return Array.from({ length: 80 }, (_, i) => {
    const id = `w${String(i).padStart(3, "0")}`
    const notas = SCORING_CRITERION_SLUGS.map((slug) => ({
      criterion_slug: slug,
      // nas mixed, a nota legada de adult_content é ALTA (a mistura que a auditoria achou)
      score: slug === "adult_content" && MIXED.includes(id) ? 9 : Math.round(r() * 20) / 2,
      source: "ai_accepted",
    }))
    const media = notas.reduce((s, n) => s + n.score, 0) / notas.length
    const rating = 6 + r() * 3
    return {
      id,
      publication_status_id: null,
      total_chapters: 40 + Math.floor(r() * 120),
      synopsis_quality: ["♥", "♥♥", "♥♥♥", "♥♥♥♥"][i % 4],
      observation_adjustment: 0,
      user_score: i < 50 ? Math.min(10, Math.max(0, 0.5 * media + 0.4 * rating + (r() - 0.5))) : null,
      is_archived: false,
      year: 2015 + (i % 9),
      year_end: null,
      original_title: null,
      post_story_score: null, post_fl_score: null, post_ml_score: null, post_character_development_score: null,
      post_pacing_score: null, post_art_visual_score: null, post_impact_immersion_score: null, post_originality_score: null,
      category_scores: notas,
      platform_ratings: [{ id: `p${i}`, platform: "mal", rating, vote_count: 100 + Math.floor(r() * 5000) }],
      work_tags: [],
      edition_state: MIXED.includes(id) ? "mixed" : i === 60 ? "r18_only" : null,
    }
  })
}

const row = (work_id: string, edition: MixedEdition, score: number | null, source: EditionScoreRow["source"]): EditionScoreRow => ({
  work_id, edition, criterion_slug: "adult_content", score, source,
  status: source === "not_rated" ? "not_rated" : source === "inferred_base" ? "provisional" : "rated",
  confidence: source === "inferred_base" ? "baixa" : source === "not_rated" ? null : "alta",
})

/** normal: baseline 5 em 45–52, sem nota em 53–54 · R18: a legada (9) em 45–50, sem nota em 51–54. */
const LINHAS: EditionScoreRow[] = MIXED.flatMap((id, k) => [
  k <= 7 ? row(id, "normal", 5, "inferred_base") : row(id, "normal", null, "not_rated"),
  k <= 5 ? row(id, "r18", 9, "reused_existing") : row(id, "r18", null, "not_rated"),
])

const pesos: ScoreWeight[] = SCORING_CRITERION_SLUGS.map((slug, i) => ({
  id: slug, slug, name: slug, weight: 10 + i, threshold: null, display_order: i, is_active: true,
}))
const config = { score_weights_auto: false, formula_version: "teste", gpt_mean: null, cv_mae_expected_stage1: null, expected_ridge_coefficients: null } as unknown as FormulaConfig

function rodar(edition?: MixedEdition) {
  const ctx: RecalcEditionContext | undefined = edition ? { edition, rowsByWork: groupEditionRows(LINHAS) } : undefined
  const works = catalogo().map((raw) => buildWork(raw, {} as Parameters<typeof buildWork>[1], ctx))
  const res = computeRecalc({
    works, weights: pesos, config, tasteProfile: null, declaredTagPrefs: [], includeQuality: false,
    aiQualityByWork: new Map(), fast: true,
  })
  const porId = new Map(res.rows.map((r) => [r.work_id, r]))
  return { works, res, porId }
}

const legado = rodar()
const normal = rodar("normal")
const r18 = rodar("r18")

describe("recálculo por edição — o que NÃO pode mudar", () => {
  it("o modelo é idêntico (o treino usa o legado)", () => {
    expect(normal.res.expectedPredictor.model.coefficients).toEqual(legado.res.expectedPredictor.model.coefficients)
    expect(r18.res.expectedPredictor.model.coefficients).toEqual(legado.res.expectedPredictor.model.coefficients)
  })

  it("obra não-mixed (inclusive r18_only) continua com a mesma Nota Prevista, Chance e expected_edition nulo", () => {
    for (const [id, base] of legado.porId) {
      if (MIXED.includes(id)) continue
      for (const run of [normal, r18]) {
        const r = run.porId.get(id)!
        expect(r.expected_score).toBe(base.expected_score)
        expect(r.chance_score).toBe(base.chance_score)
        expect(r.expected_edition).toBeNull()
      }
    }
  })

  it("o mapa de TREINO da obra mixed continua com a nota legada", () => {
    for (const w of normal.works.filter((x) => MIXED.includes(x.id))) expect(w.categoryScores.adult_content).toBe(9)
  })
})

describe("recálculo por edição — a previsão usa a nota da edição", () => {
  it("mixed + normal usa o 5 da normal (e grava expected_edition = normal)", () => {
    const w = normal.works.find((x) => x.id === "w045")!
    expect(w.predictionCategoryScores.adult_content).toBe(5)
    expect(normal.porId.get("w045")!.expected_edition).toBe("normal")
    expect(normal.porId.get("w045")!.expected_score).not.toBe(legado.porId.get("w045")!.expected_score)
  })

  it("mixed + R18 usa a nota da R18 (aqui = a legada ⇒ mesma Nota Prevista do legado)", () => {
    expect(r18.porId.get("w045")!.expected_edition).toBe("r18")
    expect(r18.porId.get("w045")!.expected_score).toBe(legado.porId.get("w045")!.expected_score)
  })

  it("normal SEM nota ⇒ Nota Prevista nula — não herda o 9 da R18", () => {
    // w053: normal not_rated, R18 not_rated · w050: normal 5, R18 9 — os dois lados testados
    expect(normal.works.find((x) => x.id === "w053")!.predictionCategoryScores.adult_content).toBeUndefined()
    expect(normal.porId.get("w053")!.expected_score).toBeNull()
  })

  it("R18 SEM nota ⇒ Nota Prevista nula — não herda o 5 da normal", () => {
    // w051: normal 5 (baseline), R18 not_rated
    expect(r18.works.find((x) => x.id === "w051")!.predictionCategoryScores.adult_content).toBeUndefined()
    expect(r18.porId.get("w051")!.expected_score).toBeNull()
    expect(normal.porId.get("w051")!.expected_score).not.toBeNull()
  })

  it("obra mixed sem NENHUMA linha de edição fica sem Nota Prevista (ausência, não a nota misturada)", () => {
    const works = catalogo().map((raw) =>
      buildWork(raw, {} as Parameters<typeof buildWork>[1], { edition: "normal", rowsByWork: new Map() }),
    )
    const res = computeRecalc({ works, weights: pesos, config, tasteProfile: null, declaredTagPrefs: [], includeQuality: false, aiQualityByWork: new Map(), fast: true })
    for (const r of res.rows.filter((x) => MIXED.includes(x.work_id))) expect(r.expected_score).toBeNull()
  })
})

describe("recálculo por edição — as DUAS previsões (expected_by_edition, mig 213)", () => {
  const campos = ["expected_score", "expected_baseline", "expected_quality_adj", "expected_is_stub", "chance_score", "chance_is_stub"] as const
  // Como a COLUNA guarda (o banco arredonda as de sempre ao gravar): é contra isto que a cópia por
  // edição tem de bater, senão a página e a home arredondam a mesma previsão de pontos diferentes.
  const daLinha = (r: Record<string, unknown>) =>
    asPersistedEditionPrediction(Object.fromEntries(campos.map((c) => [c, r[c]])) as unknown as EditionPrediction)

  it("obra NÃO-mixed não ganha previsão por edição", () => {
    for (const [id, r] of normal.porId) if (!MIXED.includes(id)) expect(r.expected_by_edition).toBeNull()
  })

  it("a edição padrão em expected_by_edition é EXATAMENTE a das colunas de sempre", () => {
    for (const id of MIXED) {
      expect(normal.porId.get(id)!.expected_by_edition!.normal).toEqual(daLinha(normal.porId.get(id)!))
      expect(r18.porId.get(id)!.expected_by_edition!.r18).toEqual(daLinha(r18.porId.get(id)!))
    }
  })

  it("a OUTRA edição, prevista à parte, é idêntica à que sai como principal quando ela é a padrão", () => {
    // Prova de que a 2ª passada é o MESMO cálculo — não uma cópia que poderia divergir.
    for (const id of MIXED) {
      expect(normal.porId.get(id)!.expected_by_edition!.r18).toEqual(daLinha(r18.porId.get(id)!))
      expect(r18.porId.get(id)!.expected_by_edition!.normal).toEqual(daLinha(normal.porId.get(id)!))
    }
  })

  it("nunca herda: edição sem nota fica sem Nota Prevista mesmo quando a outra tem", () => {
    const w051 = normal.porId.get("w051")!.expected_by_edition!
    expect(w051.normal.expected_score).not.toBeNull()
    expect(w051.r18.expected_score).toBeNull()
    const w053 = normal.porId.get("w053")!.expected_by_edition!
    expect(w053.normal.expected_score).toBeNull()
    expect(w053.r18.expected_score).toBeNull()
  })

  it("a cópia por edição já sai com as casas das colunas (nada de número cheio no jsonb)", () => {
    const casas = (v: unknown) => (typeof v === "number" ? (String(v).split(".")[1] ?? "").length : 0)
    for (const id of MIXED) {
      for (const ed of ["normal", "r18"] as const) {
        const p = normal.porId.get(id)!.expected_by_edition![ed]
        expect(casas(p.expected_score)).toBeLessThanOrEqual(2)
        expect(casas(p.chance_score)).toBeLessThanOrEqual(2)
        expect(casas(p.expected_baseline)).toBeLessThanOrEqual(3)
        expect(casas(p.expected_quality_adj)).toBeLessThanOrEqual(3)
      }
    }
  })

  it("sem contexto de edição (scripts de experimento) nada muda: expected_by_edition nulo em tudo", () => {
    for (const r of legado.res.rows) expect(r.expected_by_edition).toBeNull()
  })
})

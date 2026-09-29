import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"

/**
 * A NOTA PREVISTA É O RIDGE — `calc` foi aposentado dela (2026-09-29).
 *
 * Até então o recálculo fazia `w·Ridge + (1−w)·calcNoObs`, com `w` escolhido por busca em grade
 * a cada recalc. Medido: `w` já estava em 1,0; o blend avaliado honestamente PIORAVA o MAE; e o
 * que ele ainda fazia era instabilidade (w oscilando 0,95 ↔ 1,0 mexia centenas de posições).
 *
 * Estes testes provam o comportamento, não a grafia: `calculateNotaCalc` é substituído por um
 * mock que desloca o `calc` sem tocar em NENHUMA feature do Ridge — se a Prevista ainda
 * dependesse do `calc` por qualquer caminho, ela mudaria junto.
 */

const desloc = vi.hoisted(() => ({ v: 0 }))
vi.mock("@/lib/calculations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/calculations")>()
  return {
    ...actual,
    calculateNotaCalc: (i: Parameters<typeof actual.calculateNotaCalc>[0]) => actual.calculateNotaCalc(i) + desloc.v,
  }
})

import { buildWork, computeRecalc, type RawWork } from "@/server/actions/calculations"
import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"
import type { FormulaConfig, ScoreWeight } from "@/types/domain"

function rng(seed: number) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)
}

/** Catálogo sintético determinístico: 80 obras, 50 rotuladas (o blend antigo exigia ≥ 30). */
function catalogo(labelShift = 0): RawWork[] {
  const r = rng(7)
  const sin = ["♥", "♥♥", "♥♥♥", "♥♥♥♥"]
  return Array.from({ length: 80 }, (_, i) => {
    const notas = SCORING_CRITERION_SLUGS.map((slug) => ({ criterion_slug: slug, score: Math.round(r() * 20) / 2, source: "ai_accepted" }))
    const media = notas.reduce((s, n) => s + n.score, 0) / notas.length
    const rating = 6 + r() * 3
    return {
      id: `w${String(i).padStart(3, "0")}`,
      publication_status_id: null,
      total_chapters: 40 + Math.floor(r() * 120),
      synopsis_quality: sin[i % 4],
      observation_adjustment: i % 9 === 0 ? 0.2 : 0,
      user_score: i < 50 ? Math.min(10, Math.max(0, 0.5 * media + 0.4 * rating + (r() - 0.5) + labelShift * (i % 2 ? 1 : -1))) : null,
      is_archived: false,
      year: 2015 + (i % 9),
      year_end: null,
      original_title: null,
      post_story_score: null,
      post_fl_score: null,
      post_ml_score: null,
      post_character_development_score: null,
      post_pacing_score: null,
      post_art_visual_score: null,
      post_impact_immersion_score: null,
      post_originality_score: null,
      category_scores: notas,
      platform_ratings: [{ id: `p${i}`, platform: "mal", rating, vote_count: 100 + Math.floor(r() * 5000) }],
      work_tags: [],
    }
  })
}

const pesos: ScoreWeight[] = SCORING_CRITERION_SLUGS.map((slug, i) => ({
  id: slug, slug, name: slug, weight: 10 + i, threshold: null, display_order: i, is_active: true,
}))

function config(blendPersistido?: number): FormulaConfig {
  return {
    score_weights_auto: false,
    formula_version: "teste",
    gpt_mean: null,
    cv_mae_expected_stage1: null,
    expected_ridge_coefficients: blendPersistido == null ? null : { featureNames: [], coefficients: [], calcBlendWeight: blendPersistido },
  } as unknown as FormulaConfig
}

function rodar(opts: { blendPersistido?: number; labelShift?: number; fast?: boolean } = {}) {
  const works = catalogo(opts.labelShift ?? 0).map((raw) => buildWork(raw, {} as Parameters<typeof buildWork>[1]))
  const res = computeRecalc({
    works, weights: pesos, config: config(opts.blendPersistido), tasteProfile: null,
    declaredTagPrefs: [], includeQuality: false, aiQualityByWork: new Map(), fast: opts.fast ?? true,
  })
  return { works, res }
}

const prevista = (x: ReturnType<typeof rodar>) => x.res.rows.map((r) => r.expected_score)

beforeEach(() => {
  desloc.v = 0
})

describe("a Nota Prevista é a saída do Ridge", () => {
  it("é exatamente o Ridge (+ obs), obra a obra", () => {
    const { works, res } = rodar()
    const alvo = works.filter((w) => w.expectedScore != null)
    expect(alvo.length).toBeGreaterThan(40)
    for (const w of alvo) {
      const ridge = res.expectedPredictor.predict([{
        categoryScores: w.categoryScoresCalibrated, iaEvalNormalized: w.iaEvalNormalizedCalibrated, platformAvg: w.platformAvg,
        totalVotes: w.totalVotes, totalChapters: w.totalChapters, synopsisQuality: w.synopsisQuality,
        observationAdjustment: w.observationAdjustment, publicationStatus: w.publicationStatus,
        lovedTagOverlap: w.lovedTagOverlap, avoidedTagOverlap: w.avoidedTagOverlap, criterionFitScore: w.criterionFitScore,
        releaseAge: w.releaseAge, runLength: w.runLength, origin: w.origin, postScores: w.postScores,
      }])[0].expected
      const obs = Math.min(Math.max(w.observationAdjustment, -0.3), 0.3)
      expect(w.expectedScore).toBeCloseTo(Math.max(0, Math.min(10, ridge + obs)), 12)
    }
  })

  it("A · um peso de blend persistido (0,9 · 0,5 · 0) não muda nada", () => {
    const base = prevista(rodar())
    for (const b of [0.9, 0.5, 0]) expect(prevista(rodar({ blendPersistido: b }))).toEqual(base)
  })

  it("B · deslocar o calc em +5 NÃO muda a Prevista — mas muda o calc_score (o mock pegou)", () => {
    const antes = rodar()
    desloc.v = 5
    const depois = rodar()
    expect(prevista(depois)).toEqual(prevista(antes))
    const calcAntes = antes.res.rows.map((r) => r.calc_score)
    const calcDepois = depois.res.rows.map((r) => r.calc_score)
    expect(calcDepois).not.toEqual(calcAntes)
  })

  it("C · mudar o que o Ridge aprende muda a Prevista normalmente", () => {
    expect(prevista(rodar({ labelShift: 1.5 }))).not.toEqual(prevista(rodar()))
  })
})

describe("o que não pode ter mudado", () => {
  it("F · a CV honesta mede o Ridge: deslocar o calc não mexe no cvMAE", () => {
    const antes = rodar({ fast: false }).res.cvMaeExpected
    desloc.v = 5
    const depois = rodar({ fast: false }).res.cvMaeExpected
    expect(antes).not.toBeNull()
    expect(depois).toBe(antes)
  })

  it("G · calc_score continua calculado e persistido na linha do recálculo", () => {
    const { res, works } = rodar()
    expect(res.rows.every((r) => typeof r.calc_score === "number" && Number.isFinite(r.calc_score))).toBe(true)
    expect(res.rows.map((r) => r.calc_score)).toEqual(works.map((w) => w.calcScore))
  })

  it("I · deslocar o calc não toca IA(n), chance, Alinhamento nem desempate", () => {
    const antes = rodar().res.rows
    desloc.v = 5
    const depois = rodar().res.rows
    const semCalc = (rs: typeof antes) =>
      rs.map((r) => [r.ia_eval, r.ia_eval_normalized, r.chance_score, r.personal_fit, r.personal_fit_percentile, r.tag_overlap_net, r.expected_baseline])
    expect(semCalc(depois)).toEqual(semCalc(antes))
  })
})

describe("arquitetura: o blend não volta", () => {
  const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const calc = semComentarios(readFileSync("server/actions/calculations.ts", "utf8"))

  it("D/E · não sobra peso de blend no recálculo (o do dono e o per-user passam por computeRecalc)", () => {
    expect(calc).not.toMatch(/\bcalcBlendWeight\b|\bblendWeight\b|\bwgrid\b/)
    expect(readFileSync("server/recalc/user-recalc.ts", "utf8")).toContain("computeRecalc({")
  })

  it("calcScoreNoObs só é declarado e atribuído — nunca entra numa conta", () => {
    const usos = calc.match(/[^\n]*\bcalcScoreNoObs\b[^\n]*/g) ?? []
    expect(usos.map((l) => l.trim())).toEqual([
      "calcScoreNoObs: number",
      "calcScoreNoObs: 0,",
      "w.calcScoreNoObs = calculateNotaCalc({",
    ])
  })

  it("H · ledger e snapshots seguem capturando o calc como componente", () => {
    expect(readFileSync("lib/server/predictions/label-transition-io.ts", "utf8")).toMatch(/calc_score/)
    expect(readFileSync("lib/server/predictions/record-prediction.ts", "utf8")).toMatch(/calc_score/)
  })
})

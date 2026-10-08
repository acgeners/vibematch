import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * A NOTA PREVISTA É O RIDGE — e a Nota.Calc não existe mais.
 *
 * 2026-09-29: o blend `w·Ridge + (1−w)·calcNoObs` saiu da Prevista. Medido: `w` já estava em 1,0;
 * o blend avaliado honestamente PIORAVA o MAE; e o que ele ainda fazia era instabilidade (w
 * oscilando 0,95 ↔ 1,0 mexia centenas de posições).
 *
 * 2026-10-07: a Nota.Calc foi aposentada INTEIRA — deixou de ser calculada, gravada e capturada.
 * Antes de tirar, remedido no clone local com o núcleo real: sabotar o calc (+5 e =0) mudou ZERO
 * células de 1.010 linhas fora as dele, nenhuma Prioridade e nenhuma posição de ranking; corr com
 * o resíduo OOF do Ridge 0,05; peso ótimo do blend 0. As colunas (`calc_score`, `mae_calc`,
 * `rmse_calc`, `prediction_snapshots.calc_score`, `prediction_ledger.predicted_calc`) ficam no
 * banco como LEGADO — sem migration —, e é por isso que a chave tem de sair da linha (ausente, não
 * `null`): o upsert não toca a coluna e o espelho per-user também a omite.
 */

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

  it("B · nenhuma linha do recálculo carrega a Nota.Calc — a chave está AUSENTE, não nula", () => {
    const { res } = rodar()
    for (const r of res.rows) {
      for (const k of ["calc_score", "mae_calc", "rmse_calc"]) expect(Object.keys(r)).not.toContain(k)
    }
    // E o retorno não carrega mais as métricas nem o parâmetro dela.
    expect(Object.keys(res)).not.toContain("newMaeCalc")
    expect(Object.keys(res)).not.toContain("newRmseCalc")
    expect(Object.keys(res)).not.toContain("pseudoVotesBlend")
  })

  it("C · mudar o que o Ridge aprende muda a Prevista normalmente", () => {
    expect(prevista(rodar({ labelShift: 1.5 }))).not.toEqual(prevista(rodar()))
  })
})

describe("o que não pode ter mudado", () => {
  it("F · a CV honesta segue medindo o Ridge", () => {
    expect(rodar({ fast: false }).res.cvMaeExpected).not.toBeNull()
  })
})

describe("arquitetura: o blend não volta", () => {
  const semComentarios = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
  const calc = semComentarios(readFileSync("server/actions/calculations.ts", "utf8"))

  it("D/E · não sobra peso de blend no recálculo (o do dono e o per-user passam por computeRecalc)", () => {
    expect(calc).not.toMatch(/\bcalcBlendWeight\b|\bblendWeight\b|\bwgrid\b/)
    expect(readFileSync("server/recalc/user-recalc.ts", "utf8")).toContain("computeRecalc({")
  })

  it("a Nota.Calc não é calculada no recálculo (nem a fórmula existe mais)", () => {
    expect(calc).not.toMatch(/\bcalculateNotaCalc\b|\bcalcScoreNoObs\b|\bpseudoVotesBlend\b|\bnewMaeCalc\b|\.calcScore\b/)
    // `calcScore: null` sobra só como FORMATO de entrada do `computeCalibration` (lib compartilhada);
    // qualquer valor que não seja `null` ali é a Nota.Calc voltando a entrar numa conta.
    expect(calc).not.toMatch(/\bcalcScore\s*:(?!\s*null\b)/)
    expect(calc).not.toMatch(/\bcalc_score\s*:|\bmae_calc\s*:|\brmse_calc\s*:|\bpseudo_votes_blend\s*:/)
    expect(semComentarios(readFileSync("lib/calculations/index.ts", "utf8"))).not.toMatch(/calculateNotaCalc|\.\/score/)
  })

  it("H · ledger e snapshots NÃO capturam mais a Nota.Calc", () => {
    for (const f of [
      "lib/server/predictions/label-transition-io.ts",
      "lib/server/predictions/label-transition.ts",
      "lib/server/predictions/record-prediction.ts",
      "lib/server/predictions/prediction-context.ts",
    ]) {
      expect(semComentarios(readFileSync(f, "utf8")), f).not.toMatch(/\bcalc_score\b|\bpredicted_calc\b|\bcalcScore\b|\bcalc\s*:/)
    }
  })
})

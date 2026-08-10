/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MEDIÇÃO read-only: clipar as features escaladas a ±Nσ ajuda/atrapalha a Nota
 * Prevista? Reimplementa o loop OOF (mesma seed/folds de expectedOutOfFoldPredictions)
 * com um passo de CLIP opcional no bloco numérico escalado, e cruza o baseline
 * sem-clip contra a função OFICIAL pra provar que a reimplementação é fiel.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-clip-measure.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getOwnerUserId } from "@/server/queries/current-user"
import { loadOwnerLabels, withOwnerLabels } from "@/server/queries/owner-labels"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { expectedOutOfFoldPredictions } from "@/lib/calculations/expected"
import { MedianImputer, StandardScaler, CategoricalImputer, OneHotEncoder, hstack } from "@/lib/ml/preprocessing"
import { fitRidgeCV } from "@/lib/ml/ridge"
import { normalizeChapters } from "@/lib/calculations/chapters"
import { CRITERION_SLUGS } from "@/types/domain"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

const SINOPSE_MAP: Record<string, number> = { "♥": 2, "♥♥": 5, "♥♥♥": 8, "♥♥♥♥": 13 }
const SELECT = `id, title, publication_status_id, total_chapters, is_archived,
  year, year_end, original_title,
  category_scores(criterion_slug, score, source),
  platform_ratings(id, platform, rating, vote_count),
  work_tags(tags(name, tag_group_id))`

function numRow(w: any): (number | null)[] {
  const r: (number | null)[] = []
  for (const slug of CRITERION_SLUGS) { const v = w.categoryScoresCalibrated[slug]; r.push(v == null || !Number.isFinite(v) ? null : v) }
  r.push(w.iaEvalNormalizedCalibrated ?? null, w.platformAvg ?? null, Math.log1p(Math.max(w.totalVotes, 0)),
    normalizeChapters(w.totalChapters), w.synopsisQuality ? SINOPSE_MAP[w.synopsisQuality] ?? null : null,
    w.lovedTagOverlap ?? null, w.avoidedTagOverlap ?? null, w.criterionFitScore ?? null, w.releaseAge ?? null, w.runLength ?? null)
  return r
}
const catRow = (w: any): string[] => [w.publicationStatus || "Unknown", w.origin || "unknown"]
const mae = (p: number[], y: number[]) => p.reduce((s, v, i) => s + Math.abs(v - y[i]), 0) / p.length

// Mesma shuffle determinística (LCG seed 42) e folds de expectedOutOfFoldPredictions.
function foldsOf(n: number, k = 5) {
  const order = Array.from({ length: n }, (_, i) => i)
  let s = 42
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000 }
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]] }
  const kk = Math.max(2, Math.min(k, n))
  const f: number[][] = Array.from({ length: kk }, () => [])
  for (let i = 0; i < n; i++) f[i % kk].push(order[i])
  return f
}

function oofMAE(works: any[], targets: number[], clipSigma: number | null): number {
  const n = works.length
  const nNumeric = CRITERION_SLUGS.length + 10 // 9 critérios + 10 derivadas
  const preds = new Array<number>(n).fill(NaN)
  for (const fold of foldsOf(n)) {
    const test = new Set(fold)
    const trIdx: number[] = [], teIdx: number[] = []
    for (let i = 0; i < n; i++) (test.has(i) ? teIdx : trIdx).push(i)
    const tr = trIdx.map((i) => works[i]), te = teIdx.map((i) => works[i])
    const numImp = new MedianImputer().fit(tr.map(numRow))
    const numSc = new StandardScaler().fit(numImp.transform(tr.map(numRow)))
    const catImp = new CategoricalImputer().fit(tr.map(catRow))
    const catEnc = new OneHotEncoder().fit(catImp.transform(tr.map(catRow)))
    const tx = (rows: any[]) => {
      let num = numSc.transform(numImp.transform(rows.map(numRow)))
      if (clipSigma != null) num = num.map((r) => r.map((v) => Math.max(-clipSigma, Math.min(clipSigma, v))))
      return hstack(num, catEnc.transform(catImp.transform(rows.map(catRow))))
    }
    const Xtr = tx(tr), Xte = tx(te)
    const model = fitRidgeCV(Xtr, trIdx.map((i) => targets[i]), undefined, Math.min(5, Xtr.length))
    Xte.forEach((x, j) => {
      let p = model.intercept
      for (let f = 0; f < x.length; f++) p += model.coefficients[f] * x[f]
      preds[teIdx[j]] = p
    })
    void nNumeric
  }
  return mae(preds, targets)
}

async function main() {
  const sb = createAdminClient()
  const ownerId = await getOwnerUserId(sb)
  const biasMap = await getBiasMap(ownerId, sb)
  const [worksRes, weightsRes, configRes, tasteProfile, declaredTagPrefs, ownerLabels] = await Promise.all([
    sb.from("works").select(SELECT).eq("is_archived", false).limit(2000),
    sb.from("score_weights").select("*").eq("is_active", true),
    sb.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
    getOwnerUserId().then((id) => loadCurrentTasteProfile(id)),
    getDeclaredTagPreferences(sb, { headless: true }),
    loadOwnerLabels(),
  ])
  const rawWorks = withOwnerLabels(worksRes.data as (RawWork & { title: string })[], ownerLabels)
  const works = rawWorks.map((r) => buildWork(r, biasMap))
  computeRecalc({ works, weights: weightsRes.data as ScoreWeight[], config: configRes.data?.[0] as FormulaConfig, tasteProfile, declaredTagPrefs, includeQuality: false, aiQualityByWork: new Map(), fast: true })

  const labeled = (works as any[]).filter((w) => w.userScore != null)
  const targets = labeled.map((w) => w.userScore as number)

  // Cross-check: minha reimplementação SEM clip deve bater na função oficial.
  const inputs = labeled.map((w) => ({
    categoryScores: w.categoryScoresCalibrated, iaEvalNormalized: w.iaEvalNormalizedCalibrated, platformAvg: w.platformAvg,
    totalVotes: w.totalVotes, totalChapters: w.totalChapters, synopsisQuality: w.synopsisQuality, observationAdjustment: w.observationAdjustment,
    publicationStatus: w.publicationStatus, lovedTagOverlap: w.lovedTagOverlap, avoidedTagOverlap: w.avoidedTagOverlap,
    criterionFitScore: w.criterionFitScore, releaseAge: w.releaseAge, runLength: w.runLength, origin: w.origin, postScores: w.postScores,
  }))
  const oficialMAE = mae(expectedOutOfFoldPredictions(inputs as any, targets, false)!, targets)

  const meuSemClip = oofMAE(labeled, targets, null)
  const clip6 = oofMAE(labeled, targets, 6)
  const clip5 = oofMAE(labeled, targets, 5)
  const clip4 = oofMAE(labeled, targets, 4)
  const clip3 = oofMAE(labeled, targets, 3)

  console.log(`rotuladas=${labeled.length}`)
  console.log(`\n[cross-check] oficial=${oficialMAE.toFixed(4)} · minha reimpl sem clip=${meuSemClip.toFixed(4)} · Δ=${Math.abs(oficialMAE - meuSemClip).toFixed(4)} ${Math.abs(oficialMAE - meuSemClip) < 0.005 ? "✅ fiel" : "⚠️ divergiu"}`)
  const d = (m: number) => `${(m - meuSemClip >= 0 ? "+" : "")}${(m - meuSemClip).toFixed(4)} (${((m - meuSemClip) / meuSemClip * 100 >= 0 ? "+" : "")}${((m - meuSemClip) / meuSemClip * 100).toFixed(2)}%)`
  console.log(`\n===== OOF MAE por limiar de clip (baseline sem clip = ${meuSemClip.toFixed(4)}) =====`)
  console.log(`  sem clip:  ${meuSemClip.toFixed(4)}`)
  console.log(`  clip ±6σ:  ${clip6.toFixed(4)}   Δ ${d(clip6)}`)
  console.log(`  clip ±5σ:  ${clip5.toFixed(4)}   Δ ${d(clip5)}`)
  console.log(`  clip ±4σ:  ${clip4.toFixed(4)}   Δ ${d(clip4)}  ${clip4 <= meuSemClip ? "✅" : "❌"}`)
  console.log(`  clip ±3σ:  ${clip3.toFixed(4)}   Δ ${d(clip3)}`)
  console.log("\n(medição read-only — 0 escrita)")
}
main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : e); process.exit(1) })

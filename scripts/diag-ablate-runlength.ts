/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ABLAÇÃO read-only: RunLength ajuda a Nota Prevista? Mede OOF MAE (out-of-fold,
 * sem leakage) COM e SEM RunLength. A Nota Prevista É o Ridge (+ obs): o blend com a
 * Nota.Calc foi aposentado em 2026-09-29 e a Nota.Calc inteira em 2026-10-07, então
 * a seção "FINAL (blend Ridge⊕Calc)" que existia aqui saiu — sem calc ela só
 * imprimiria Infinity/NaN. "Drop" = forçar RunLength constante → variância zero → contribuição
 * zero e as outras features refitam (equivale a remover a coluna), reusando a
 * função REAL `expectedOutOfFoldPredictions`.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/diag-ablate-runlength.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getOwnerUserId } from "@/server/queries/current-user"
import { loadOwnerLabels, withOwnerLabels } from "@/server/queries/owner-labels"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { expectedOutOfFoldPredictions, type ExpectedScoreInput } from "@/lib/calculations/expected"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

const SELECT = `id, title, publication_status_id, total_chapters, is_archived,
  year, year_end, original_title,
  category_scores(criterion_slug, score, source),
  platform_ratings(id, platform, rating, vote_count),
  work_tags(tags(name, tag_group_id))`

// Réplica de buildExpectedInput (não exportado) a partir do WorkComputed mutado.
function toInput(w: any): ExpectedScoreInput {
  return {
    categoryScores: w.categoryScoresCalibrated,
    iaEvalNormalized: w.iaEvalNormalizedCalibrated,
    platformAvg: w.platformAvg,
    totalVotes: w.totalVotes,
    totalChapters: w.totalChapters,
    synopsisQuality: w.synopsisQuality,
    observationAdjustment: w.observationAdjustment,
    publicationStatus: w.publicationStatus,
    lovedTagOverlap: w.lovedTagOverlap,
    avoidedTagOverlap: w.avoidedTagOverlap,
    criterionFitScore: w.criterionFitScore,
    releaseAge: w.releaseAge,
    runLength: w.runLength,
    origin: w.origin,
    postScores: w.postScores,
  }
}

const mae = (pred: number[], y: number[]) => pred.reduce((s, p, i) => s + Math.abs(p - y[i]), 0) / pred.length
const rmse = (pred: number[], y: number[]) => Math.sqrt(pred.reduce((s, p, i) => s + (p - y[i]) ** 2, 0) / pred.length)

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
  const weights = weightsRes.data as ScoreWeight[]
  const config = configRes.data?.[0] as FormulaConfig

  const works = rawWorks.map((r) => buildWork(r, biasMap))
  computeRecalc({ works, weights, config, tasteProfile, declaredTagPrefs, includeQuality: false, aiQualityByWork: new Map(), fast: true })

  const labeled = (works as any[]).filter((w) => w.userScore != null)
  const inputs = labeled.map(toInput)
  const targets = labeled.map((w) => w.userScore as number)
  const withReal = inputs.filter((i) => i.runLength != null).length
  console.log(`rotuladas=${labeled.length} · com RunLength REAL=${withReal} (${(100 * withReal / labeled.length).toFixed(0)}%) · imputadas=${labeled.length - withReal}`)

  // Baseline vs ablado (RunLength constante → variância zero → droppado de fato).
  const inputsDropped = inputs.map((i) => ({ ...i, runLength: 0 }))

  const oofBase = expectedOutOfFoldPredictions(inputs, targets, false)!
  const oofDrop = expectedOutOfFoldPredictions(inputsDropped, targets, false)!

  const maeBase = mae(oofBase, targets), rmseBase = rmse(oofBase, targets)
  const maeDrop = mae(oofDrop, targets), rmseDrop = rmse(oofDrop, targets)

  const pct = (a: number, b: number) => `${((a - b) / b * 100 >= 0 ? "+" : "")}${((a - b) / b * 100).toFixed(2)}%`
  console.log(`\n===== OOF (Ridge puro = a Nota Prevista) =====`)
  console.log(`  COM RunLength:   MAE=${maeBase.toFixed(4)}  RMSE=${rmseBase.toFixed(4)}`)
  console.log(`  SEM RunLength:   MAE=${maeDrop.toFixed(4)}  RMSE=${rmseDrop.toFixed(4)}`)
  console.log(`  Δ MAE (sem−com): ${(maeDrop - maeBase >= 0 ? "+" : "")}${(maeDrop - maeBase).toFixed(4)}  (${pct(maeDrop, maeBase)}) ${maeDrop < maeBase ? "→ DROPAR ajuda ✅" : maeDrop > maeBase ? "→ DROPAR piora ❌" : "→ neutro"}`)

  console.log("\n(ablação read-only — 0 escrita)")
}
main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : e); process.exit(1) })

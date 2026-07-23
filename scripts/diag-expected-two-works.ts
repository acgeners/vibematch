/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * DIAGNÓSTICO read-only: por que a Nota Prevista (expected_score) de duas obras
 * difere. Reproduz o recalc em memória (computeRecalc), pega o Ridge treinado e
 * decompõe a predição das duas obras FEATURE-A-FEATURE (coef × x escalado),
 * mais o blend com Nota.Calc. Auto-verifica contra o expected_score real.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/diag-expected-two-works.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { computeRecalc, buildWork, type RawWork } from "@/server/actions/calculations"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import { getOwnerUserId } from "@/server/queries/current-user"
import { loadOwnerLabels, withOwnerLabels } from "@/server/queries/owner-labels"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import { MedianImputer, StandardScaler, CategoricalImputer, OneHotEncoder, hstack } from "@/lib/ml/preprocessing"
import { normalizeChapters } from "@/lib/calculations/chapters"
import { EXPECTED_BASELINE_FEATURES, EXPECTED_CATEGORICAL_FEATURES } from "@/lib/calculations/expected"
import { CRITERION_SLUGS } from "@/types/domain"
import type { ScoreWeight, FormulaConfig } from "@/types/domain"

const SINOPSE_MAP: Record<string, number> = { "♥": 2, "♥♥": 5, "♥♥♥": 8, "♥♥♥♥": 13 }

// Colunas per-usuário (synopsis_quality, user_score, observation_adjustment,
// post_*) NÃO moram mais em `works` (particionadas na Fase 2) — vêm de
// loadOwnerLabels()/withOwnerLabels(), igual ao recalc real.
const SELECT = `id, title, publication_status_id, total_chapters, is_archived,
  year, year_end, original_title,
  category_scores(criterion_slug, score, source),
  platform_ratings(id, platform, rating, vote_count),
  work_tags(tags(name, tag_group_id))`

// Réplica FIEL de buildNumericRow (expected.ts) com includeQuality=false.
function buildNumericRow(w: any): (number | null)[] {
  const row: (number | null)[] = []
  for (const slug of CRITERION_SLUGS) {
    const v = w.categoryScoresCalibrated[slug]
    row.push(v == null || !Number.isFinite(v) ? null : v)
  }
  row.push(w.iaEvalNormalizedCalibrated ?? null)
  row.push(w.platformAvg ?? null)
  row.push(Math.log1p(Math.max(w.totalVotes, 0)))
  row.push(normalizeChapters(w.totalChapters))
  row.push(w.synopsisQuality ? SINOPSE_MAP[w.synopsisQuality] ?? null : null)
  row.push(w.lovedTagOverlap ?? null)
  row.push(w.avoidedTagOverlap ?? null)
  row.push(w.criterionFitScore ?? null)
  row.push(w.releaseAge ?? null)
  row.push(w.runLength ?? null)
  return row
}
const buildCatRow = (w: any): string[] => [w.publicationStatus || "Unknown", w.origin || "unknown"]

function fmt(v: number | null | undefined, d = 3): string {
  if (v == null || !Number.isFinite(v as number)) return "  null"
  return (v as number).toFixed(d)
}

async function main() {
  const supabase = createAdminClient()
  const ownerId = await getOwnerUserId(supabase)
  const biasMap = await getBiasMap(ownerId, supabase)

  const [worksRes, weightsRes, configRes, tasteProfile, declaredTagPrefs, ownerLabels] = await Promise.all([
    supabase.from("works").select(SELECT).eq("is_archived", false).limit(2000),
    supabase.from("score_weights").select("*").eq("is_active", true),
    supabase.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
    getOwnerUserId().then((id) => loadCurrentTasteProfile(id)),
    getDeclaredTagPreferences(supabase, { headless: true }),
    loadOwnerLabels(),
  ])
  if (worksRes.error) throw new Error(worksRes.error.message)
  const rawWorks = withOwnerLabels(worksRes.data as (RawWork & { title: string })[], ownerLabels)
  const weights = weightsRes.data as ScoreWeight[]
  const config = configRes.data?.[0] as FormulaConfig

  const works = rawWorks.map((r) => buildWork(r, biasMap))
  const res = computeRecalc({
    works, weights, config, tasteProfile, declaredTagPrefs,
    includeQuality: false, aiQualityByWork: new Map(), fast: true,
  })
  const predictor = res.expectedPredictor
  const blendW = res.calcBlendWeight
  const coefs = predictor.model.coefficients
  const intercept = predictor.model.intercept

  console.log(`\ncatálogo=${works.length} · rotuladas=${works.filter((w) => w.userScore != null).length} · blendW(Ridge)=${blendW} · (1-blendW)(Calc)=${(1 - blendW).toFixed(2)} · α=${predictor.model.alpha} · stub=${predictor.isStub}`)

  // Refit do pré-processamento IDÊNTICO ao trainExpectedPredictor (mesmas train rows).
  const trainWorks = works.filter((w) => w.userScore != null)
  const numRows = trainWorks.map(buildNumericRow)
  const numImputer = new MedianImputer().fit(numRows)
  const numScaler = new StandardScaler().fit(numImputer.transform(numRows))
  const catRows = trainWorks.map(buildCatRow)
  const catImputer = new CategoricalImputer().fit(catRows)
  const catEncoder = new OneHotEncoder().fit(catImputer.transform(catRows))
  const featureNames = [
    ...EXPECTED_BASELINE_FEATURES,
    ...catEncoder.featureNames([...EXPECTED_CATEGORICAL_FEATURES] as string[]),
  ]
  if (featureNames.length !== coefs.length) {
    console.warn(`⚠️ featureNames(${featureNames.length}) ≠ coefs(${coefs.length}) — nomes podem estar desalinhados`)
  }

  const scaledVec = (w: any): number[] => {
    const num = numScaler.transform(numImputer.transform([buildNumericRow(w)]))
    const cat = catEncoder.transform(catImputer.transform([buildCatRow(w)]))
    return hstack(num, cat)[0]
  }

  const titleById = new Map(rawWorks.map((r: any) => [r.id, r.title as string]))
  const find = (sub: string) => {
    const hit = [...titleById].find(([, t]) => (t ?? "").toLowerCase().includes(sub.toLowerCase()))
    if (!hit) throw new Error(`obra não encontrada: ${sub}`)
    const w = works.find((x: any) => x.id === hit[0])
    if (!w) throw new Error(`work computed não encontrado: ${sub}`)
    return w as any
  }
  const A = find("A Life for a Lie")
  const B = find("Secret Lady")

  const xA = scaledVec(A)
  const xB = scaledVec(B)
  const contribA = coefs.map((c, i) => c * xA[i])
  const contribB = coefs.map((c, i) => c * xB[i])
  const ridgeA = intercept + contribA.reduce((s, v) => s + v, 0)
  const ridgeB = intercept + contribB.reduce((s, v) => s + v, 0)
  const clamp = (v: number) => Math.max(0, Math.min(10, v))
  const applyObs = (e: number, obs: number) => clamp(e + Math.min(Math.max(obs, -0.3), 0.3))
  const finalA = applyObs(blendW * clamp(ridgeA) + (1 - blendW) * A.calcScoreNoObs, A.observationAdjustment)
  const finalB = applyObs(blendW * clamp(ridgeB) + (1 - blendW) * B.calcScoreNoObs, B.observationAdjustment)

  console.log(`\n===== HEADLINE =====`)
  console.log(`                          A Life for a Lie   Secret Lady`)
  console.log(`  expected_score (real)        ${fmt(A.expectedScore, 3)}         ${fmt(B.expectedScore, 3)}`)
  console.log(`  expected_score (replicado)   ${fmt(finalA, 3)}         ${fmt(finalB, 3)}   ← auto-check`)
  console.log(`  Ridge puro (pré-blend/clamp) ${fmt(ridgeA, 3)}         ${fmt(ridgeB, 3)}`)
  console.log(`  Nota.Calc (calcScoreNoObs)   ${fmt(A.calcScoreNoObs, 3)}         ${fmt(B.calcScoreNoObs, 3)}`)
  console.log(`  obs adjustment               ${fmt(A.observationAdjustment, 3)}         ${fmt(B.observationAdjustment, 3)}`)
  console.log(`  intercept do Ridge = ${fmt(intercept, 3)}`)

  console.log(`\n===== DECOMPOSIÇÃO FEATURE-A-FEATURE (ordenado por |contribA − contribB|) =====`)
  console.log(`  feature                 rawA       rawB    | coef    scaledA scaledB | contribA contribB   Δ(A−B)`)
  const rows = featureNames.map((name, i) => ({
    name, i, coef: coefs[i], sA: xA[i], sB: xB[i], cA: contribA[i], cB: contribB[i], d: contribA[i] - contribB[i],
  }))
  // raw values por feature (pra leitura)
  const rawNumA = buildNumericRow(A), rawNumB = buildNumericRow(B)
  const rawCatA = buildCatRow(A), rawCatB = buildCatRow(B)
  const rawByName: Record<string, [any, any]> = {}
  EXPECTED_BASELINE_FEATURES.forEach((n, k) => { rawByName[n] = [rawNumA[k], rawNumB[k]] })
  // status/origin one-hot: raw = "1" quando a categoria bate
  rows.sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
  for (const r of rows) {
    const raw = rawByName[r.name]
    let rawA = "   —", rawB = "   —"
    if (raw) { rawA = fmt(raw[0], 2); rawB = fmt(raw[1], 2) }
    else {
      // one-hot: mostra status/origin de cada obra
      rawA = r.name.startsWith("Status_") ? (`Status_${rawCatA[0]}` === r.name ? "  1" : "  0")
        : r.name.startsWith("Origin_") ? (`Origin_${rawCatA[1]}` === r.name ? "  1" : "  0") : "   —"
      rawB = r.name.startsWith("Status_") ? (`Status_${rawCatB[0]}` === r.name ? "  1" : "  0")
        : r.name.startsWith("Origin_") ? (`Origin_${rawCatB[1]}` === r.name ? "  1" : "  0") : "   —"
    }
    console.log(`  ${r.name.padEnd(22)} ${rawA.padStart(6)}     ${rawB.padStart(6)}  | ${fmt(r.coef, 3).padStart(6)}  ${fmt(r.sA, 2).padStart(5)}  ${fmt(r.sB, 2).padStart(5)} | ${fmt(r.cA, 3).padStart(7)}  ${fmt(r.cB, 3).padStart(7)}  ${(r.d >= 0 ? "+" : "") + r.d.toFixed(3)}`)
  }

  const totalDiff = ridgeA - ridgeB
  console.log(`\n  Σ contribuições (Ridge A − Ridge B) = ${(totalDiff >= 0 ? "+" : "") + totalDiff.toFixed(3)}`)
  console.log(`  (Δ do expected_score final = ${((A.expectedScore ?? 0) - (B.expectedScore ?? 0)).toFixed(3)})`)

  console.log(`\n===== CONTEXTO (features cruas relevantes) =====`)
  const ctx = (w: any) => `status=${w.publicationStatus} origin=${w.origin} votos=${w.totalVotes} caps=${w.totalChapters} idade=${w.releaseAge} runLen=${w.runLength} platAvg=${fmt(w.platformAvg, 2)} lovedTag=${fmt(w.lovedTagOverlap, 3)} avoidedTag=${fmt(w.avoidedTagOverlap, 3)} critFit=${fmt(w.criterionFitScore, 3)} sinopse=${w.synopsisQuality} IA(n)=${fmt(w.iaEvalNormalizedCalibrated, 2)}`
  console.log(`  A: ${ctx(A)}`)
  console.log(`  B: ${ctx(B)}`)

  console.log("\n(diagnóstico read-only — 0 escrita, 0 LLM)")
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : e); process.exit(1) })

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AUDITORIA read-only: acha obras cuja Nota Prevista pode estar distorcida por
 * OUTLIER de feature (um valor cru extremo que, após o StandardScaler, vira ±Nσ e
 * domina o Ridge linear). Generaliza o caso do RunLength negativo pra QUALQUER
 * feature. Também imprime a decomposição de obras nomeadas via argv.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/diag-expected-outlier-audit.ts "The Maiden Trials"
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
const OUTLIER_SIGMA = 4 // |scaled| acima disto = input fora da distribuição de treino
const DOMINANCE = 0.8   // uma única feature movendo a nota >0.8 ponto = suspeito

const SELECT = `id, title, publication_status_id, total_chapters, is_archived,
  year, year_end, original_title,
  category_scores(criterion_slug, score, source),
  platform_ratings(id, platform, rating, vote_count),
  work_tags(tags(name, tag_group_id))`

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
const f = (v: any, d = 2) => (v == null || !Number.isFinite(Number(v)) ? "null" : Number(v).toFixed(d))

async function main() {
  const wanted = process.argv.slice(2)
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
  if (worksRes.error) throw new Error(worksRes.error.message)
  const rawWorks = withOwnerLabels(worksRes.data as (RawWork & { title: string })[], ownerLabels)
  const weights = weightsRes.data as ScoreWeight[]
  const config = configRes.data?.[0] as FormulaConfig
  const titleById = new Map(rawWorks.map((r: any) => [r.id, r.title as string]))
  const labeledIds = new Set(rawWorks.filter((r: any) => r.user_score != null).map((r: any) => r.id))

  const works = rawWorks.map((r) => buildWork(r, biasMap))
  const res = computeRecalc({ works, weights, config, tasteProfile, declaredTagPrefs, includeQuality: false, aiQualityByWork: new Map(), fast: true })
  const coefs = res.expectedPredictor.model.coefficients
  const intercept = res.expectedPredictor.model.intercept
  const blendW = res.calcBlendWeight

  const trainWorks = works.filter((w: any) => w.userScore != null)
  const numImputer = new MedianImputer().fit(trainWorks.map(buildNumericRow))
  const numScaler = new StandardScaler().fit(numImputer.transform(trainWorks.map(buildNumericRow)))
  const catImputer = new CategoricalImputer().fit(trainWorks.map(buildCatRow))
  const catEncoder = new OneHotEncoder().fit(catImputer.transform(trainWorks.map(buildCatRow)))
  const featureNames = [...EXPECTED_BASELINE_FEATURES, ...catEncoder.featureNames([...EXPECTED_CATEGORICAL_FEATURES] as string[])]
  const scaledVec = (w: any) =>
    hstack(numScaler.transform(numImputer.transform([buildNumericRow(w)])), catEncoder.transform(catImputer.transform([buildCatRow(w)])))[0]

  console.log(`catálogo=${works.length} · rotuladas=${trainWorks.length} · blendW=${blendW.toFixed(3)} · limiar outlier=±${OUTLIER_SIGMA}σ · dominância=${DOMINANCE}pt`)

  // ---- 1) OUTLIERS DE INPUT (|scaled| > Nσ) em obras NÃO rotuladas ----
  // (rotuladas o Ridge ajusta de perto; o risco de nota "estranha" é nas não-lidas)
  type Flag = { id: string; title: string; expected: number; feat: string; raw: any; scaled: number; contrib: number; labeled: boolean }
  const flags: Flag[] = []
  const domFlags: Flag[] = []
  for (const w of works as any[]) {
    const x = scaledVec(w)
    const rawNum = buildNumericRow(w)
    let maxDomFeat = "", maxDom = 0, maxDomRaw: any = null, maxDomScaled = 0
    for (let i = 0; i < featureNames.length; i++) {
      const contrib = coefs[i] * x[i]
      const rawVal = i < EXPECTED_BASELINE_FEATURES.length ? rawNum[i] : (x[i] === 1 ? "1" : "0")
      if (Math.abs(x[i]) > OUTLIER_SIGMA) {
        flags.push({ id: w.id, title: titleById.get(w.id) ?? "?", expected: w.expectedScore, feat: featureNames[i], raw: rawVal, scaled: x[i], contrib, labeled: labeledIds.has(w.id) })
      }
      if (Math.abs(contrib) > Math.abs(maxDom)) { maxDom = contrib; maxDomFeat = featureNames[i]; maxDomRaw = rawVal; maxDomScaled = x[i] }
    }
    if (Math.abs(maxDom) > DOMINANCE) {
      domFlags.push({ id: w.id, title: titleById.get(w.id) ?? "?", expected: w.expectedScore, feat: maxDomFeat, raw: maxDomRaw, scaled: maxDomScaled, contrib: maxDom, labeled: labeledIds.has(w.id) })
    }
  }

  console.log(`\n===== 1) OUTLIERS DE INPUT (|scaled| > ${OUTLIER_SIGMA}σ) =====`)
  if (!flags.length) console.log("  nenhum ✅")
  flags.sort((a, b) => Math.abs(b.scaled) - Math.abs(a.scaled))
  for (const fl of flags) console.log(`  ${(fl.labeled ? "[rotulada] " : "").padStart(0)}${fl.title.slice(0, 40).padEnd(40)} exp=${f(fl.expected)} · ${fl.feat}: raw=${f(fl.raw)} scaled=${f(fl.scaled, 1)}σ contrib=${f(fl.contrib)}`)

  console.log(`\n===== 2) DOMINÂNCIA: 1 feature move a nota > ${DOMINANCE}pt (não-rotuladas) =====`)
  const dom = domFlags.filter((d) => !d.labeled).sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
  if (!dom.length) console.log("  nenhuma ✅")
  for (const d of dom.slice(0, 25)) console.log(`  ${d.title.slice(0, 40).padEnd(40)} exp=${f(d.expected)} · ${d.feat}: raw=${f(d.raw)} scaled=${f(d.scaled, 1)}σ → contrib=${f(d.contrib)}`)

  // ---- 3) decomposição das obras nomeadas ----
  for (const name of wanted) {
    const hit = [...titleById].find(([, t]) => (t ?? "").toLowerCase().includes(name.toLowerCase()))
    if (!hit) { console.log(`\n(obra não encontrada: ${name})`); continue }
    const w = (works as any[]).find((x) => x.id === hit[0])
    const x = scaledVec(w)
    const rawNum = buildNumericRow(w)
    const rows = featureNames.map((nm, i) => ({ nm, coef: coefs[i], raw: i < EXPECTED_BASELINE_FEATURES.length ? rawNum[i] : (x[i] === 1 ? 1 : 0), scaled: x[i], contrib: coefs[i] * x[i] }))
      .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
    console.log(`\n===== 3) DECOMPOSIÇÃO — ${hit[1]} (exp=${f(w.expectedScore)}, ${labeledIds.has(w.id) ? "ROTULADA user_score=" + f((w as any).userScore) : "não-lida"}) =====`)
    console.log(`  intercept=${f(intercept)} · votos=${w.totalVotes} caps=${w.totalChapters} ano=${2026 - (w.releaseAge ?? 0)} runLen=${w.runLength} platAvg=${f(w.platformAvg)}`)
    for (const r of rows.slice(0, 12)) console.log(`  ${r.nm.padEnd(20)} raw=${String(f(r.raw)).padStart(7)} coef=${f(r.coef, 3).padStart(7)} scaled=${f(r.scaled, 1).padStart(6)}σ contrib=${f(r.contrib, 3).padStart(7)}`)
  }
  console.log("\n(auditoria read-only — 0 escrita)")
}
main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : e); process.exit(1) })

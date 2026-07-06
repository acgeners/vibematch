/**
 * Fase 4 — mede candidatos a refino ANTES de shipar ($0, read-only):
 *  (1) Interesse contínuo (banda × confidence) vs ordinal — ajuda o modelo da Chance?
 *  (2) Rating agregado de work_reviews.user_rating — agrega além do platform_avg?
 *
 * Uso: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/chance-refine-measure.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js"
import { trainChancePredictor, CHANCE_LIKED_THRESHOLD, type ChanceInput } from "@/lib/calculations/chance"
import { auc, logLoss, kFoldIndices } from "@/lib/ml/logistic"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function fetchAll<T>(table: string, cols: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).range(from, from + 999)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < 1000) break
  }
  return out
}
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const std = (a: number[]) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)) }
function pearson(x: number[], y: number[]) {
  const n = x.length; if (n < 3) return NaN
  const mx = mean(x), my = mean(y); let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2 }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy)
}
const INTEREST_ORD: Record<string, number> = { "♥": 1, "♥♥": 2, "♥♥♥": 3, "♥♥♥♥": 4 }
const promptVer = (v: string | null) => { const m = (v ?? "").match(/(\d+)/); return m ? parseInt(m[1], 10) : -1 }

function oofAucBrier(inputs: ChanceInput[], labels: number[]) {
  const N = inputs.length
  const oof = new Array<number>(N).fill(0.5)
  for (const fold of kFoldIndices(N, 5)) {
    const test = new Set(fold)
    const trIn: ChanceInput[] = [], trY: number[] = []
    for (let i = 0; i < N; i++) if (!test.has(i)) { trIn.push(inputs[i]); trY.push(labels[i]) }
    const p = trainChancePredictor(trIn, trY)
    const out = p.predict(fold.map((i) => inputs[i]))
    fold.forEach((i, k) => (oof[i] = out[k]))
  }
  return { auc: auc(oof, labels), brier: mean(oof.map((p, i) => (p - labels[i]) ** 2)), logloss: logLoss(oof, labels) }
}

async function main() {
  const works = await fetchAll<any>("works", "id, user_score, synopsis_quality, is_archived", (q) => q.not("user_score", "is", null).eq("is_archived", false))
  const ids = works.map((w) => w.id)
  const cs = await fetchAll<any>("calculated_scores", "work_id, personal_fit, platform_avg")
  const pf = new Map(cs.map((r) => [r.work_id, r.personal_fit]))
  const platform = new Map(cs.map((r) => [r.work_id, r.platform_avg]))

  const catRows = await fetchAll<any>("category_scores", "work_id, criterion_slug, score")
  const catByWork = new Map<string, Record<string, number>>()
  for (const r of catRows) { if (!catByWork.has(r.work_id)) catByWork.set(r.work_id, {}); if (r.score != null) catByWork.get(r.work_id)![r.criterion_slug] = r.score }

  // Interesse: banda + confidence (manual → conf=1)
  const preds = await fetchAll<any>("synopsis_quality_predictions", "work_id, predicted_quality, prompt_version, confidence")
  const bestPred = new Map<string, { ver: number; q: string | null; conf: number | null }>()
  for (const r of preds) { const ver = promptVer(r.prompt_version); const prev = bestPred.get(r.work_id); if (!prev || ver > prev.ver) bestPred.set(r.work_id, { ver, q: r.predicted_quality ?? null, conf: r.confidence ?? null }) }

  const prefRows = await fetchAll<any>("user_tag_preferences", "tag_id, stance", (q) => q.not("tag_id", "is", null))
  const stanceByTag = new Map(prefRows.map((p) => [p.tag_id, p.stance]))
  const wtByWork = new Map<string, string[]>()
  for (let i = 0; i < ids.length; i += 150) {
    const wt = await fetchAll<any>("work_tags", "work_id, tag_id", (q) => q.in("work_id", ids.slice(i, i + 150)))
    for (const r of wt) { if (!wtByWork.has(r.work_id)) wtByWork.set(r.work_id, []); wtByWork.get(r.work_id)!.push(r.tag_id) }
  }

  // (2) review ratings
  const reviewRating = new Map<string, number[]>()
  for (let i = 0; i < ids.length; i += 150) {
    const rv = await fetchAll<any>("work_reviews", "work_id, user_rating", (q) => q.in("work_id", ids.slice(i, i + 150)).not("user_rating", "is", null))
    for (const r of rv) { if (!reviewRating.has(r.work_id)) reviewRating.set(r.work_id, []); reviewRating.get(r.work_id)!.push(Number(r.user_rating)) }
  }

  const baseInput = (w: any): Omit<ChanceInput, "interesseOrdinal"> => {
    const tags = wtByWork.get(w.id) ?? []
    let love = 0, avoid = 0
    for (const t of tags) { const s = stanceByTag.get(t); if (s === "love") love++; else if (s === "avoid") avoid++ }
    const n = Math.max(tags.length, 1)
    return { categoryScores: (catByWork.get(w.id) ?? {}) as any, declaredLovedFrac: love / n, declaredAvoidedFrac: avoid / n, personalFit: pf.get(w.id) ?? null }
  }

  const labels = works.map((w) => (w.user_score >= CHANCE_LIKED_THRESHOLD ? 1 : 0))

  // variante A: ordinal ; B: contínuo (banda encolhida pra 2.5 quando pouco confiante)
  const inputsOrdinal: ChanceInput[] = []
  const inputsContinuous: ChanceInput[] = []
  let confCov = 0
  for (const w of works) {
    const base = baseInput(w)
    const manual = w.synopsis_quality ?? null
    const band = manual ?? bestPred.get(w.id)?.q ?? null
    const ord = band && INTEREST_ORD[band] != null ? INTEREST_ORD[band] : null
    const conf = manual ? 1 : bestPred.get(w.id)?.conf ?? null
    if (conf != null && !manual) confCov++
    const cont = ord != null ? (ord - 2.5) * (conf ?? 0.5) + 2.5 : null
    inputsOrdinal.push({ ...base, interesseOrdinal: ord })
    inputsContinuous.push({ ...base, interesseOrdinal: cont })
  }

  console.log(`n=${works.length} · base rate=${(mean(labels) * 100).toFixed(0)}% · previsões c/ confidence=${confCov}`)
  console.log("\n" + "=".repeat(64) + "\n(1) Interesse ORDINAL vs CONTÍNUO (banda × confidence)\n" + "=".repeat(64))
  const a = oofAucBrier(inputsOrdinal, labels)
  const b = oofAucBrier(inputsContinuous, labels)
  console.log(`  ordinal .... AUC ${a.auc.toFixed(3)}  Brier ${a.brier.toFixed(3)}  logloss ${a.logloss.toFixed(3)}`)
  console.log(`  contínuo ... AUC ${b.auc.toFixed(3)}  Brier ${b.brier.toFixed(3)}  logloss ${b.logloss.toFixed(3)}`)
  console.log(`  → Δ AUC ${(b.auc - a.auc >= 0 ? "+" : "") + (b.auc - a.auc).toFixed(3)}  ${b.auc > a.auc + 0.003 ? "(vale)" : "(neutro/pior — não shipar)"}`)

  console.log("\n" + "=".repeat(64) + "\n(2) Rating de reviews (work_reviews.user_rating) vs platform_avg\n" + "=".repeat(64))
  const rr: { work: string; rr: number; pa: number | null; us: number }[] = []
  for (const w of works) {
    const arr = reviewRating.get(w.id)
    if (arr && arr.length) rr.push({ work: w.id, rr: mean(arr), pa: platform.get(w.id) ?? null, us: w.user_score })
  }
  console.log(`  obras com ≥1 review-rating: ${rr.length}/${works.length} (${((rr.length / works.length) * 100).toFixed(0)}%)`)
  if (rr.length > 10) {
    const withPa = rr.filter((r) => r.pa != null)
    console.log(`  corr(review-rating, platform_avg) = ${pearson(withPa.map((r) => r.rr), withPa.map((r) => r.pa as number)).toFixed(3)}  (alto ⇒ redundante)`)
    console.log(`  corr(review-rating, user_score)   = ${pearson(rr.map((r) => r.rr), rr.map((r) => r.us)).toFixed(3)}   (vs platform_avg~0.36 no gate)`)
    console.log(`  review-rating: média ${mean(rr.map((r) => r.rr)).toFixed(2)} dp ${std(rr.map((r) => r.rr)).toFixed(2)}`)
  }
  console.log("\n✓ medição concluída.\n")
}
main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : String(e)); process.exit(1) })

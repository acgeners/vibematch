/**
 * Validação do modelo "Chance de gostar" (Fase 1 da Bússola) — $0, read-only.
 *
 * Treina `trainChancePredictor` nas obras rotuladas e reporta:
 *  - AUC + log-loss out-of-fold (poder discriminativo)
 *  - Brier + curva de confiabilidade (qualidade da CALIBRAÇÃO — o "%" é honesto?)
 *  - amostra de Chances calibradas reais (topo/base)
 *
 * Uso: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/chance-validate.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js"
import { trainChancePredictor, CHANCE_LIKED_THRESHOLD, type ChanceInput } from "@/lib/calculations/chance"
import { auc, logLoss, kFoldIndices } from "@/lib/ml/logistic"

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL || !KEY) throw new Error("faltam env vars do Supabase")
const sb = createClient(URL, KEY, { auth: { persistSession: false } })

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
const INTEREST_ORD: Record<string, number> = { "♥": 1, "♥♥": 2, "♥♥♥": 3, "♥♥♥♥": 4 }
const promptVer = (v: string | null) => { const m = (v ?? "").match(/(\d+)/); return m ? parseInt(m[1], 10) : -1 }

async function main() {
  console.log("carregando obras rotuladas…\n")
  const works = await fetchAll<any>("works", "id, title, user_score, synopsis_quality, is_archived", (q) =>
    q.not("user_score", "is", null).eq("is_archived", false),
  )
  const ids = works.map((w) => w.id)

  const cs = await fetchAll<any>("calculated_scores", "work_id, personal_fit")
  const pfByWork = new Map(cs.map((r) => [r.work_id, r.personal_fit]))

  const catRows = await fetchAll<any>("category_scores", "work_id, criterion_slug, score")
  const catByWork = new Map<string, Record<string, number>>()
  for (const r of catRows) {
    if (!catByWork.has(r.work_id)) catByWork.set(r.work_id, {})
    if (r.score != null) catByWork.get(r.work_id)![r.criterion_slug] = r.score
  }

  const preds = await fetchAll<any>("synopsis_quality_predictions", "work_id, predicted_quality, prompt_version")
  const bestPred = new Map<string, { ver: number; q: string | null }>()
  for (const r of preds) {
    const ver = promptVer(r.prompt_version)
    const prev = bestPred.get(r.work_id)
    if (!prev || ver > prev.ver) bestPred.set(r.work_id, { ver, q: r.predicted_quality ?? null })
  }

  const prefRows = await fetchAll<any>("user_tag_preferences", "tag_id, stance", (q) => q.not("tag_id", "is", null))
  const stanceByTag = new Map<string, string>()
  for (const p of prefRows) stanceByTag.set(p.tag_id, p.stance)

  const wtByWork = new Map<string, string[]>()
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    const wt = await fetchAll<any>("work_tags", "work_id, tag_id", (q) => q.in("work_id", chunk))
    for (const r of wt) {
      if (!wtByWork.has(r.work_id)) wtByWork.set(r.work_id, [])
      wtByWork.get(r.work_id)!.push(r.tag_id)
    }
  }

  // montar ChanceInput[] + labels
  const inputs: ChanceInput[] = []
  const labels: number[] = []
  const meta: { title: string; user: number }[] = []
  for (const w of works) {
    const tags = wtByWork.get(w.id) ?? []
    let love = 0, avoid = 0
    for (const t of tags) { const s = stanceByTag.get(t); if (s === "love") love++; else if (s === "avoid") avoid++ }
    const n = Math.max(tags.length, 1)
    const band = w.synopsis_quality ?? bestPred.get(w.id)?.q ?? null
    inputs.push({
      categoryScores: (catByWork.get(w.id) ?? {}) as any,
      declaredLovedFrac: love / n,
      declaredAvoidedFrac: avoid / n,
      personalFit: pfByWork.get(w.id) ?? null,
      interesseOrdinal: band && INTEREST_ORD[band] != null ? INTEREST_ORD[band] : null,
    })
    labels.push(w.user_score >= CHANCE_LIKED_THRESHOLD ? 1 : 0)
    meta.push({ title: w.title, user: w.user_score })
  }
  const N = inputs.length
  console.log(`n=${N}  ·  "gostou" (user_score ≥ ${CHANCE_LIKED_THRESHOLD}) base rate = ${(mean(labels) * 100).toFixed(0)}%`)

  // modelo em todos os dados (para inspecionar λ, coefs, amostra)
  const full = trainChancePredictor(inputs, labels)
  console.log(`\nmodelo (todos os dados): λ=${full.model.lambda}  cvAUC=${full.cvAUC.toFixed(3)}  cvLogLoss=${full.cvLogLoss.toFixed(3)}  platt A=${full.platt.A.toFixed(2)} B=${full.platt.B.toFixed(2)}`)

  // ---- OOF honesto (5-fold externo, treino completo por fold incl. calibração) ----
  const oof = new Array<number>(N).fill(0.5)
  for (const fold of kFoldIndices(N, 5)) {
    const test = new Set(fold)
    const trIn: ChanceInput[] = [], trY: number[] = []
    for (let i = 0; i < N; i++) if (!test.has(i)) { trIn.push(inputs[i]); trY.push(labels[i]) }
    const p = trainChancePredictor(trIn, trY)
    const out = p.predict(fold.map((i) => inputs[i]))
    fold.forEach((i, k) => (oof[i] = out[k]))
  }
  const oofAUC = auc(oof, labels)
  const brier = mean(oof.map((p, i) => (p - labels[i]) ** 2))
  const oofLoss = logLoss(oof, labels)
  console.log("\n" + "=".repeat(64) + "\nDISCRIMINAÇÃO (OOF honesto)\n" + "=".repeat(64))
  console.log(`  AUC=${oofAUC.toFixed(3)}  ·  log-loss=${oofLoss.toFixed(3)}  ·  Brier=${brier.toFixed(3)}  (base Brier=${(mean(labels) * (1 - mean(labels))).toFixed(3)})`)

  // ---- Calibração: bins de probabilidade prevista vs frequência observada ----
  console.log("\n" + "=".repeat(64) + "\nCALIBRAÇÃO (o \"%\" é honesto?)\n" + "=".repeat(64))
  console.log("  faixa prevista   n   Chance média   gostou de fato")
  for (let b = 0; b < 5; b++) {
    const lo = b * 0.2, hi = (b + 1) * 0.2
    const idx = oof.map((p, i) => ({ p, i })).filter((x) => x.p >= lo && (b === 4 ? x.p <= hi : x.p < hi))
    if (!idx.length) { console.log(`  ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%            0    —              —`); continue }
    const predMean = mean(idx.map((x) => x.p))
    const obs = mean(idx.map((x) => labels[x.i]))
    console.log(`  ${(lo * 100).toFixed(0).padStart(2)}–${(hi * 100).toFixed(0)}%          ${String(idx.length).padStart(3)}   ${(predMean * 100).toFixed(0).padStart(3)}%           ${(obs * 100).toFixed(0).padStart(3)}%`)
  }

  // ---- Amostra: maiores e menores Chances (modelo full) ----
  const scores = full.predictScore(inputs)
  const ranked = scores.map((s, i) => ({ s, i })).sort((a, b) => b.s - a.s)
  const show = (r: { s: number; i: number }) =>
    `${r.s.toFixed(0).padStart(3)}%  ${meta[r.i].title.slice(0, 40).padEnd(40)} (nota real ${meta[r.i].user})`
  console.log("\n" + "=".repeat(64) + "\nAMOSTRA — maior Chance de gostar\n" + "=".repeat(64))
  ranked.slice(0, 8).forEach((r) => console.log("  " + show(r)))
  console.log("\n— menor Chance de gostar —")
  ranked.slice(-8).forEach((r) => console.log("  " + show(r)))

  console.log("\n✓ validação concluída.\n")
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : String(e)); process.exit(1) })

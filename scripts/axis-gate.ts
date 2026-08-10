/**
 * GATE EMPÍRICO — Fit × Mérito (análise exploratória, $0, read-only).
 *
 * Testa nas obras rotuladas (com user_score) se faz sentido separar a Nota
 * Prevista em 2 eixos: "chance de gostar" (Fit/taste) vs "teto" (Mérito/consenso).
 *
 * 3 perguntas:
 *   1. Fit prevê o quanto o user gosta? (corr + AUC OOF vs base rate)
 *   2. Consenso externo explica a nota? (corr + OOF MAE vs baseline média)
 *   3. Fit e Mérito são SEPARÁVEIS ou colineares? (corr entre composites +
 *      ganho incremental OOF de um sobre o outro)
 *
 * Sem migration, sem escrita, sem LLM. Uso: npx tsx --env-file=.env.local --env-file=.env.analysis scripts/axis-gate.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

// ---------- helpers de paginação ----------
async function fetchAll<T>(table: string, cols: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(cols).range(from, from + PAGE - 1)
    if (filter) q = filter(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

// ---------- stats ----------
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0)
const std = (a: number[]) => {
  if (a.length < 2) return 0
  const m = mean(a)
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1))
}
const median = (a: number[]) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
function pearson(x: number[], y: number[]): number {
  const n = x.length
  if (n < 3) return NaN
  const mx = mean(x), my = mean(y)
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    num += (x[i] - mx) * (y[i] - my)
    dx += (x[i] - mx) ** 2
    dy += (y[i] - my) ** 2
  }
  return dx === 0 || dy === 0 ? NaN : num / Math.sqrt(dx * dy)
}
function rank(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0])
  const r = new Array(a.length).fill(0)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg
    i = j + 1
  }
  return r
}
const spearman = (x: number[], y: number[]) => pearson(rank(x), rank(y))

// AUC via Mann-Whitney (prob de rankear positivo acima de negativo)
function auc(scores: number[], labels: number[]): number {
  const pos: number[] = [], neg: number[] = []
  for (let i = 0; i < scores.length; i++) (labels[i] ? pos : neg).push(scores[i])
  if (!pos.length || !neg.length) return NaN
  const r = rank(scores)
  let sumPos = 0
  for (let i = 0; i < labels.length; i++) if (labels[i]) sumPos += r[i]
  return (sumPos - (pos.length * (pos.length + 1)) / 2) / (pos.length * neg.length)
}

// ---------- modelos (GD, z-score no fold de treino) ----------
type Row = { x: number[]; y: number }
function standardizeFit(rows: number[][]) {
  const d = rows[0].length
  const med: number[] = [], mu: number[] = [], sd: number[] = []
  for (let j = 0; j < d; j++) {
    const col = rows.map((r) => r[j]).filter((v) => Number.isFinite(v))
    med[j] = median(col)
  }
  const imp = rows.map((r) => r.map((v, j) => (Number.isFinite(v) ? v : med[j])))
  for (let j = 0; j < d; j++) {
    const col = imp.map((r) => r[j])
    mu[j] = mean(col); sd[j] = std(col) || 1
  }
  const apply = (raw: number[][]) =>
    raw.map((r) => r.map((v, j) => ((Number.isFinite(v) ? v : med[j]) - mu[j]) / sd[j]))
  return { train: apply(rows), apply }
}
function ridgeGD(X: number[][], y: number[], lambda = 1, iters = 4000, lr = 0.05) {
  const n = X.length, d = X[0].length
  const w = new Array(d).fill(0); let b = 0
  for (let t = 0; t < iters; t++) {
    const gw = new Array(d).fill(0); let gb = 0
    for (let i = 0; i < n; i++) {
      let p = b
      for (let j = 0; j < d; j++) p += w[j] * X[i][j]
      const e = p - y[i]
      gb += e
      for (let j = 0; j < d; j++) gw[j] += e * X[i][j]
    }
    b -= lr * (gb / n)
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * w[j])
  }
  return (x: number[]) => { let p = b; for (let j = 0; j < d; j++) p += w[j] * x[j]; return p }
}
function logisticGD(X: number[][], y: number[], lambda = 1, iters = 4000, lr = 0.1) {
  const n = X.length, d = X[0].length
  const w = new Array(d).fill(0); let b = 0
  const sig = (z: number) => 1 / (1 + Math.exp(-z))
  for (let t = 0; t < iters; t++) {
    const gw = new Array(d).fill(0); let gb = 0
    for (let i = 0; i < n; i++) {
      let z = b
      for (let j = 0; j < d; j++) z += w[j] * X[i][j]
      const e = sig(z) - y[i]
      gb += e
      for (let j = 0; j < d; j++) gw[j] += e * X[i][j]
    }
    b -= lr * (gb / n)
    for (let j = 0; j < d; j++) w[j] -= lr * (gw[j] / n + lambda * w[j])
  }
  return (x: number[]) => { let z = b; for (let j = 0; j < d; j++) z += w[j] * x[j]; return sig(z) }
}

function kfold(n: number, k: number, seed = 42): number[][] {
  const order = Array.from({ length: n }, (_, i) => i)
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[order[i], order[j]] = [order[j], order[i]] }
  const folds: number[][] = Array.from({ length: k }, () => [])
  for (let i = 0; i < n; i++) folds[i % k].push(order[i])
  return folds
}

// OOF predictions p/ um conjunto de features (regressão)
function oofRidge(rows: Row[], k = 5, lambda = 1): number[] {
  const n = rows.length, preds = new Array(n).fill(NaN)
  for (const fold of kfold(n, k)) {
    const te = new Set(fold)
    const trX = rows.filter((_, i) => !te.has(i)).map((r) => r.x)
    const trY = rows.filter((_, i) => !te.has(i)).map((r) => r.y)
    const std = standardizeFit(trX)
    const model = ridgeGD(std.train, trY, lambda)
    fold.forEach((i) => { preds[i] = model(std.apply([rows[i].x])[0]) })
  }
  return preds
}
function oofLogistic(rows: Row[], k = 5, lambda = 1): number[] {
  const n = rows.length, preds = new Array(n).fill(NaN)
  for (const fold of kfold(n, k)) {
    const te = new Set(fold)
    const trX = rows.filter((_, i) => !te.has(i)).map((r) => r.x)
    const trY = rows.filter((_, i) => !te.has(i)).map((r) => r.y)
    const std = standardizeFit(trX)
    const model = logisticGD(std.train, trY, lambda)
    fold.forEach((i) => { preds[i] = model(std.apply([rows[i].x])[0]) })
  }
  return preds
}
const maeOf = (p: number[], y: number[]) => mean(p.map((v, i) => Math.abs(v - y[i])))

// NDCG@k (ganhos lineares = user_score)
function ndcg(order: number[], gains: number[], k: number): number {
  const dcg = (ord: number[]) => ord.slice(0, k).reduce((s, idx, i) => s + gains[idx] / Math.log2(i + 2), 0)
  const ideal = [...gains.keys()].sort((a, b) => gains[b] - gains[a])
  const id = dcg(ideal)
  return id === 0 ? 0 : dcg(order) / id
}

// ---------- Interesse: banda ♥ → ordinal ----------
const INTEREST_ORD: Record<string, number> = { "♥": 1, "♥♥": 2, "♥♥♥": 3, "♥♥♥♥": 4 }
const promptVer = (v: string | null) => { const m = (v ?? "").match(/(\d+)/); return m ? parseInt(m[1], 10) : -1 }

// ---------- MAIN ----------
async function main() {
  console.log("carregando acervo rotulado…\n")

  const works = await fetchAll<any>(
    "works",
    "id, user_score, synopsis_quality, is_archived",
    (q) => q.not("user_score", "is", null).eq("is_archived", false),
  )
  const ids = works.map((w) => w.id)
  console.log(`obras com user_score (não arquivadas): ${works.length}`)

  const cs = await fetchAll<any>("calculated_scores", "work_id, platform_avg, total_votes, ia_eval_normalized, calc_score, expected_score, personal_fit, personal_fit_percentile")
  const csByWork = new Map(cs.map((r) => [r.work_id, r]))

  // category_scores: 9 critérios IA por obra
  const catRows = await fetchAll<any>("category_scores", "work_id, criterion_slug, score")
  const catByWork = new Map<string, Record<string, number>>()
  for (const r of catRows) {
    if (!catByWork.has(r.work_id)) catByWork.set(r.work_id, {})
    if (r.score != null) catByWork.get(r.work_id)![r.criterion_slug] = r.score
  }
  const critSlugs = Array.from(new Set(catRows.map((r) => r.criterion_slug))).sort()

  // Interesse efetivo: manual senão previsão de maior versão
  const preds = await fetchAll<any>("synopsis_quality_predictions", "work_id, predicted_quality, prompt_version")
  const bestPred = new Map<string, { ver: number; q: string | null }>()
  for (const r of preds) {
    const ver = promptVer(r.prompt_version)
    const prev = bestPred.get(r.work_id)
    if (!prev || ver > prev.ver) bestPred.set(r.work_id, { ver, q: r.predicted_quality ?? null })
  }
  const effInterest = (w: any): number | null => {
    const band = w.synopsis_quality ?? bestPred.get(w.id)?.q ?? null
    return band && INTEREST_ORD[band] != null ? INTEREST_ORD[band] : null
  }

  // ---------- montar dataset ----------
  type Rec = { y: number; fit: number[]; ext: number[]; content: number[]; expected: number | null }
  const recs: Rec[] = []
  const cov = { personal_fit: 0, pf_pct: 0, interesse: 0, platform: 0, votes: 0, cat: 0, expected: 0 }
  for (const w of works) {
    const c = csByWork.get(w.id) ?? {}
    const cats = catByWork.get(w.id) ?? {}
    const catVec = critSlugs.map((s) => (cats[s] != null ? cats[s] : NaN))
    const interesse = effInterest(w)
    const logVotes = c.total_votes != null ? Math.log1p(Math.max(c.total_votes, 0)) : NaN

    if (Number.isFinite(c.personal_fit)) cov.personal_fit++
    if (Number.isFinite(c.personal_fit_percentile)) cov.pf_pct++
    if (interesse != null) cov.interesse++
    if (Number.isFinite(c.platform_avg)) cov.platform++
    if (Number.isFinite(c.total_votes) && c.total_votes > 0) cov.votes++
    if (catVec.some((v) => Number.isFinite(v))) cov.cat++
    if (Number.isFinite(c.expected_score)) cov.expected++

    recs.push({
      y: w.user_score,
      fit: [c.personal_fit ?? NaN, c.personal_fit_percentile ?? NaN, interesse ?? NaN],
      ext: [c.platform_avg ?? NaN, logVotes],
      content: [...catVec, c.ia_eval_normalized ?? NaN, c.calc_score ?? NaN],
      expected: Number.isFinite(c.expected_score) ? c.expected_score : null,
    })
  }
  const n = recs.length
  const y = recs.map((r) => r.y)

  console.log(`critérios IA detectados: ${critSlugs.length} (${critSlugs.join(", ")})`)
  console.log("\ncobertura dos sinais (nº de obras com valor):")
  console.log(`  personal_fit=${cov.personal_fit}  pf_percentile=${cov.pf_pct}  interesse=${cov.interesse}  platform_avg=${cov.platform}  votos>0=${cov.votes}  category_scores=${cov.cat}  expected_score=${cov.expected}`)

  // ---------- distribuição do alvo ----------
  console.log(`\nuser_score — n=${n}  média=${mean(y).toFixed(2)}  dp=${std(y).toFixed(2)}  mediana=${median(y).toFixed(2)}  min=${Math.min(...y).toFixed(1)}  max=${Math.max(...y).toFixed(1)}`)

  // ========== TESTE 1: Fit prevê o quanto gosta? ==========
  console.log("\n" + "=".repeat(70) + "\nTESTE 1 — Fit (taste) prevê user_score?\n" + "=".repeat(70))
  const fitNames = ["personal_fit", "personal_fit_pct", "interesse(1-4)"]
  recs[0].fit.forEach((_, j) => {
    const pairs = recs.map((r) => [r.fit[j], r.y]).filter(([a]) => Number.isFinite(a))
    const xs = pairs.map((p) => p[0]), ys = pairs.map((p) => p[1])
    console.log(`  ${fitNames[j].padEnd(18)} n=${xs.length}  pearson=${pearson(xs, ys).toFixed(3)}  spearman=${spearman(xs, ys).toFixed(3)}`)
  })
  // binário "gostou": mediana-split (AUC balanceado) e cut alto
  for (const label of ["median", "8.0"]) {
    const tau = label === "median" ? median(y) : 8.0
    const lab = y.map((v) => (v >= tau ? 1 : 0))
    const base = mean(lab)
    const fitRows: Row[] = recs.map((r, i) => ({ x: r.fit, y: lab[i] }))
    const oof = oofLogistic(fitRows)
    console.log(`  → "gostou" (user_score ≥ ${tau.toFixed(1)}): base rate=${(base * 100).toFixed(0)}%  |  AUC OOF (Fit)=${auc(oof, lab).toFixed(3)}  (0.5=inútil)`)
  }

  // ========== TESTE 2: consenso externo explica a nota? ==========
  console.log("\n" + "=".repeat(70) + "\nTESTE 2 — Mérito/consenso externo explica user_score?\n" + "=".repeat(70))
  const extNames = ["platform_avg", "log(votos)"]
  recs[0].ext.forEach((_, j) => {
    const pairs = recs.map((r) => [r.ext[j], r.y]).filter(([a]) => Number.isFinite(a))
    const xs = pairs.map((p) => p[0]), ys = pairs.map((p) => p[1])
    console.log(`  ${extNames[j].padEnd(18)} n=${xs.length}  pearson=${pearson(xs, ys).toFixed(3)}  spearman=${spearman(xs, ys).toFixed(3)}`)
  })
  const baselineMAE = maeOf(y.map(() => mean(y)), y)
  const extMAE = maeOf(oofRidge(recs.map((r) => ({ x: r.ext, y: r.y }))), y)
  console.log(`  → OOF MAE: baseline(média)=${baselineMAE.toFixed(3)}  |  ext(platform+votos)=${extMAE.toFixed(3)}`)

  // ========== TESTE 3: separabilidade + ganho incremental ==========
  console.log("\n" + "=".repeat(70) + "\nTESTE 3 — Fit e Mérito são separáveis? Um agrega sobre o outro?\n" + "=".repeat(70))
  const oofFit = oofRidge(recs.map((r) => ({ x: r.fit, y: r.y })))
  const oofExt = oofRidge(recs.map((r) => ({ x: r.ext, y: r.y })))
  const oofContent = oofRidge(recs.map((r) => ({ x: r.content, y: r.y })))
  const oofFitExt = oofRidge(recs.map((r) => ({ x: [...r.fit, ...r.ext], y: r.y })))
  const oofAll = oofRidge(recs.map((r) => ({ x: [...r.fit, ...r.ext, ...r.content], y: r.y })))
  console.log(`  correlação entre composites (OOF): corr(Fit, Ext)=${pearson(oofFit, oofExt).toFixed(3)}  corr(Fit, Content)=${pearson(oofFit, oofContent).toFixed(3)}  corr(Ext, Content)=${pearson(oofExt, oofContent).toFixed(3)}`)
  console.log(`    (|corr| alto ⇒ colineares ⇒ dividir é cosmético; baixo ⇒ eixos genuinamente distintos)`)
  console.log(`\n  OOF MAE por conjunto de features:`)
  console.log(`    Fit só ................ ${maeOf(oofFit, y).toFixed(3)}`)
  console.log(`    Ext só ................ ${maeOf(oofExt, y).toFixed(3)}`)
  console.log(`    Content(IA) só ........ ${maeOf(oofContent, y).toFixed(3)}`)
  console.log(`    Fit+Ext ............... ${maeOf(oofFitExt, y).toFixed(3)}`)
  console.log(`    Fit+Ext+Content ....... ${maeOf(oofAll, y).toFixed(3)}`)
  console.log(`    baseline (média) ...... ${baselineMAE.toFixed(3)}`)

  // ganho incremental do Fit sobre Content (Fit adiciona algo além do que a IA já sabe?)
  const oofContentFit = oofRidge(recs.map((r) => ({ x: [...r.content, ...r.fit], y: r.y })))
  console.log(`\n  ganho incremental do Fit SOBRE Content(IA): MAE ${maeOf(oofContent, y).toFixed(3)} → ${maeOf(oofContentFit, y).toFixed(3)}  (Δ ${(maeOf(oofContent, y) - maeOf(oofContentFit, y)).toFixed(3)})`)

  // ========== BÔNUS: ranking ==========
  console.log("\n" + "=".repeat(70) + "\nBÔNUS — poder de ranking (Spearman com user_score) e NDCG\n" + "=".repeat(70))
  const withExp = recs.map((r, i) => ({ i, e: r.expected })).filter((r) => r.e != null)
  if (withExp.length > 10) {
    const idxE = withExp.map((r) => r.i)
    const expSpear = spearman(idxE.map((i) => recs[i].expected as number), idxE.map((i) => y[i]))
    console.log(`  expected_score atual (in-sample, n=${idxE.length}): spearman=${expSpear.toFixed(3)}`)
  }
  console.log(`  Fit só (OOF): spearman=${spearman(oofFit, y).toFixed(3)}`)
  console.log(`  Fit+Ext+Content (OOF): spearman=${spearman(oofAll, y).toFixed(3)}`)
  const orderAll = [...oofAll.keys()].sort((a, b) => oofAll[b] - oofAll[a])
  const orderExp = withExp.length > 10 ? [...recs.keys()].filter((i) => recs[i].expected != null).sort((a, b) => (recs[b].expected as number) - (recs[a].expected as number)) : null
  for (const k of [10, 20]) {
    const parts = [`NDCG@${k}: modelo-OOF(tudo)=${ndcg(orderAll, y, k).toFixed(3)}`]
    if (orderExp) parts.push(`expected_score=${ndcg(orderExp, y, k).toFixed(3)}`)
    parts.push(`ideal=1.000`)
    console.log(`  ${parts.join("  |  ")}`)
  }

  // ========== TESTE 4: Avaliação (nota) × Alcance (votos) são separáveis? ==========
  console.log("\n" + "=".repeat(70) + "\nTESTE 4 — a 3ª força ganha o lugar? Avaliação vs Alcance\n" + "=".repeat(70))
  // rating = platform_avg (0-10) ; popularity = log1p(votos)
  const pairsRP = recs
    .map((r) => ({ rating: r.ext[0], pop: r.ext[1], y: r.y }))
    .filter((p) => Number.isFinite(p.rating) && Number.isFinite(p.pop))
  const rating = pairsRP.map((p) => p.rating)
  const pop = pairsRP.map((p) => p.pop)
  const yRP = pairsRP.map((p) => p.y)
  console.log(`  n=${pairsRP.length}`)
  console.log(`  corr(Avaliação, Alcance) = pearson ${pearson(rating, pop).toFixed(3)}  spearman ${spearman(rating, pop).toFixed(3)}`)
  console.log(`    (|corr| ALTO ⇒ nota e votos andam juntos ⇒ 3ª força é redundante; BAIXO ⇒ separáveis, face "joia escondida" existe)`)
  console.log(`  corr(Avaliação, user_score) = ${pearson(rating, yRP).toFixed(3)}   corr(Alcance, user_score) = ${pearson(pop, yRP).toFixed(3)}`)
  // ocupação dos 4 quadrantes (median split) — a "joia escondida" = nota ALTA + votos BAIXO
  const rMed = median(rating), pMed = median(pop)
  const quad = { "nota↑ pop↑ (consagrada)": 0, "nota↑ pop↓ (joia escondida)": 0, "nota↓ pop↑ (popular/divisiva)": 0, "nota↓ pop↓ (fundo)": 0 }
  pairsRP.forEach((p) => {
    const hi = p.rating >= rMed, hp = p.pop >= pMed
    if (hi && hp) quad["nota↑ pop↑ (consagrada)"]++
    else if (hi && !hp) quad["nota↑ pop↓ (joia escondida)"]++
    else if (!hi && hp) quad["nota↓ pop↑ (popular/divisiva)"]++
    else quad["nota↓ pop↓ (fundo)"]++
  })
  console.log(`  ocupação dos quadrantes nota×votos (split na mediana):`)
  for (const [k, v] of Object.entries(quad)) console.log(`    ${k.padEnd(30)} ${v} obras (${((v / pairsRP.length) * 100).toFixed(0)}%)`)

  // ========== TESTE 5: modelo da Chance + robustez a leakage ==========
  console.log("\n" + "=".repeat(70) + "\nTESTE 5 — modelo da Chance: tags declaradas + robustez a leakage\n" + "=".repeat(70))
  // tags declaradas (nível tag) + work_tags → overlap declarado por obra
  const prefs = await fetchAll<any>("user_tag_preferences", "tag_id, stance", (q) => q.not("tag_id", "is", null))
  const stanceByTag = new Map<string, string>()
  for (const p of prefs) stanceByTag.set(p.tag_id, p.stance)
  const nLove = prefs.filter((p) => p.stance === "love").length
  const nAvoid = prefs.filter((p) => p.stance === "avoid").length
  console.log(`  tags declaradas: ${nLove} amadas · ${nAvoid} evitadas (nível tag)`)

  const wtByWork = new Map<string, string[]>()
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    const wt = await fetchAll<any>("work_tags", "work_id, tag_id", (q) => q.in("work_id", chunk))
    for (const r of wt) {
      if (!wtByWork.has(r.work_id)) wtByWork.set(r.work_id, [])
      wtByWork.get(r.work_id)!.push(r.tag_id)
    }
  }
  // features declaradas por obra (alinhado com works[i] ↔ recs[i])
  const decl = works.map((w) => {
    const tags = wtByWork.get(w.id) ?? []
    let love = 0, avoid = 0
    for (const t of tags) { const s = stanceByTag.get(t); if (s === "love") love++; else if (s === "avoid") avoid++ }
    const n = Math.max(tags.length, 1)
    return { love, avoid, loveFrac: love / n, avoidFrac: avoid / n }
  })
  const declCov = decl.filter((d) => d.love > 0 || d.avoid > 0).length
  console.log(`  obras com ≥1 tag declarada: ${declCov}/${works.length}`)

  const lab = y.map((v) => (v >= 8 ? 1 : 0))
  const base = mean(lab)
  const catVecOf = (w: any) => critSlugs.map((s) => { const c = catByWork.get(w.id) ?? {}; return c[s] != null ? c[s] : NaN })

  // FULL = tudo (inclui personal_fit + Interesse, que dependem do perfil = leaky)
  const full = works.map((w, i) => ({
    x: [recs[i].fit[0], recs[i].fit[1], recs[i].fit[2], decl[i].loveFrac, decl[i].avoidFrac, ...catVecOf(w)],
    y: lab[i],
  }))
  // CLEAN = só sinais leakage-free (tags declaradas + 9 critérios IA; SEM personal_fit/Interesse/perfil)
  const clean = works.map((w, i) => ({
    x: [decl[i].loveFrac, decl[i].avoidFrac, ...catVecOf(w)],
    y: lab[i],
  }))
  // DECLARED-ONLY = só tags declaradas (o mais limpo possível)
  const declOnly = works.map((w, i) => ({ x: [decl[i].loveFrac, decl[i].avoidFrac], y: lab[i] }))

  console.log(`  AUC OOF "vou gostar" (≥8, base rate ${(base * 100).toFixed(0)}%):`)
  console.log(`    FULL (perfil + declaradas + critérios) ...... ${auc(oofLogistic(full), lab).toFixed(3)}`)
  console.log(`    CLEAN (declaradas + critérios, SEM perfil) .. ${auc(oofLogistic(clean), lab).toFixed(3)}  ← desconta leakage`)
  console.log(`    DECLARED-ONLY (só tags declaradas) ......... ${auc(oofLogistic(declOnly), lab).toFixed(3)}`)
  console.log(`    (se CLEAN ainda for ≳0.65, a Chance sobrevive mesmo descontando todo o leakage do perfil)`)

  console.log("\n✓ gate concluído.\n")
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : String(e)); process.exit(1) })

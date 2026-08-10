/**
 * taste-label-experiment.ts — READ-ONLY. Compara qual EXPRESSÃO da nota final do usuário
 * é mais útil como alvo do Ridge, e mede a coerência dos 6 eixos de gosto com o veredito.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/taste-label-experiment.ts
 *
 * Rigor: OOF aninhado (alpha por CV interna no treino), padronização ajustada SÓ no treino de
 * cada fold (sem leakage). Métricas scale-free (R², Spearman) pra comparar alvos de escalas
 * diferentes; MAE só como referência dentro do mesmo alvo. Não escreve nada.
 */
import { createClient } from "@supabase/supabase-js"
import { fitRidge, fitRidgeCV, predictRidge } from "@/lib/ml/ridge"
import { kFoldIndices } from "@/lib/ml/logistic"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const DONO = "e62ef992-5da9-4bb8-8909-b75ceeee33a9"
const POST = ["post_story_score","post_fl_score","post_ml_score","post_character_development_score","post_pacing_score","post_art_visual_score","post_impact_immersion_score","post_originality_score"]
const LIKE6 = ["like_leads_score","like_setting_score","like_tone_score","like_art_score","like_pacing_score","like_ending_score"]

async function all(table: string, cols: string, filt?: (q: any) => any): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).range(from, from + 999)
    if (filt) q = filt(q)
    const { data, error } = await q
    if (error) { console.error("ERR", table, error.message); break }
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

// ---- stats helpers ----
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))) || 1 }
function r2(y: number[], yhat: number[]): number {
  const m = mean(y)
  const ssTot = y.reduce((s, v) => s + (v - m) ** 2, 0)
  const ssRes = y.reduce((s, v, i) => s + (v - yhat[i]) ** 2, 0)
  return 1 - ssRes / ssTot
}
const mae = (y: number[], yhat: number[]) => mean(y.map((v, i) => Math.abs(v - yhat[i])))
function rank(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0])
  const r = new Array(a.length)
  for (let i = 0; i < idx.length;) { let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++; const avg = (i + j - 1) / 2 + 1; for (let k = i; k < j; k++) r[idx[k][1]] = avg; i = j }
  return r
}
function spearman(a: number[], b: number[]): number {
  const ra = rank(a), rb = rank(b), n = a.length
  const ma = mean(ra), mb = mean(rb)
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2 }
  return num / Math.sqrt(da * db)
}

/** OOF aninhado com padronização por-fold (sem leakage). Retorna as predições OOF. */
function oofRidge(X: number[][], y: number[], k = 5): number[] {
  const n = X.length, preds = new Array<number>(n).fill(NaN)
  const folds = kFoldIndices(n, k)
  for (const fold of folds) {
    const test = new Set(fold)
    const Xtr: number[][] = [], ytr: number[] = [], teIdx: number[] = []
    for (let i = 0; i < n; i++) { if (test.has(i)) teIdx.push(i); else { Xtr.push(X[i]); ytr.push(y[i]) } }
    if (!Xtr.length || !teIdx.length) continue
    const p = X[0].length
    const mu = Array.from({ length: p }, (_, j) => mean(Xtr.map(r => r[j])))
    const sd = Array.from({ length: p }, (_, j) => std(Xtr.map(r => r[j])))
    const z = (row: number[]) => row.map((v, j) => (v - mu[j]) / sd[j])
    const model = fitRidgeCV(Xtr.map(z), ytr)
    const preds_te = predictRidge(teIdx.map(i => z(X[i])), model)
    teIdx.forEach((i, t) => preds[i] = preds_te[t])
  }
  return preds
}

function evalTarget(name: string, X: number[][], y: number[]) {
  const yhat = oofRidge(X, y)
  const ok = yhat.map((v, i) => [v, y[i]] as const).filter(([v]) => Number.isFinite(v))
  const p = ok.map(([v]) => v), t = ok.map(([, v]) => v)
  const baselineMae = mae(t, t.map(() => mean(t)))
  console.log(
    `  ${name.padEnd(26)} n=${t.length}  R²=${r2(t, p).toFixed(3)}  Spearman=${spearman(t, p).toFixed(3)}` +
    `  MAE=${mae(t, p).toFixed(3)} (baseline ${baselineMae.toFixed(3)})  var(y)=${(std(t) ** 2).toFixed(2)}`
  )
}

// OLS/ridge simples para reconstruir um alvo a partir de features (in-sample, p/ pesos e R²).
function fitInSample(X: number[][], y: number[]) {
  const p = X[0].length
  const mu = Array.from({ length: p }, (_, j) => mean(X.map(r => r[j])))
  const sd = Array.from({ length: p }, (_, j) => std(X.map(r => r[j])))
  const z = (row: number[]) => row.map((v, j) => (v - mu[j]) / sd[j])
  const Xz = X.map(z)
  const model = fitRidge(Xz, y, 1.0)
  const yhat = predictRidge(Xz, model)
  return { coef: model.coefficients, intercept: model.intercept, yhat, r2: r2(y, yhat) }
}

async function main() {
  // ---- carga ----
  const uws = await all("user_work_state", "work_id,user_score,personal_status_id," + POST.join(","), q => q.eq("user_id", DONO))
  const pts = await all("pilot_taste_scores", "work_id,like_overall_score," + LIKE6.join(","))
  const cs = await all("category_scores", "work_id,criterion_slug,score")
  const calc = await all("calculated_scores", "work_id,platform_avg,total_votes")
  const works = await all("works", "id,total_chapters")

  const csBy = new Map<string, Record<string, number>>()
  for (const r of cs) { if (!csBy.has(r.work_id)) csBy.set(r.work_id, {}); if (r.score != null) csBy.get(r.work_id)![r.criterion_slug] = Number(r.score) }
  const SLUGS = [...new Set(cs.map(r => r.criterion_slug))].sort()
  const calcBy = new Map(calc.map(r => [r.work_id, r]))
  const chapBy = new Map(works.map(r => [r.id, r.total_chapters]))
  const ptsBy = new Map(pts.map(r => [r.work_id, r]))

  console.log(`Critérios IA (features objetivas): ${SLUGS.length} → ${SLUGS.join(", ")}\n`)

  // features OBJETIVAS (não derivam de nenhum dos alvos do usuário)
  function features(workId: string): number[] | null {
    const c = csBy.get(workId); if (!c) return null
    const iaVals = SLUGS.map(s => c[s]); if (iaVals.some(v => v == null)) return null
    const k = calcBy.get(workId)
    const plat = k?.platform_avg != null ? Number(k.platform_avg) : 0
    const votes = Math.log1p(k?.total_votes != null ? Number(k.total_votes) : 0)
    const chaps = Math.log1p(chapBy.get(workId) != null ? Number(chapBy.get(workId)) : 0)
    return [...iaVals as number[], plat, votes, chaps]
  }

  // ---- amostras ----
  // FINISHED (personal_status_id=1) = obra terminada → o eixo "Final" (like_ending_score) só
  // conta pra ela. Nas demais, ele é N/A (não é dado faltante). É a mesma regra que a UI aplica.
  const ENDING = "like_ending_score"
  type Row = { id: string; feat: number[]; user: number | null; overall: number | null; axes: number[] | null; availMean: number | null }
  const rows: Row[] = []
  for (const r of uws) {
    const feat = features(r.work_id); if (!feat) continue
    const pt = ptsBy.get(r.work_id)
    const axesRaw = pt ? LIKE6.map(k => pt[k]) : null
    const axes = axesRaw && axesRaw.every(v => v != null) ? axesRaw.map(Number) : null
    // média dos eixos DISPONÍVEIS: exclui o Final quando a obra não está terminada, e ignora nulls
    const finished = r.personal_status_id === 1
    const availVals = pt
      ? LIKE6.filter(k => k !== ENDING || finished).map(k => pt[k]).filter(v => v != null).map(Number)
      : []
    rows.push({
      id: r.work_id, feat,
      user: r.user_score != null ? Number(r.user_score) : null,
      overall: pt?.like_overall_score != null ? Number(pt.like_overall_score) : null,
      axes,
      availMean: availVals.length ? mean(availVals) : null,
    })
  }

  // ================= COMP A: user_score vs veredito (n grande) =================
  const A = rows.filter(r => r.user != null && r.overall != null)
  console.log(`\n=== COMP A — alvo mais previsível (features objetivas), n=${A.length} ===`)
  evalTarget("user_score (craft calc)", A.map(r => r.feat), A.map(r => r.user!))
  evalTarget("like_overall (veredito)", A.map(r => r.feat), A.map(r => r.overall!))

  // ================= COMP B: + composição dos 6 eixos (n=77) =================
  const B = rows.filter(r => r.user != null && r.overall != null && r.axes)
  console.log(`\n=== COMP B — mesmo teste no subconjunto com 6 eixos, n=${B.length} ===`)
  // composição "melhor combinação": pesos que reconstroem o veredito a partir dos 6 eixos
  const axesFit = fitInSample(B.map(r => r.axes!), B.map(r => r.overall!))
  const composite = axesFit.yhat // veredito reconstruído (denoised) pelos 6 eixos
  const simpleMean6 = B.map(r => mean(r.axes!))
  evalTarget("user_score (craft calc)", B.map(r => r.feat), B.map(r => r.user!))
  evalTarget("like_overall (veredito)", B.map(r => r.feat), B.map(r => r.overall!))
  evalTarget("composição 6 eixos (fit)", B.map(r => r.feat), composite)
  evalTarget("média simples 6 eixos", B.map(r => r.feat), simpleMean6)

  // ================= COMP C: alvo = média dos eixos DISPONÍVEIS (cobertura REAL) =================
  // Sob a regra "Final só p/ terminada", a nota de gosto existe pra ~toda obra avaliada — não só
  // as 77 com as 6 cruas. Head-to-head craft × preferência no n grande de verdade.
  const C = rows.filter(r => r.user != null && r.availMean != null)
  console.log(`\n=== COMP C — alvo = média dos eixos DISPONÍVEIS, n=${C.length} ===`)
  evalTarget("user_score (craft calc)", C.map(r => r.feat), C.map(r => r.user!))
  evalTarget("pref: média eixos disp.", C.map(r => r.feat), C.map(r => r.availMean!))
  // variante homogênea: média dos 5 eixos FIXOS (sem o Final), igual pra toda obra
  const FIX5 = LIKE6.filter(k => k !== ENDING)
  const fix5 = (id: string) => { const p = ptsBy.get(id); if (!p) return null; const v = FIX5.map(k => p[k]).filter(x => x != null).map(Number); return v.length ? mean(v) : null }
  const C5 = rows.filter(r => r.user != null && fix5(r.id) != null)
  console.log(`  — variante 5 eixos fixos (sem Final), n=${C5.length}:`)
  evalTarget("pref: média 5 fixos", C5.map(r => r.feat), C5.map(r => fix5(r.id)!))

  // ================= COMP D — UNIFICAÇÃO: melhor COMBINAÇÃO de critérios =================
  // A pergunta certa: não é craft vs pref isolados, é ATUAL (craft) vs a MELHOR COMBINAÇÃO dos dois.
  // Âncora de "quanto gostei" = o veredito (like_overall). Reconstruímos ele (OOF, sem leakage) a
  // partir de: só craft (8 post_*), só pref (5 eixos fixos), e OS DOIS JUNTOS (13). Se juntar bate
  // cada um sozinho → a nota unificada deve blendar craft + preferência.
  const uwsBy = new Map(uws.map(u => [u.work_id, u]))
  const craft8Of = (id: string): number[] | null => {
    const w = uwsBy.get(id); return w && POST.every(c => w[c] != null) ? POST.map(c => Number(w[c])) : null
  }
  const pref5Of = (id: string): number[] | null => {
    const p = ptsBy.get(id); const F = LIKE6.filter(k => k !== ENDING)
    return p && F.every(k => p[k] != null) ? F.map(k => Number(p[k])) : null
  }
  const D = rows.filter(r => r.overall != null && craft8Of(r.id) && pref5Of(r.id))
  const yD = D.map(r => r.overall!)
  const oofR2 = (X: number[][], y: number[]) => {
    const preds = oofRidge(X, y)
    const ok = preds.map((v, i) => [v, y[i]] as const).filter(([v]) => Number.isFinite(v))
    return r2(ok.map(o => o[1]), ok.map(o => o[0]))
  }
  console.log(`\n=== COMP D — melhor combinação p/ reconstruir o veredito "gostei geral" (OOF), n=${D.length} ===`)
  console.log(`  só craft (8 post_*)       R²=${oofR2(D.map(r => craft8Of(r.id)!), yD).toFixed(3)}`)
  console.log(`  só pref  (5 eixos fixos)  R²=${oofR2(D.map(r => pref5Of(r.id)!), yD).toFixed(3)}`)
  console.log(`  CRAFT + PREF (13 juntos)  R²=${oofR2(D.map(r => [...craft8Of(r.id)!, ...pref5Of(r.id)!]), yD).toFixed(3)}`)
  // E a previsibilidade a partir de features objetivas: atual (craft) vs a combinação fitada (13→veredito)
  const comboLabel = oofRidge(D.map(r => [...craft8Of(r.id)!, ...pref5Of(r.id)!]), yD)
  console.log(`  — como ALVO do modelo (previsão por features objetivas), mesmo n:`)
  evalTarget("atual: user_score (craft)", D.map(r => r.feat), D.map(r => r.user!))
  evalTarget("combinação craft+pref", D.filter((_, i) => Number.isFinite(comboLabel[i])).map(r => r.feat), comboLabel.filter(v => Number.isFinite(v)))

  // ================= COMP E — SUBCONJUNTO MÍNIMO (forward selection) =================
  // Quantos e quais critérios (craft+pref) bastam pra reconstruir o veredito ~= aos 13?
  // Greedy: a cada passo, adiciona o critério que MAIS sobe o R² OOF. Plateau = subconjunto mínimo.
  const FIX5N = LIKE6.filter(k => k !== ENDING)
  const ALL13 = [...POST, ...FIX5N]
  const LABEL13 = [
    "craft:história", "craft:FL", "craft:ML", "craft:desenv", "craft:ritmo", "craft:arte", "craft:impacto", "craft:orig",
    "pref:leads", "pref:setting", "pref:tom", "pref:arte", "pref:ritmo",
  ]
  const feat13 = (id: string): number[] | null => {
    const c = craft8Of(id), p = pref5Of(id); return c && p ? [...c, ...p] : null
  }
  const E = rows.filter(r => r.overall != null && feat13(r.id))
  const yE = E.map(r => r.overall!)
  const matE = E.map(r => feat13(r.id)!)
  console.log(`\n=== COMP E — subconjunto mínimo p/ reconstruir o veredito (forward, OOF), n=${E.length} ===`)
  const chosen: number[] = []
  const remaining = ALL13.map((_, i) => i)
  let prev = 0
  for (let step = 0; step < 8 && remaining.length; step++) {
    let bestJ = -1, bestR2 = -Infinity
    for (const j of remaining) {
      const cols = [...chosen, j]
      const X = matE.map(row => cols.map(c => row[c]))
      const r = oofR2(X, yE)
      if (r > bestR2) { bestR2 = r; bestJ = j }
    }
    chosen.push(bestJ)
    remaining.splice(remaining.indexOf(bestJ), 1)
    console.log(`  +${LABEL13[bestJ].padEnd(14)} → R²=${bestR2.toFixed(3)}  (ganho ${(bestR2 - prev >= 0 ? "+" : "")}${(bestR2 - prev).toFixed(3)})`)
    prev = bestR2
  }

  // ================= COMP F — REDUNDÂNCIA: craft ↔ preferência medem o mesmo aspecto? =================
  // Spearman de cada par. Alto (~0.85+) = redundante (execução ≈ gosto do mesmo eixo) → colapsar.
  // Moderado (~0.5-0.7) = cada um carrega sinal próprio → manter os dois faz sentido.
  const CRAFT_LBL: Record<string, string> = {
    post_story_score: "História", post_fl_score: "FemLead", post_ml_score: "MaleLead",
    post_character_development_score: "Desenv", post_pacing_score: "Ritmo",
    post_art_visual_score: "Arte", post_impact_immersion_score: "Impacto", post_originality_score: "Orig",
  }
  const PREF_ORDER = ["like_leads_score", "like_setting_score", "like_tone_score", "like_art_score", "like_pacing_score"]
  const PREF_LBL: Record<string, string> = {
    like_leads_score: "Casal/Prot", like_setting_score: "Ambient", like_tone_score: "Tom",
    like_art_score: "Arte", like_pacing_score: "Ritmo",
  }
  const pairSpearman = (craftField: string, prefField: string): { n: number; s: number } => {
    const xs: number[] = [], ys: number[] = []
    for (const u of uws) {
      const p = ptsBy.get(u.work_id)
      if (u[craftField] != null && p && p[prefField] != null) { xs.push(Number(u[craftField])); ys.push(Number(p[prefField])) }
    }
    return { n: xs.length, s: xs.length > 5 ? spearman(xs, ys) : NaN }
  }
  console.log(`\n=== COMP F — correlação craft × preferência (Spearman) — redundância ===`)
  console.log(`  ${"".padEnd(9)}${PREF_ORDER.map(p => PREF_LBL[p].padStart(11)).join("")}`)
  for (const c of POST) {
    const cells = PREF_ORDER.map(p => pairSpearman(c, p).s.toFixed(2).padStart(11)).join("")
    console.log(`  ${CRAFT_LBL[c].padEnd(9)}${cells}`)
  }
  // par de personagens: preferência "Casal/Prot" vs média craft (FemLead+MaleLead+Desenv)
  {
    const xs: number[] = [], ys: number[] = []
    for (const u of uws) {
      const p = ptsBy.get(u.work_id)
      const trio = [u.post_fl_score, u.post_ml_score, u.post_character_development_score]
      if (trio.every(v => v != null) && p && p.like_leads_score != null) {
        xs.push(mean(trio.map(Number))); ys.push(Number(p.like_leads_score))
      }
    }
    console.log(`\n  personagens: pref "Casal/Prot" × craft média(FL+ML+Desenv) → ρ=${spearman(xs, ys).toFixed(2)} (n=${xs.length})`)
  }

  // ================= Q5: coerência 6 eixos ↔ veredito =================
  console.log(`\n=== Q5 — os 6 eixos explicam o veredito? (n=${B.length}) ===`)
  console.log(`  R² (veredito ~ 6 eixos, in-sample) = ${axesFit.r2.toFixed(3)}`)
  console.log(`  pesos padronizados por eixo (quanto cada um puxa o veredito):`)
  LIKE6.forEach((k, j) => console.log(`    ${k.replace("like_", "").replace("_score", "").padEnd(9)} ${axesFit.coef[j] >= 0 ? "+" : ""}${axesFit.coef[j].toFixed(3)}`))
  // contradições: média dos 6 alta mas veredito baixo (ou vice-versa)
  const contradictions = B.map(r => ({ id: r.id, m6: mean(r.axes!), ov: r.overall!, gap: mean(r.axes!) - r.overall! }))
    .filter(x => Math.abs(x.gap) >= 2.5)
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
  console.log(`  |média6 − veredito| ≥ 2.5 pontos: ${contradictions.length}/${B.length} obras`)
  contradictions.slice(0, 6).forEach(c => console.log(`    gap ${c.gap > 0 ? "+" : ""}${c.gap.toFixed(1)}  média6=${c.m6.toFixed(1)} veredito=${c.ov}  (${c.id.slice(0, 8)})`))

  // ================= extra: correlações entre as expressões de nota =================
  console.log(`\n=== Correlações entre expressões da nota (Spearman) ===`)
  const meanPost = (r: any) => { const v = POST.map(k => r[k]).filter((x: any) => x != null).map(Number); return v.length ? mean(v) : null }
  const withBoth = uws.map(r => ({ user: r.user_score != null ? Number(r.user_score) : null, mpost: meanPost(r), ov: ptsBy.get(r.work_id)?.like_overall_score != null ? Number(ptsBy.get(r.work_id)!.like_overall_score) : null }))
  const pair = (f: (x: any) => number | null, g: (x: any) => number | null) => { const xs = withBoth.filter(r => f(r) != null && g(r) != null); return { n: xs.length, s: spearman(xs.map(f) as number[], xs.map(g) as number[]) } }
  const uo = pair(r => r.user, r => r.ov)
  const up = pair(r => r.user, r => r.mpost)
  console.log(`  user_score ↔ veredito : ρ=${uo.s.toFixed(3)} (n=${uo.n})`)
  console.log(`  user_score ↔ média post_*: ρ=${up.s.toFixed(3)} (n=${up.n})  [esperado ~1: user_score É a média]`)

  // níveis distintos (granularidade do rótulo)
  const lv = (arr: (number | null)[]) => new Set(arr.filter(v => v != null)).size
  console.log(`\n=== Granularidade do rótulo (níveis distintos) ===`)
  console.log(`  user_score: ${lv(uws.map(r => r.user_score))} níveis | like_overall: ${lv(pts.map(r => r.like_overall_score))} níveis (escala fixa de 5)`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })

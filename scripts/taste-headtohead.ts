/**
 * taste-headtohead.ts — READ-ONLY. Head-to-head LIMPO craft × gosto como RÓTULO do Ridge.
 * Mesmas obras, MESMOS folds, MESMAS features objetivas — o ÚNICO que muda entre as duas
 * rodadas é o alvo `y`. Craft vem do BACKUP pré-switch (o rótulo exato que o modelo usava);
 * gosto = média dos 7 eixos fixos (sem o Final) do pilot_taste_scores atual. Não escreve nada.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/taste-headtohead.ts
 */
import { createClient } from "@supabase/supabase-js"
import { fitRidgeCV, predictRidge } from "@/lib/ml/ridge"
import { kFoldIndices } from "@/lib/ml/logistic"
import { readFileSync } from "fs"
import { gunzipSync } from "zlib"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const DONO = "e62ef992-5da9-4bb8-8909-b75ceeee33a9"
const BACKUP = ".backups/2026-07-16T04-11-37-883Z"
const POST = ["post_story_score","post_fl_score","post_ml_score","post_character_development_score","post_pacing_score","post_art_visual_score","post_impact_immersion_score","post_originality_score"]
const LABEL7 = ["like_female_lead_score","like_male_lead_score","like_couple_score","like_setting_score","like_tone_score","like_art_score","like_pacing_score"] // 7 fixos, SEM o Final

const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map(v => (v - m) ** 2))) || 1 }
function r2(y: number[], yhat: number[]) { const m = mean(y); const ssTot = y.reduce((s, v) => s + (v - m) ** 2, 0); const ssRes = y.reduce((s, v, i) => s + (v - yhat[i]) ** 2, 0); return 1 - ssRes / ssTot }
const mae = (y: number[], yhat: number[]) => mean(y.map((v, i) => Math.abs(v - yhat[i])))
function rank(a: number[]) { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j < idx.length && idx[j][0] === idx[i][0]) j++; const avg = (i + j - 1) / 2 + 1; for (let k = i; k < j; k++) r[idx[k][1]] = avg; i = j } return r }
function spearman(a: number[], b: number[]) { const ra = rank(a), rb = rank(b), n = a.length; const ma = mean(ra), mb = mean(rb); let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2 } return num / Math.sqrt(da * db) }

/** OOF aninhado, padronização ajustada SÓ no treino de cada fold (sem leakage). Folds passados
 *  de fora → craft e gosto usam EXATAMENTE a mesma partição. */
function oofRidge(X: number[][], y: number[], folds: number[][]): number[] {
  const n = X.length, preds = new Array<number>(n).fill(NaN)
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
    const pte = predictRidge(teIdx.map(i => z(X[i])), model)
    teIdx.forEach((i, t) => preds[i] = pte[t])
  }
  return preds
}

function report(name: string, y: number[], yhat: number[]) {
  const baseline = mae(y, y.map(() => mean(y)))
  const s = std(y)
  const m = mae(y, yhat)
  console.log(
    `  ${name.padEnd(16)} n=${y.length}  R²=${r2(y, yhat).toFixed(3)}  ρ=${spearman(y, yhat).toFixed(3)}  ` +
    `MAE=${m.toFixed(3)}  MAE/baseline=${(m / baseline).toFixed(3)}  MAE/σ=${(m / s).toFixed(3)}  ` +
    `skill=${(1 - m / baseline).toFixed(3)}  (σ=${s.toFixed(2)}, baseline=${baseline.toFixed(3)})`
  )
}

function readGz(name: string): any[] {
  const raw = gunzipSync(readFileSync(`${BACKUP}/${name}.ndjson.gz`)).toString("utf8")
  return raw.split("\n").filter(Boolean).map(l => JSON.parse(l))
}
async function all(table: string, cols: string, filt?: (q: any) => any): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) { let q = sb.from(table).select(cols).range(from, from + 999); if (filt) q = filt(q); const { data, error } = await q; if (error) { console.error("ERR", table, error.message); break } if (!data?.length) break; rows.push(...data); if (data.length < 1000) break }
  return rows
}

async function main() {
  // Craft = user_score do BACKUP pré-switch, SÓ onde havia craft de verdade (≥1 post_* preenchido).
  const backupUws = readGz("user_work_state").filter((r: any) => r.user_id === DONO)
  const craftBy = new Map<string, number>()
  for (const r of backupUws) {
    const hasCraft = POST.some(c => r[c] != null)
    if (hasCraft && r.user_score != null) craftBy.set(r.work_id, Number(r.user_score))
  }

  // Gosto = média dos 7 fixos (tudo-ou-nada) do pilot_taste_scores ATUAL.
  const pts = await all("pilot_taste_scores", "*")
  const tasteBy = new Map<string, number>()
  for (const p of pts) {
    if (LABEL7.some(k => p[k] == null)) continue
    tasteBy.set(p.work_id, Math.round(mean(LABEL7.map(k => Number(p[k]))) * 10) / 10)
  }

  // Features OBJETIVAS (não derivam de nenhum dos rótulos): 9 IA + platform_avg + log(votos) + log(caps).
  const cs = await all("category_scores", "work_id,criterion_slug,score")
  const calc = await all("calculated_scores", "work_id,platform_avg,total_votes")
  const works = await all("works", "id,total_chapters")
  const csBy = new Map<string, Record<string, number>>()
  for (const r of cs) { if (!csBy.has(r.work_id)) csBy.set(r.work_id, {}); if (r.score != null) csBy.get(r.work_id)![r.criterion_slug] = Number(r.score) }
  const SLUGS = [...new Set(cs.map(r => r.criterion_slug))].sort()
  const calcBy = new Map(calc.map(r => [r.work_id, r]))
  const chapBy = new Map(works.map(r => [r.id, r.total_chapters]))
  const featOf = (id: string): number[] | null => {
    const c = csBy.get(id); if (!c) return null
    const ia = SLUGS.map(s => c[s]); if (ia.some(v => v == null)) return null
    const k: any = calcBy.get(id)
    return [...ia as number[], k?.platform_avg != null ? Number(k.platform_avg) : 0, Math.log1p(k?.total_votes != null ? Number(k.total_votes) : 0), Math.log1p(chapBy.get(id) != null ? Number(chapBy.get(id)) : 0)]
  }

  // S = obras com craft E gosto E features. Mesma ordem → mesmos folds pros dois.
  const S: { id: string; feat: number[]; craft: number; taste: number }[] = []
  for (const [id, craft] of craftBy) {
    const taste = tasteBy.get(id); if (taste == null) continue
    const feat = featOf(id); if (!feat) continue
    S.push({ id, feat, craft, taste })
  }
  const X = S.map(r => r.feat)
  const folds = kFoldIndices(S.length, 5) // UMA partição, reusada nos dois

  console.log(`\nHead-to-head LIMPO — mesmas ${S.length} obras, mesmos folds, mesmas ${X[0].length} features. Só o rótulo muda.\n`)
  report("CRAFT (backup)", S.map(r => r.craft), oofRidge(X, S.map(r => r.craft), folds))
  report("GOSTO (7 eixos)", S.map(r => r.taste), oofRidge(X, S.map(r => r.taste), folds))
  console.log(`\nCorrelação craft ↔ gosto (mesmas obras): ρ=${spearman(S.map(r => r.craft), S.map(r => r.taste)).toFixed(3)}`)
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })

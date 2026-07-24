/**
 * DIAGNÓSTICO 3: a "confiança" declarada pela IA prevê acurácia?
 * Ground truth = quanto o humano teve que corrigir a nota sugerida.
 * Só leitura.
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { pageAll } from "./lib/page-all"

const pearson = (xs: number[], ys: number[]) => {
  const n = xs.length
  const mx = xs.reduce((p, c) => p + c, 0) / n
  const my = ys.reduce((p, c) => p + c, 0) / n
  let num = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2
  }
  return num / Math.sqrt(dx * dy)
}
const rank = (a: number[]) => {
  const idx = a.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0])
  const r = new Array(a.length).fill(0)
  for (let i = 0; i < idx.length; i++) r[idx[i][1]] = i
  return r
}
const spearman = (xs: number[], ys: number[]) => pearson(rank(xs), rank(ys))

async function main() {
  const sb = createAdminClient()

  const { data: s1 } = await sb.from("ai_evaluation_scores").select("*").limit(1)
  console.log("COLUNAS ai_evaluation_scores:", Object.keys(s1?.[0] ?? {}).join(", "))
  const { data: s2 } = await sb.from("category_scores").select("*").limit(1)
  console.log("COLUNAS category_scores:", Object.keys(s2?.[0] ?? {}).join(", "))
  console.log()

  // avaliação mais recente por obra
  const evalsRaw = await pageAll<Record<string, unknown>>((f, t) =>
    sb.from("ai_evaluations").select("id, work_id, confidence, model_name, prompt_version, created_at")
      .eq("status", "completed").neq("model_name", "mock-v1")
      .order("created_at", { ascending: true }).range(f, t)
  )
  const latest = new Map<string, { id: string; conf: number; cfg: string }>()
  for (const e of evalsRaw) {
    if (e.confidence == null) continue
    latest.set(e.work_id as string, {
      id: e.id as string,
      conf: Number(e.confidence),
      cfg: `${e.model_name}/${e.prompt_version}`,
    })
  }
  const evalIdToWork = new Map<string, string>()
  for (const [w, e] of latest) evalIdToWork.set(e.id, w)
  console.log("obras com avaliação:", latest.size)

  const sugg = await pageAll<Record<string, unknown>>((f, t) =>
    sb.from("ai_evaluation_scores").select("ai_evaluation_id, criterion_slug, suggested_score").range(f, t)
  )
  console.log("linhas ai_evaluation_scores:", sugg.length)

  const final = await pageAll<Record<string, unknown>>((f, t) =>
    sb.from("category_scores").select("work_id, criterion_slug, score, source").range(f, t)
  )
  console.log("linhas category_scores:", final.length)
  console.log()

  const finalMap = new Map<string, { score: number; source: string }>()
  for (const r of final) {
    finalMap.set(`${r.work_id}|${r.criterion_slug}`, {
      score: Number(r.score),
      source: String(r.source),
    })
  }

  // por obra: erro médio absoluto entre sugerido e o que ficou gravado
  type Row = { conf: number; mae: number; nEdited: number; n: number; cfg: string }
  const perWork = new Map<string, { diffs: number[]; edited: number; conf: number; cfg: string }>()
  for (const s of sugg) {
    const w = evalIdToWork.get(s.ai_evaluation_id as string)
    if (!w) continue // não é a avaliação mais recente da obra
    const fin = finalMap.get(`${w}|${s.criterion_slug}`)
    if (!fin) continue
    if (fin.source !== "ai_accepted" && fin.source !== "ai_edited") continue // só o que veio da IA
    const meta = latest.get(w)!
    if (!perWork.has(w)) perWork.set(w, { diffs: [], edited: 0, conf: meta.conf, cfg: meta.cfg })
    const p = perWork.get(w)!
    p.diffs.push(Math.abs(Number(s.suggested_score) - fin.score))
    if (fin.source === "ai_edited") p.edited++
  }

  const rows: Row[] = []
  for (const [, p] of perWork) {
    if (p.diffs.length < 5) continue
    rows.push({
      conf: p.conf,
      mae: p.diffs.reduce((a, b) => a + b, 0) / p.diffs.length,
      nEdited: p.edited,
      n: p.diffs.length,
      cfg: p.cfg,
    })
  }
  console.log("obras revisadas pelo humano com ≥5 critérios da IA:", rows.length)
  if (rows.length < 20) { console.log("amostra pequena demais."); return }

  const conf = rows.map((r) => r.conf)
  const mae = rows.map((r) => r.mae)
  const edFrac = rows.map((r) => r.nEdited / r.n)

  console.log()
  console.log("=== a confiança prevê a correção humana? ===")
  console.log(`  confiança × erro médio (|sugerido−gravado|)   rho=${spearman(conf, mae).toFixed(3)}  r=${pearson(conf, mae).toFixed(3)}`)
  console.log(`  confiança × % de critérios editados           rho=${spearman(conf, edFrac).toFixed(3)}  r=${pearson(conf, edFrac).toFixed(3)}`)
  console.log("  (esperado se a confiança valesse algo: NEGATIVO — mais confiança, menos correção)")

  console.log()
  console.log("=== erro humano médio por faixa de confiança declarada ===")
  const cbins: [string, (r: Row) => boolean][] = [
    ["≤0.62", (r) => r.conf <= 0.62],
    ["0.63-0.74", (r) => r.conf > 0.62 && r.conf <= 0.74],
    ["0.75-0.80", (r) => r.conf > 0.74 && r.conf <= 0.80],
    ["0.81-0.85", (r) => r.conf > 0.80 && r.conf <= 0.85],
    ["0.86+", (r) => r.conf > 0.85],
  ]
  for (const [label, pred] of cbins) {
    const g = rows.filter(pred)
    if (!g.length) { console.log(`  ${label.padEnd(11)} n=0`); continue }
    const m = g.reduce((p, c) => p + c.mae, 0) / g.length
    const e = g.reduce((p, c) => p + c.nEdited / c.n, 0) / g.length
    console.log(`  ${label.padEnd(11)} n=${String(g.length).padStart(4)}  erro=${m.toFixed(3)}  editados=${(e * 100).toFixed(1)}%`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

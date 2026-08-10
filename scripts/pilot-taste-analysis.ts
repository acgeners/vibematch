/* Fase 4 — análise do piloto de gosto. Read-only. Divergência (gosto×craft),
 * pontes Tier A (gosto×IA), aspectos→overall. Bootstrap CI, pré-registrado.
 * Uso: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis scripts/pilot-taste-analysis.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "@supabase/supabase-js"
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

// ---- stats ----
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
function pearson(x: number[], y: number[]): number {
  const n = x.length; if (n < 3) return NaN
  const mx = mean(x), my = mean(y)
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : NaN
}
function ranks(a: number[]): number[] {
  const idx = a.map((v, i) => [v, i] as [number, number]).sort((p, q) => p[0] - q[0])
  const r = new Array(a.length).fill(0)
  let i = 0
  while (i < idx.length) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg
    i = j + 1
  }
  return r
}
const spearman = (x: number[], y: number[]) => pearson(ranks(x), ranks(y))
function lcg(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000 } }
function bootCI(x: number[], y: number[], fn: (a: number[], b: number[]) => number, iters = 3000): [number, number] {
  const rnd = lcg(12345), n = x.length, out: number[] = []
  for (let it = 0; it < iters; it++) {
    const bx: number[] = [], by: number[] = []
    for (let i = 0; i < n; i++) { const k = Math.floor(rnd() * n); bx.push(x[k]); by.push(y[k]) }
    const v = fn(bx, by); if (Number.isFinite(v)) out.push(v)
  }
  out.sort((a, b) => a - b)
  return [out[Math.floor(out.length * 0.025)], out[Math.floor(out.length * 0.975)]]
}
const f = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : "—")
function line(label: string, x: number[], y: number[]) {
  if (x.length < 5) { console.log(`  ${label.padEnd(30)} n=${x.length} (poucos)`); return }
  const p = pearson(x, y), s = spearman(x, y), ci = bootCI(x, y, pearson)
  console.log(`  ${label.padEnd(30)} n=${String(x.length).padStart(3)}  pearson ${f(p)}  [${f(ci[0])}, ${f(ci[1])}]  spearman ${f(s)}`)
}

async function fetchAll(table: string, cols: string, filt?: (q: any) => any) {
  const out: any[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).range(from, from + 999); if (filt) q = filt(q)
    const { data, error } = await q; if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? [])); if ((data ?? []).length < 1000) break
  }
  return out
}

const ASPECTS = ["like_leads_score", "like_setting_score", "like_tone_score", "like_art_score", "like_pacing_score", "like_ending_score"]
const PROXY: Record<string, string[]> = {
  like_leads_score: ["protagonist", "couple_dynamics", "romance"],
  like_setting_score: ["fantasy_nobility", "action_adventure"],
  like_tone_score: ["humor", "drama", "tragedy", "adult_content"],
}

async function main() {
  const pilot = await fetchAll("pilot_taste_scores", "*")
  const rated = pilot.filter((r) => r.like_overall_score != null)
  const ids = rated.map((r) => r.work_id)
  console.log(`\nPILOTO: ${pilot.length} linhas · ${rated.length} com "Gostei geral"\n`)
  if (rated.length < 5) { console.log("dados insuficientes."); return }

  const works = await fetchAll("works", "id, title, user_score", (q) => q.in("id", ids))
  const craftBy = new Map(works.map((w) => [w.id, Number(w.user_score)]))
  const titleBy = new Map(works.map((w) => [w.id, w.title]))
  const cat = await fetchAll("category_scores", "work_id, criterion_slug, score", (q) => q.in("work_id", ids))
  const catBy = new Map<string, Record<string, number>>()
  for (const c of cat) { if (!catBy.has(c.work_id)) catBy.set(c.work_id, {}); if (c.score != null) catBy.get(c.work_id)![c.criterion_slug] = Number(c.score) }

  // ---- spread ----
  const overall = rated.map((r) => Number(r.like_overall_score))
  const craft = rated.map((r) => craftBy.get(r.work_id)!).map(Number)
  const sd = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2)))
  console.log(`spread: Gostei geral média ${mean(overall).toFixed(2)} dp ${sd(overall).toFixed(2)} · craft(user_score) média ${mean(craft).toFixed(2)} dp ${sd(craft).toFixed(2)}`)

  // ---- 1) DIVERGÊNCIA (go/no-go) ----
  console.log("\n=== 1) DIVERGÊNCIA: Gostei geral × craft (user_score) — o go/no-go ===")
  const okBoth = rated.map((r, i) => ({ o: overall[i], c: craft[i], id: r.work_id })).filter((z) => Number.isFinite(z.c))
  const ov = okBoth.map((z) => z.o), cv = okBoth.map((z) => z.c)
  line("Gostei geral × craft", ov, cv)
  const gaps = okBoth.map((z) => ({ ...z, gap: z.o - z.c }))
  console.log(`  |gap| médio ${mean(gaps.map((g) => Math.abs(g.gap))).toFixed(2)} · dp do gap ${sd(gaps.map((g) => g.gap)).toFixed(2)}`)

  // ---- 2) PROVA DE EXISTÊNCIA: mesmo craft, gosto diferente ----
  console.log("\n=== 2) Maiores divergências (craft alto/gosto baixo e vice-versa) ===")
  const sorted = [...gaps].sort((a, b) => a.gap - b.gap)
  const show = (z: any) => `  craft ${z.c.toFixed(1)}  gosto ${z.o.toFixed(1)}  Δ${z.gap > 0 ? "+" : ""}${z.gap.toFixed(1)}  ${String(titleBy.get(z.id)).slice(0, 44)}`
  console.log(" gostou MENOS que a qualidade (craft>gosto):"); sorted.slice(0, 5).forEach((z) => console.log(show(z)))
  console.log(" gostou MAIS que a qualidade (gosto>craft):"); sorted.slice(-5).reverse().forEach((z) => console.log(show(z)))

  // ---- 3) ASPECTOS → GOSTEI GERAL (quais aspectos puxam teu geral) ----
  console.log("\n=== 3) Aspectos → Gostei geral (qual aspecto move tua nota) ===")
  for (const a of ASPECTS) {
    const pairs = rated.map((r) => ({ a: r[a], o: Number(r.like_overall_score) })).filter((z) => z.a != null)
    line(a.replace("like_", "").replace("_score", ""), pairs.map((z) => Number(z.a)), pairs.map((z) => z.o))
  }

  // ---- 4) PONTE Tier A: gosto-aspecto × proxy IA (magnitude) ----
  console.log("\n=== 4) Ponte Tier A: gosto-aspecto × proxy IA (magnitude) ===")
  for (const [aspect, slugs] of Object.entries(PROXY)) {
    const pairs = rated.map((r) => {
      const c = catBy.get(r.work_id) ?? {}
      const vals = slugs.map((s) => c[s]).filter((v) => v != null) as number[]
      return { g: r[aspect], p: vals.length ? mean(vals) : null }
    }).filter((z) => z.g != null && z.p != null)
    line(`${aspect.replace("like_", "").replace("_score", "")} × IA(${slugs.join("+")})`, pairs.map((z) => Number(z.g)), pairs.map((z) => Number(z.p)))
  }
  console.log("")
}
main().catch((e) => { console.error(e); process.exit(1) })

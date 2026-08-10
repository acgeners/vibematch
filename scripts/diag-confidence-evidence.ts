/**
 * DIAGNÓSTICO: a confiança auto-reportada pela IA cai quando adicionamos evidência?
 * Só leitura. Nenhuma escrita.
 *
 * Resultado (2026-07-24): NÃO — segurando modelo+prompt constantes, mais dado SOBE
 * a confiança (n=91, Δ+0,049, 58↑/11↓). O que despenca o número é a troca de
 * modelo. Ver `REGISTRO-2026-07-24-CONFIANCA-IA.md`.
 *
 * Rode com: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local --env-file=.env.analysis \
 *             scripts/diag-confidence-evidence.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { pageAll } from "./lib/page-all"

/** `raw_response` é uma coluna gorda: 1000 linhas por página estouram o statement
 *  timeout do Postgres. O `break` do `pageAll` deriva deste mesmo valor, então
 *  mudá-lo não pode mais truncar a leitura em silêncio. */
const RAW_RESPONSE_PAGE = 200

async function main() {
  const sb = createAdminClient()

  // 0) que colunas existem?
  const { data: sample, error: sErr } = await sb.from("ai_evaluations").select("*").limit(1)
  if (sErr) throw new Error(sErr.message)
  console.log("COLUNAS ai_evaluations:", Object.keys(sample?.[0] ?? {}).join(", "))
  console.log()

  const { count: total } = await sb
    .from("ai_evaluations")
    .select("*", { count: "exact", head: true })
    .eq("status", "completed")
  console.log("avaliações completed:", total)

  const evals = await pageAll<Record<string, unknown>>(
    (f, t) =>
      sb
        .from("ai_evaluations")
        .select("id, work_id, confidence, model_name, prompt_version, created_at, raw_response")
        .eq("status", "completed")
        .order("created_at", { ascending: true })
        .range(f, t),
    { pageSize: RAW_RESPONSE_PAGE }
  )
  if (total != null && evals.length !== total) {
    throw new Error(
      `leitura truncada: ${evals.length} linhas paginadas vs ${total} em count.exact — ` +
        `não confie no resultado`
    )
  }
  console.log("carregadas:", evals.length)
  console.log()

  // ---- 1) Distribuição de confidence, global e por prompt_version ----
  const byVersion = new Map<string, number[]>()
  for (const e of evals) {
    const c = e.confidence == null ? null : Number(e.confidence)
    if (c == null || Number.isNaN(c)) continue
    const k = `${e.model_name} / ${e.prompt_version}`
    if (!byVersion.has(k)) byVersion.set(k, [])
    byVersion.get(k)!.push(c)
  }
  const stat = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y)
    const mean = s.reduce((p, c) => p + c, 0) / s.length
    return {
      n: s.length,
      mean: mean.toFixed(3),
      p10: s[Math.floor(s.length * 0.1)].toFixed(2),
      med: s[Math.floor(s.length * 0.5)].toFixed(2),
      p90: s[Math.floor(s.length * 0.9)].toFixed(2),
      min: s[0].toFixed(2),
      max: s[s.length - 1].toFixed(2),
    }
  }
  console.log("=== confidence por modelo/prompt ===")
  for (const [k, v] of [...byVersion.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(k.padEnd(38), JSON.stringify(stat(v)))
  }
  console.log()

  // valores distintos (a IA usa uma grade?)
  const hist = new Map<number, number>()
  for (const e of evals) {
    const c = e.confidence == null ? null : Number(e.confidence)
    if (c == null || Number.isNaN(c)) continue
    hist.set(c, (hist.get(c) ?? 0) + 1)
  }
  console.log("=== valores distintos de confidence (top 15) ===")
  for (const [v, n] of [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`  ${v.toFixed(2)}  → ${n}`)
  }
  console.log("distintos no total:", hist.size)
  console.log()

  // teto de baixa evidência realmente disparou?
  const capped = evals.filter((e) => {
    const r = e.raw_response as Record<string, unknown> | null
    return r && r.confidenceCapWhenLowEvidenceApplied === true
  })
  console.log("com teto de baixa-evidência aplicado:", capped.length)
  console.log()

  // ---- 2) PAREADO: obras reavaliadas — a confiança sobe ou desce? ----
  const byWork = new Map<string, Record<string, unknown>[]>()
  for (const e of evals) {
    const w = e.work_id as string
    if (!byWork.has(w)) byWork.set(w, [])
    byWork.get(w)!.push(e)
  }
  const multi = [...byWork.entries()].filter(([, v]) => v.length > 1)
  console.log("obras com >1 avaliação:", multi.length)

  let up = 0, down = 0, same = 0
  const deltas: number[] = []
  // só compara pares do MESMO modelo+prompt (senão mede troca de prompt, não de dado)
  let sameCfgPairs = 0
  for (const [, list] of multi) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i]
      if (a.model_name !== b.model_name || a.prompt_version !== b.prompt_version) continue
      const ca = Number(a.confidence), cb = Number(b.confidence)
      if (Number.isNaN(ca) || Number.isNaN(cb)) continue
      sameCfgPairs++
      const d = cb - ca
      deltas.push(d)
      if (d > 0.001) up++
      else if (d < -0.001) down++
      else same++
    }
  }
  console.log("pares consecutivos mesmo modelo+prompt:", sameCfgPairs)
  console.log(`  subiu: ${up}   desceu: ${down}   igual: ${same}`)
  if (deltas.length) {
    const m = deltas.reduce((p, c) => p + c, 0) / deltas.length
    console.log("  delta médio:", m.toFixed(4))
  }
  console.log()

  // ---- 3) CORTE TRANSVERSAL: confidence vs evidência ATUAL da obra ----
  // (aproximação: usa o estado de hoje; serve pra ver o sinal, não pra causalidade)
  const workIds = [...new Set(evals.map((e) => e.work_id as string))]
  console.log("obras distintas avaliadas:", workIds.length)

  const works = await pageAll<Record<string, unknown>>((f, t) =>
    sb.from("works").select("id, title, canonical_synopsis").range(f, t)
  )
  const synLen = new Map<string, number>()
  const titleOf = new Map<string, string>()
  for (const w of works) {
    synLen.set(w.id as string, ((w.canonical_synopsis as string) ?? "").trim().length)
    titleOf.set(w.id as string, (w.title as string) ?? "")
  }

  const reviews = await pageAll<Record<string, unknown>>((f, t) =>
    sb.from("work_reviews").select("work_id, source, text").range(f, t)
  )
  const revCount = new Map<string, number>()
  const revSources = new Map<string, Set<string>>()
  const revSubstantive = new Map<string, number>()
  for (const r of reviews) {
    const w = r.work_id as string
    revCount.set(w, (revCount.get(w) ?? 0) + 1)
    if (!revSources.has(w)) revSources.set(w, new Set())
    revSources.get(w)!.add(String(r.source))
    if (((r.text as string) ?? "").trim().length >= 80)
      revSubstantive.set(w, (revSubstantive.get(w) ?? 0) + 1)
  }
  console.log("reviews carregadas:", reviews.length)

  const wtags = await pageAll<Record<string, unknown>>((f, t) =>
    sb.from("work_tags").select("work_id").range(f, t)
  )
  const tagCount = new Map<string, number>()
  for (const wt of wtags) {
    const w = wt.work_id as string
    tagCount.set(w, (tagCount.get(w) ?? 0) + 1)
  }
  console.log("work_tags carregadas:", wtags.length)
  console.log()

  // última avaliação por obra
  const latest = new Map<string, Record<string, unknown>>()
  for (const e of evals) latest.set(e.work_id as string, e) // ordenado asc → fica a última

  type Row = { conf: number; syn: number; rev: number; sub: number; src: number; tags: number; title: string }
  const rows: Row[] = []
  for (const [w, e] of latest.entries()) {
    const c = Number(e.confidence)
    if (Number.isNaN(c)) continue
    rows.push({
      conf: c,
      syn: synLen.get(w) ?? 0,
      rev: revCount.get(w) ?? 0,
      sub: revSubstantive.get(w) ?? 0,
      src: revSources.get(w)?.size ?? 0,
      tags: tagCount.get(w) ?? 0,
      title: titleOf.get(w) ?? w,
    })
  }
  console.log("linhas na análise transversal:", rows.length)

  const pearson = (xs: number[], ys: number[]) => {
    const n = xs.length
    const mx = xs.reduce((p, c) => p + c, 0) / n
    const my = ys.reduce((p, c) => p + c, 0) / n
    let num = 0, dx = 0, dy = 0
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my)
      dx += (xs[i] - mx) ** 2
      dy += (ys[i] - my) ** 2
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

  const conf = rows.map((r) => r.conf)
  console.log()
  console.log("=== correlação com confidence (Spearman / Pearson) ===")
  for (const [name, get] of [
    ["nº reviews", (r: Row) => r.rev],
    ["reviews substantivas", (r: Row) => r.sub],
    ["nº fontes de review", (r: Row) => r.src],
    ["tam. sinopse (chars)", (r: Row) => r.syn],
    ["nº tags", (r: Row) => r.tags],
  ] as const) {
    const xs = rows.map(get)
    console.log(
      `  ${name.padEnd(24)} rho=${spearman(xs, conf).toFixed(3)}  r=${pearson(xs, conf).toFixed(3)}`
    )
  }

  // bins por nº de reviews
  console.log()
  console.log("=== confidence média por faixa de reviews ===")
  const bins: [string, (r: Row) => boolean][] = [
    ["0 reviews", (r) => r.rev === 0],
    ["1-5", (r) => r.rev >= 1 && r.rev <= 5],
    ["6-15", (r) => r.rev >= 6 && r.rev <= 15],
    ["16-30", (r) => r.rev >= 16 && r.rev <= 30],
    ["31-60", (r) => r.rev >= 31 && r.rev <= 60],
    ["61+", (r) => r.rev >= 61],
  ]
  for (const [label, pred] of bins) {
    const g = rows.filter(pred)
    if (!g.length) { console.log(`  ${label.padEnd(12)} n=0`); continue }
    const m = g.reduce((p, c) => p + c.conf, 0) / g.length
    console.log(`  ${label.padEnd(12)} n=${String(g.length).padStart(4)}  conf média=${m.toFixed(3)}`)
  }

  console.log()
  console.log("=== confidence média por faixa de sinopse ===")
  const sbins: [string, (r: Row) => boolean][] = [
    ["<50", (r) => r.syn < 50],
    ["50-300", (r) => r.syn >= 50 && r.syn < 300],
    ["300-800", (r) => r.syn >= 300 && r.syn < 800],
    ["800-1500", (r) => r.syn >= 800 && r.syn < 1500],
    ["1500+", (r) => r.syn >= 1500],
  ]
  for (const [label, pred] of sbins) {
    const g = rows.filter(pred)
    if (!g.length) { console.log(`  ${label.padEnd(12)} n=0`); continue }
    const m = g.reduce((p, c) => p + c.conf, 0) / g.length
    console.log(`  ${label.padEnd(12)} n=${String(g.length).padStart(4)}  conf média=${m.toFixed(3)}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

/**
 * READ-ONLY. Mede duas patologias da barra de fit (components/titles/criterion-fit-bar.tsx):
 *
 *  (A) SEM FAIXA — a justificativa da IA não casa `^Faixa X-Y(/W-Z)? (Rótulo)?:` →
 *      parseJustification devolve band=null → some o chip E o segmento verde da barra.
 *  (B) PONTO FORA DA FAIXA — a nota vigente (category_scores) cai fora da faixa que a
 *      própria IA citou na justificativa (ex.: nota 8,5 com "Faixa 7-8").
 *
 * O recorte que importa é o VISÍVEL: só a avaliação mais recente não-failed de cada obra
 * é renderizada na página da obra (app/catalog/[id]/page.tsx:398-403).
 *
 * Uso: node audit-bands.mjs   (não escreve nada)
 *
 * ALVO: LOCAL — só LÊ, então o `.env.analysis` (que vem DEPOIS e vence) o manda pro clone
 * local e o egress fica em zero. Sem ele, roda contra a NUVEM em silêncio.
 *   node --env-file=.env.local --env-file=.env.analysis scripts/audit-justification-bands.mjs
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Cópia fiel de lib/criteria/justification.ts:18
const BAND_RE = /^\s*Faixa\s+(\d+(?:-\d+)?(?:\/\d+-\d+)?)\s*(?:\(([^)]*)\))?\s*:\s*([\s\S]*)$/i
const bandBounds = (band) => {
  const nums = band.split(/[-/]/).map(Number).filter(Number.isFinite)
  return nums.length === 0 ? [0, 10] : [Math.min(...nums), Math.max(...nums)]
}

async function pageAll(table, cols) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(cols).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  const { count } = await sb.from(table).select('*', { count: 'exact', head: true })
  if (count != null && count !== out.length) throw new Error(`${table}: paginou ${out.length} de ${count}`)
  return out
}

const pct = (a, b) => (b === 0 ? '—' : `${((a / b) * 100).toFixed(1)}%`)

const evals = await pageAll('ai_evaluations', 'id, work_id, status, prompt_version, model_name, created_at')
const scores = await pageAll('ai_evaluation_scores', 'ai_evaluation_id, criterion_slug, justification')
const cats = await pageAll('category_scores', 'work_id, criterion_slug, score')
const works = await pageAll('works', 'id, title')
console.log(`base: ${evals.length} avaliações · ${scores.length} scores de IA · ${cats.length} category_scores\n`)

// Mesma regra da página: descarta 'failed', pega a mais recente por obra.
const latestByWork = new Map()
for (const e of evals) {
  if (e.status === 'failed') continue
  const cur = latestByWork.get(e.work_id)
  if (!cur || new Date(e.created_at) > new Date(cur.created_at)) latestByWork.set(e.work_id, e)
}
const visibleEvalIds = new Set([...latestByWork.values()].map((e) => e.id))
const evalById = new Map(evals.map((e) => [e.id, e]))
const titleById = new Map(works.map((w) => [w.id, w.title]))
const catKey = (w, s) => `${w}::${s}`
const catByKey = new Map(cats.map((c) => [catKey(c.work_id, c.criterion_slug), c.score]))

const rows = scores.map((s) => {
  const ev = evalById.get(s.ai_evaluation_id)
  const m = s.justification ? s.justification.match(BAND_RE) : null
  const band = m ? m[1] : null
  const score = ev ? catByKey.get(catKey(ev.work_id, s.criterion_slug)) : null
  let outside = null
  if (band && score != null) {
    const [lo, hi] = bandBounds(band)
    const r = Math.round(score * 10) / 10
    outside = r < lo || r > hi ? Math.round((r < lo ? lo - r : r - hi) * 10) / 10 : 0
  }
  return { ...s, ev, band, score, outside, visible: visibleEvalIds.has(s.ai_evaluation_id) }
})

for (const [scope, set] of [['TODAS as avaliações', rows], ['VISÍVEL (última por obra)', rows.filter((r) => r.visible)]]) {
  const noBand = set.filter((r) => !r.band)
  const withScore = set.filter((r) => r.outside != null)
  const out = withScore.filter((r) => r.outside > 0)
  console.log(`── ${scope} — ${set.length} atributos`)
  console.log(`   (A) sem faixa      : ${noBand.length} (${pct(noBand.length, set.length)})`)
  console.log(`   (B) ponto fora     : ${out.length} de ${withScore.length} c/ nota (${pct(out.length, withScore.length)})`)
}

console.log(`\n── (A) sem faixa, por versão de prompt (só o visível)`)
const byVer = new Map()
for (const r of rows.filter((r) => r.visible)) {
  const k = `${r.ev?.prompt_version ?? '?'} · ${r.ev?.model_name ?? '?'}`
  const v = byVer.get(k) ?? { tot: 0, no: 0, first: null, last: null }
  v.tot++
  if (!r.band) v.no++
  const d = r.ev?.created_at?.slice(0, 10)
  if (d) { if (!v.first || d < v.first) v.first = d; if (!v.last || d > v.last) v.last = d }
  byVer.set(k, v)
}
for (const [k, v] of [...byVer].sort((a, b) => b[1].no - a[1].no)) {
  console.log(`   ${k.padEnd(34)} ${String(v.no).padStart(5)}/${String(v.tot).padEnd(6)} ${pct(v.no, v.tot).padStart(6)}   ${v.first}→${v.last}`)
}

console.log(`\n── (A) sem faixa, por critério (só o visível)`)
const bySlug = new Map()
for (const r of rows.filter((r) => r.visible)) {
  const v = bySlug.get(r.criterion_slug) ?? { tot: 0, no: 0 }
  v.tot++
  if (!r.band) v.no++
  bySlug.set(r.criterion_slug, v)
}
for (const [k, v] of [...bySlug].sort((a, b) => b[1].no - a[1].no).slice(0, 12)) {
  console.log(`   ${k.padEnd(24)} ${String(v.no).padStart(5)}/${String(v.tot).padEnd(6)} ${pct(v.no, v.tot).padStart(6)}`)
}

console.log(`\n── amostras SEM FAIXA (visível)`)
for (const r of rows.filter((r) => r.visible && !r.band && r.justification).slice(0, 6)) {
  console.log(`   [${r.ev?.prompt_version}] ${titleById.get(r.ev?.work_id)?.slice(0, 34) ?? '?'} · ${r.criterion_slug}`)
  console.log(`      "${r.justification.slice(0, 110).replace(/\s+/g, ' ')}…"`)
}
const nulls = rows.filter((r) => r.visible && !r.justification).length
console.log(`   (justification NULL/vazia no visível: ${nulls})`)

console.log(`\n── piores PONTOS FORA DA FAIXA (visível)`)
for (const r of rows.filter((r) => r.visible && r.outside > 0).sort((a, b) => b.outside - a.outside).slice(0, 12)) {
  console.log(`   ${String(r.outside).padStart(4)} fora · nota ${String(r.score).padStart(4)} vs faixa ${r.band.padEnd(7)} · ${r.criterion_slug.padEnd(20)} ${titleById.get(r.ev?.work_id)?.slice(0, 32) ?? '?'}`)
}

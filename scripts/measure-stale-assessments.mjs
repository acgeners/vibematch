/**
 * READ-ONLY. Mede staleness das avaliações pós-leitura que treinam o attribute_bias,
 * E serve de HARNESS de validação da "opção E" (ver scripts/attribute-bias-option-e.md).
 *
 * Uma assessment é STALE quando seu ia_evaluation_id != a avaliação IA `completed`
 * mais recente da obra (mesmo critério de getLatestAiEvaluationAttributes).
 *
 * A coluna biasApp(cong) reproduz o attribute_bias ATUAL (deltas congelados em
 * ia_value_at_assessment). A coluna biasApp(vivo) é o que o bias VIRARIA sob a opção E
 * (deltas = suggested_score atual - user_value). Antes/depois do PR da opção E, o
 * attribute_bias gravado deve casar com a coluna "vivo" (±0,01 de arredondamento).
 *
 * Medição de 2026-07-16 (dono): 315/1233 = 25,5% stale, 6 versões de prompt (v16–v21),
 * mas Δbias máx 0,15 → abaixo do ruído (cvMAE 0,73). Ver project_attribute_bias_multiuser_fase3.
 *
 * Uso: node scripts/measure-stale-assessments.mjs   (não escreve nada)
 *
 * ALVO: LOCAL — só LÊ, então o `.env.analysis` (que vem DEPOIS e vence) o manda pro clone
 * local e o egress fica em zero. Sem ele, roda contra a NUVEM em silêncio.
 *   node --env-file=.env.local --env-file=.env.analysis scripts/measure-stale-assessments.mjs
 */
import { createClient } from '@supabase/supabase-js'

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
const K = 10 // BIAS_SHRINKAGE_K
const r2 = (x) => Math.round(x * 100) / 100

async function pageAll(table, cols, tweak) {
  const out = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).range(from, from + 999)
    if (tweak) q = tweak(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

// 1. Todas as assessments (per-user).
const assess = await pageAll(
  'user_attribute_assessment',
  'user_id, work_id, attribute_slug, user_value, ia_value_at_assessment, ia_evaluation_id, ia_prompt_version, ia_model_at_assessment',
)

const users = [...new Set(assess.map((a) => a.user_id))]
const workIds = [...new Set(assess.map((a) => a.work_id))]

console.log(`Assessments: ${assess.length} | obras distintas: ${workIds.length} | users: ${users.length}`)
for (const u of users) {
  console.log(`  user ${u}: ${assess.filter((a) => a.user_id === u).length} assessments`)
}

// 2. Avaliação completed MAIS RECENTE por obra (+ suggested_scores atuais).
//    .in() em chunks: acima de ~300 ids + embed despenca o plano (ver CLAUDE.md).
const evalRows = []
for (const c of chunk(workIds, 150)) {
  const rows = await pageAll(
    'ai_evaluations',
    'id, work_id, created_at, prompt_version, model_name, ai_evaluation_scores(criterion_slug, suggested_score)',
    (q) => q.in('work_id', c).eq('status', 'completed'),
  )
  evalRows.push(...rows)
}

const latestByWork = new Map()
for (const e of evalRows) {
  const cur = latestByWork.get(e.work_id)
  if (!cur || new Date(e.created_at) > new Date(cur.created_at)) latestByWork.set(e.work_id, e)
}
// Mapa (work_id -> slug -> suggested_score atual) da avaliação mais recente.
const currentScore = new Map()
for (const [wid, e] of latestByWork) {
  const m = new Map()
  for (const s of e.ai_evaluation_scores ?? []) {
    if (s.suggested_score != null) m.set(s.criterion_slug, Number(s.suggested_score))
  }
  currentScore.set(wid, m)
}

// 3. Classifica cada assessment.
let noEvalId = 0 // sem ia_evaluation_id gravado (linha antiga)
let noCurrentEval = 0 // obra sem avaliação completed hoje
let stale = 0 // eval_id presente mas != mais recente
let fresh = 0

const byAttr = new Map() // slug -> { n, staleN, frozen:[], live:[] }
const getAttr = (s) => {
  if (!byAttr.has(s)) byAttr.set(s, { n: 0, staleN: 0, frozen: [], live: [] })
  return byAttr.get(s)
}

const promptMix = new Map() // prompt_version das assessments -> count

for (const a of assess) {
  const latest = latestByWork.get(a.work_id)
  const A = getAttr(a.attribute_slug)
  A.n++
  promptMix.set(a.ia_prompt_version ?? 'null', (promptMix.get(a.ia_prompt_version ?? 'null') ?? 0) + 1)

  const frozenDelta = Number(a.ia_value_at_assessment) - Number(a.user_value)
  A.frozen.push(frozenDelta)

  let isStale = false
  if (!a.ia_evaluation_id) noEvalId++
  else if (!latest) noCurrentEval++
  else if (a.ia_evaluation_id !== latest.id) { stale++; isStale = true }
  else fresh++

  if (isStale) A.staleN++

  // delta ao vivo (opção E): usa suggested_score atual da obra pra esse atributo.
  const liveScore = currentScore.get(a.work_id)?.get(a.attribute_slug)
  if (liveScore != null) A.live.push(liveScore - Number(a.user_value))
}

const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const bias = (xs) => (xs.length ? mean(xs) * (xs.length / (xs.length + K)) : 0)

console.log(`\n=== Classificação das ${assess.length} assessments ===`)
console.log(`  fresh (aponta pra avaliação atual): ${fresh}`)
console.log(`  STALE (aponta pra avaliação substituída): ${stale}  (${r2((100 * stale) / assess.length)}%)`)
console.log(`  sem ia_evaluation_id (linha antiga): ${noEvalId}`)
console.log(`  obra sem avaliação completed hoje: ${noCurrentEval}`)

console.log(`\n=== prompt_version congelado nas assessments ===`)
for (const [v, c] of [...promptMix].sort((a, b) => b[1] - a[1])) console.log(`  ${v}: ${c}`)

console.log(`\n=== Bias por atributo: CONGELADO (atual) vs AO VIVO (opção E) ===`)
console.log(
  'attr'.padEnd(26) +
    'n'.padStart(4) +
    'stale'.padStart(7) +
    'biasApp(cong)'.padStart(15) +
    'biasApp(vivo)'.padStart(15) +
    'Δbias'.padStart(9),
)
let maxDelta = 0
for (const [slug, A] of byAttr) {
  const bFrozen = bias(A.frozen)
  const bLive = bias(A.live)
  const d = bLive - bFrozen
  if (Math.abs(d) > Math.abs(maxDelta)) maxDelta = d
  console.log(
    slug.padEnd(26) +
      String(A.n).padStart(4) +
      String(A.staleN).padStart(7) +
      r2(bFrozen).toFixed(2).padStart(15) +
      r2(bLive).toFixed(2).padStart(15) +
      (d >= 0 ? '+' : '') + r2(d).toFixed(2).padStart(8),
  )
}
console.log(`\nMaior |Δbias| entre atributos (congelado→vivo): ${r2(Math.abs(maxDelta))}`)
console.log('(Δbias = quanto a correção global daquele atributo mudaria se usasse deltas ao vivo)')

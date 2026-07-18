/**
 * Mede a DEFASAGEM da auditoria de critérios IA — o quanto do dado que a auditoria varre mudou
 * desde o último run. Espelha server/queries/calibration.ts::loadAuditStaleness pra validar a
 * lógica contra o banco real e fundamentar o mockup do card.
 *
 * Uso: node scripts/measure-audit-staleness.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Régua atual (lib/ai/models.ts + lib/ai-calibration/service.ts).
const CURRENT_MODEL = 'claude-sonnet-5'
const CURRENT_PROMPT_VERSION = 'v1'
const REVIEW = 0.1
const STALE = 0.25

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

async function main() {
  // dono = singleton de user_settings (o mais antigo)
  const { data: ownerRow, error: ownerErr } = await sb
    .from('user_settings')
    .select('current_user_id')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (ownerErr) throw new Error(`user_settings: ${ownerErr.message}`)
  const ownerId = ownerRow?.current_user_id
  console.log('owner:', ownerId)

  // último run de audit concluído
  const { data: lastRun, error: runErr } = await sb
    .from('calibration_runs')
    .select('*')
    .eq('mode', 'audit')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (runErr) throw new Error(`calibration_runs: ${runErr.message}`)

  // pool: obras avaliadas e não arquivadas do dono
  const poolRows = await pageAll('works_owner', 'id', (q) =>
    q.not('user_score', 'is', null).eq('is_archived', false).order('id', { ascending: true }),
  )
  const poolIds = new Set(poolRows.map((r) => r.id))
  const ratedWorks = poolIds.size

  if (!lastRun) {
    console.log('\n== NUNCA AUDITADO ==')
    console.log('ratedWorks:', ratedWorks, '→ level: never')
    return
  }

  const since = lastRun.completed_at ?? lastRun.created_at
  console.log('\nlastRun:', {
    id: lastRun.id,
    completed_at: lastRun.completed_at,
    since,
    n_works_scanned: lastRun.n_works_scanned,
    n_suggestions: lastRun.n_suggestions,
    n_auto_applied: lastRun.n_auto_applied,
    model_name: lastRun.model_name,
    prompt_version: lastRun.prompt_version,
  })

  // C — nota pessoal do dono mudou desde o run
  const scoreChanged = await pageAll('user_work_state', 'work_id', (q) =>
    q
      .eq('user_id', ownerId)
      .not('user_score', 'is', null)
      .gt('updated_at', since)
      .order('work_id', { ascending: true }),
  )
  const changedByScore = new Set(scoreChanged.map((r) => r.work_id).filter((id) => poolIds.has(id)))

  // B — category_scores mudou por fonte que a auditoria PODE reescrever (imported/ai_accepted).
  // Exclui travadas (manual/ai_edited) e a própria auditoria (ai_calibrated).
  const criteriaChanged = await pageAll('category_scores', 'work_id', (q) =>
    q.gt('updated_at', since).in('source', ['imported', 'ai_accepted']).order('work_id', { ascending: true }),
  )
  const changedByCriteria = new Set(
    criteriaChanged.map((r) => r.work_id).filter((id) => poolIds.has(id)),
  )

  const changedWorks = new Set([...changedByScore, ...changedByCriteria]).size
  const staleFraction = ratedWorks > 0 ? changedWorks / ratedWorks : 0
  const modelDrift =
    lastRun.model_name !== CURRENT_MODEL || lastRun.prompt_version !== CURRENT_PROMPT_VERSION

  let level
  if (modelDrift || staleFraction >= STALE) level = 'stale'
  else if (staleFraction >= REVIEW) level = 'review'
  else level = 'fresh'

  // ALT — prediction_ledger: rótulo novo (1ª nota) desde o run, sem ruído de capítulo/backfill.
  const ledger = await pageAll('prediction_ledger', 'work_id, captured_at', (q) =>
    q.eq('user_id', ownerId).order('work_id', { ascending: true }),
  )
  const ledgerWorkIds = new Set(ledger.map((r) => r.work_id))
  const newlyRated = new Set(
    ledger.filter((r) => r.captured_at > since && poolIds.has(r.work_id)).map((r) => r.work_id),
  )
  const poolWithLedger = [...poolIds].filter((id) => ledgerWorkIds.has(id)).length
  console.log('\nledger diag:', {
    ledgerRowsOwner: ledger.length,
    poolWithLedger,
    poolWithoutLedger: ratedWorks - poolWithLedger,
    newlyRatedSinceRun: newlyRated.size,
  })

  console.log('\n== DEFASAGEM ==')
  console.table({
    ratedWorks,
    changedWorks,
    changedByScore: changedByScore.size,
    changedByCriteria: changedByCriteria.size,
    staleFraction: `${(staleFraction * 100).toFixed(1)}%`,
    modelDrift,
    level,
  })

  // diagnóstico do super-count de C: quantas linhas cruas vs distintas na pool
  console.log('\ndiag:', {
    scoreChangedRows: scoreChanged.length,
    scoreChangedInPool: changedByScore.size,
    criteriaChangedRows: criteriaChanged.length,
    criteriaChangedInPool: changedByCriteria.size,
    onlyScore: [...changedByScore].filter((id) => !changedByCriteria.has(id)).length,
    onlyCriteria: [...changedByCriteria].filter((id) => !changedByScore.has(id)).length,
    both: [...changedByScore].filter((id) => changedByCriteria.has(id)).length,
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

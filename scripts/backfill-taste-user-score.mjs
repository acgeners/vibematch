/**
 * Backfill: deriva o user_score (rótulo do modelo) da avaliação por GOSTO e grava no espelho
 * do DONO, para todas as obras com os 7 eixos fixos completos (sem o Final). Lógica IDÊNTICA a
 * computeTasteUserScore (server/queries/pilot-taste.ts): média simples dos 7, tudo-ou-nada.
 *
 * Uso:
 *   node scripts/backfill-taste-user-score.mjs           # DRY-RUN (não escreve)
 *   node scripts/backfill-taste-user-score.mjs --apply   # escreve + marca recalc_pending
 *
 * 🔴 ALVO: NUVEM — este script GRAVA. Rodá-lo contra o local, que é réplica descartável,
 * joga o trabalho fora no próximo `db:pull`.
 *   node --env-file=.env.local scripts/backfill-taste-user-score.mjs
 */
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const APPLY = process.argv.includes('--apply')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// 7 eixos fixos, SEM like_ending_score (o Final não entra no rótulo — PR #153).
const LABEL_KEYS = [
  'like_female_lead_score', 'like_male_lead_score', 'like_couple_score',
  'like_setting_score', 'like_tone_score', 'like_art_score', 'like_pacing_score',
]
const round1 = (x) => Math.round(x * 10) / 10
const computeLabel = (row) => {
  const vals = []
  for (const k of LABEL_KEYS) {
    const v = row[k]
    if (v == null || !Number.isFinite(Number(v))) return null
    vals.push(Number(v))
  }
  return round1(vals.reduce((a, b) => a + b, 0) / vals.length)
}

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
  // Dono = primeira linha de user_settings (mesma regra de getSingletonUserId).
  const { data: settings, error: sErr } = await sb
    .from('user_settings').select('current_user_id').order('created_at', { ascending: true }).limit(1).maybeSingle()
  if (sErr || !settings?.current_user_id) throw new Error(`owner: ${sErr?.message ?? 'sem singleton'}`)
  const ownerId = settings.current_user_id
  console.log(`Dono: ${ownerId} · modo: ${APPLY ? 'APPLY (escreve)' : 'DRY-RUN'}`)

  const taste = await pageAll('pilot_taste_scores', '*')
  const owners = await pageAll('user_work_state', 'work_id, user_score', (q) => q.eq('user_id', ownerId))
  const curById = new Map(owners.map((r) => [r.work_id, r.user_score == null ? null : Number(r.user_score)]))

  const writes = []
  let complete = 0, unchanged = 0
  for (const t of taste) {
    const label = computeLabel(t)
    if (label == null) continue
    complete++
    const cur = curById.get(t.work_id) ?? null
    if (cur != null && cur === label) { unchanged++; continue }
    writes.push({ work_id: t.work_id, prev: cur, label })
  }

  const nulls = writes.filter((w) => w.prev == null).length
  console.log(`\n7 eixos completos: ${complete} · a gravar: ${writes.length} (novas Real: ${nulls}, mudam: ${writes.length - nulls}) · já iguais: ${unchanged}`)

  if (!APPLY) {
    console.log('\nDRY-RUN — nada escrito. Rode com --apply para gravar.')
    return
  }

  const now = new Date().toISOString()
  let done = 0
  for (let i = 0; i < writes.length; i += 500) {
    const rows = writes.slice(i, i + 500).map((w) => ({ user_id: ownerId, work_id: w.work_id, user_score: w.label, updated_at: now }))
    const { error } = await sb.from('user_work_state').upsert(rows, { onConflict: 'user_id,work_id' })
    if (error) throw new Error(`upsert: ${error.message}`)
    done += rows.length
  }
  console.log(`✓ gravadas ${done} linhas de user_score.`)

  const { error: rpcErr } = await sb.rpc('touch_recalc_pending')
  if (rpcErr) console.warn(`⚠ touch_recalc_pending falhou: ${rpcErr.message} — rode markRecalcPending manualmente.`)
  else console.log('✓ recalc_pending marcado — rode `npm run recalc:scores`.')
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1) })

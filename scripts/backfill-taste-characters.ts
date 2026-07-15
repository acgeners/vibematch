/**
 * backfill-taste-characters.ts — semeia os 3 eixos de personagem novos (mig 158) a partir do que
 * já existe. IDEMPOTENTE: só preenche coluna que está NULL; nunca sobrescreve.
 *
 *   dry-run:  npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/backfill-taste-characters.ts --dry-run
 *   aplicar:  npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/backfill-taste-characters.ts
 *
 * Semente (o "Casal/Prot" agrupado vira 3 eixos finos):
 *   like_female_lead_score ← craft post_fl_score      (nota granular que já existe, 197 obras)
 *   like_male_lead_score   ← craft post_ml_score
 *   like_couple_score      ← like_leads_score          (a preferência já dada ao bundle)
 * Escala idêntica {2,4,6.5,8,10} nos três — sem conversão. O dono refina depois.
 */
import { createClient } from "@supabase/supabase-js"

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const DONO = "e62ef992-5da9-4bb8-8909-b75ceeee33a9"
const DRY = process.argv.includes("--dry-run")

async function all(table: string, cols: string, filt?: (q: any) => any): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    let q = sb.from(table).select(cols).range(from, from + 999)
    if (filt) q = filt(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  return rows
}

async function main() {
  const uws = await all("user_work_state", "work_id,post_fl_score,post_ml_score", q => q.eq("user_id", DONO))
  const pts = await all(
    "pilot_taste_scores",
    "work_id,like_leads_score,like_female_lead_score,like_male_lead_score,like_couple_score",
  )
  const ptsBy = new Map(pts.map(r => [r.work_id, r]))

  let updated = 0, inserted = 0, skipped = 0, filledFL = 0, filledML = 0, filledCouple = 0
  for (const u of uws) {
    const fl = u.post_fl_score, ml = u.post_ml_score
    const p = ptsBy.get(u.work_id)
    const couple = p?.like_leads_score
    const patch: Record<string, number> = {}
    if (fl != null && (!p || p.like_female_lead_score == null)) { patch.like_female_lead_score = Number(fl); filledFL++ }
    if (ml != null && (!p || p.like_male_lead_score == null)) { patch.like_male_lead_score = Number(ml); filledML++ }
    if (couple != null && (!p || p.like_couple_score == null)) { patch.like_couple_score = Number(couple); filledCouple++ }
    if (Object.keys(patch).length === 0) { skipped++; continue }

    if (!DRY) {
      const res = p
        ? await sb.from("pilot_taste_scores").update(patch).eq("work_id", u.work_id)
        : await sb.from("pilot_taste_scores").insert({ work_id: u.work_id, ...patch })
      if (res.error) throw new Error(`write ${u.work_id}: ${res.error.message}`)
    }
    if (p) updated++; else inserted++
  }

  console.log(`${DRY ? "[DRY-RUN] " : ""}backfill de personagens:`)
  console.log(`  linhas atualizadas: ${updated} | inseridas: ${inserted} | sem nada a semear: ${skipped}`)
  console.log(`  campos preenchidos → FL: ${filledFL} · ML: ${filledML} · Casal: ${filledCouple}`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })

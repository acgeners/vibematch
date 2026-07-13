/**
 * FATIA 2b — o recalc espelha os scores do dono?
 *
 * Roda o recalc e exige que `user_calculated_scores` (do dono) fique IDÊNTICO a
 * `calculated_scores`. Mesmo teste das fatias anteriores: o espelho não pode nascer torto.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/verify-2b-mirror.ts
 */
import { recalculateAll } from "@/server/actions/calculations"
import { createAdminClient } from "@/lib/supabase/admin"
import { getOwnerUserId } from "@/server/queries/current-user"

const FIELDS = [
  "expected_score",
  "calc_score",
  "chance_score",
  "personal_fit",
  "personal_fit_percentile",
  "tag_overlap_net",
  "expected_is_stub",
] as const

async function fetchAll(table: string, cols: string, order: string, userId?: string) {
  const sb = createAdminClient()
  const rows: Record<string, unknown>[] = []
  for (let from = 0; ; from += 500) {
    let q = sb.from(table).select(cols).order(order).range(from, from + 499)
    if (userId) q = q.eq("user_id", userId)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    if (!data?.length) break
    rows.push(...(data as unknown as Record<string, unknown>[]))
    if (data.length < 500) break
  }
  return rows
}

async function main() {
  const owner = await getOwnerUserId()
  console.log("── recalculateAll(headless)\n")
  const res = await recalculateAll("headless")
  console.log(`   ${res.recalculated} obras recalculadas\n`)

  const cols = ["work_id", ...FIELDS].join(", ")
  const [cs, ucs] = await Promise.all([
    fetchAll("calculated_scores", cols, "work_id"),
    fetchAll("user_calculated_scores", cols, "work_id", owner),
  ])

  const byWork = new Map(ucs.map((r) => [r.work_id as string, r]))
  let missing = 0
  const drift: Record<string, number> = {}

  for (const row of cs) {
    const mine = byWork.get(row.work_id as string)
    if (!mine) {
      missing++
      continue
    }
    for (const f of FIELDS) {
      if (String(row[f] ?? null) !== String(mine[f] ?? null)) {
        drift[f] = (drift[f] ?? 0) + 1
      }
    }
  }

  console.log(`── calculated_scores: ${cs.length} · espelho do dono: ${ucs.length}`)
  console.log(`   sem linha no espelho: ${missing}`)
  console.log(
    `   campos divergentes: ${Object.keys(drift).length === 0 ? "NENHUM" : JSON.stringify(drift)}`,
  )

  const ok = missing === 0 && Object.keys(drift).length === 0 && ucs.length === cs.length
  console.log(
    ok
      ? "\n✅ o espelho de scores nasce EM SINCRONIA com o recalc."
      : "\n❌ o espelho divergiu — NÃO mergear.",
  )
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(`\n💥 ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})

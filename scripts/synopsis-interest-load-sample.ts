/**
 * Carrega a golden sample congelada na tabela synopsis_interest_golden
 * (migration 109). Idempotente (upsert por sample_version+slot_key). NÃO chama
 * provider. Default DRY-RUN: só conta; --apply grava.
 *
 * Uso:
 *   npx tsx --env-file=.env.local scripts/synopsis-interest-load-sample.ts          (dry-run)
 *   npx tsx --env-file=.env.local scripts/synopsis-interest-load-sample.ts --apply  (grava)
 *
 * Pré-requisito do --apply: migration 109 aplicada.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createClient } from "@supabase/supabase-js"

const APPLY = process.argv.includes("--apply")
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

interface Slot {
  slotKey: string; workId: string; split: string; stratum: string
  isRepeat: boolean; repeatOf: string | null; shuffleOrder: number
}

async function main() {
  const path = resolve(process.cwd(), "lib/synopsis-interest/golden-sample.pilot-1.json")
  const fixture = JSON.parse(readFileSync(path, "utf8")) as { sample_version: string; slots: Slot[] }
  console.log(`Fixture: ${fixture.sample_version} — ${fixture.slots.length} slots`)

  if (!APPLY) {
    console.log("[DRY-RUN] nada gravado. Rode com --apply (exige migration 109).")
    return
  }

  const rows = fixture.slots.map((s) => ({
    sample_version: fixture.sample_version,
    slot_key: s.slotKey,
    work_id: s.workId,
    split: s.split,
    stratum: s.stratum,
    is_repeat: s.isRepeat,
    repeat_of: s.repeatOf,
    shuffle_order: s.shuffleOrder,
  }))
  const { error } = await sb.from("synopsis_interest_golden").upsert(rows, { onConflict: "sample_version,slot_key" })
  if (error) throw new Error(error.message)
  console.log(`[APPLIED] ${rows.length} slots gravados em synopsis_interest_golden.`)
}

main().catch((err) => { console.error("[load-sample] erro:", err); process.exit(1) })

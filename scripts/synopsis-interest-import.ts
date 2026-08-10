/**
 * Importa os rótulos cegos preenchidos no CSV → synopsis_interest_golden
 * (Plano 3 Fase B). Valida antes (slots conhecidos, níveis válidos). NÃO chama
 * provider. NÃO toca works.synopsis_quality. Default DRY-RUN; --apply grava.
 *
 * Uso:
 * 🔴 ALVO: NUVEM — este script GRAVA (catálogo e/ou o log de custo em `ai_api_calls`). Rodá-lo contra o local, que é réplica descartável, joga o trabalho fora no próximo `db:pull`.
 *   npx tsx --env-file=.env.local scripts/synopsis-interest-import.ts            (dry-run/valida)
 *   npx tsx --env-file=.env.local scripts/synopsis-interest-import.ts --apply    (grava human_label)
 *
 * Pré-requisito do --apply: migration 109 + sample carregada (load-sample --apply).
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createClient } from "@supabase/supabase-js"
import { parseLabelCsv, validateLabelRows } from "@/lib/synopsis-interest/labels"

const APPLY = process.argv.includes("--apply")
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

interface Slot { slotKey: string }

async function main() {
  const dir = resolve(process.cwd(), "lib/synopsis-interest")
  const fixture = JSON.parse(readFileSync(resolve(dir, "golden-sample.pilot-1.json"), "utf8")) as { sample_version: string; slots: Slot[] }
  const expected = fixture.slots.map((s) => s.slotKey)

  const csvPath = resolve(dir, "labeling-sheet.pilot-1.csv")
  const rows = parseLabelCsv(readFileSync(csvPath, "utf8"))
  const v = validateLabelRows(rows, expected)

  console.log(`Validação (${fixture.sample_version}):`)
  console.log(`  válidos=${v.valid.length} | sem rótulo=${v.unlabeled.length} | erros=${v.errors.length} | ausentes=${v.missing.length}`)
  if (v.errors.length) console.log("  ERROS:\n   - " + v.errors.slice(0, 20).join("\n   - "))
  if (v.unlabeled.length) console.log(`  sem rótulo (primeiros): ${v.unlabeled.slice(0, 10).join(", ")}`)

  if (!APPLY) {
    console.log("\n[DRY-RUN] nada gravado. Rode com --apply (exige migration 109 + sample carregada).")
    return
  }
  if (v.errors.length) {
    console.error("\n[ABORT] corrija os erros antes de gravar.")
    process.exit(1)
  }
  const now = new Date().toISOString()
  let ok = 0
  for (const { slotKey, label } of v.valid) {
    const { error } = await sb
      .from("synopsis_interest_golden")
      .update({ human_label: label, labeled_at: now })
      .eq("sample_version", fixture.sample_version)
      .eq("slot_key", slotKey)
    if (error) console.warn(`  ✗ ${slotKey}: ${error.message}`)
    else ok += 1
  }
  console.log(`\n[APPLIED] ${ok}/${v.valid.length} rótulos gravados.`)
}

main().catch((err) => { console.error("[import] erro:", err); process.exit(1) })

/**
 * Roda o recalc real (headless, $0) pra popular chance_score e verifica ao vivo.
 * Uso: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/chance-recalc-run.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { recalculateAll } from "@/server/actions/calculations"
import { createAdminClient } from "@/lib/supabase/admin"

async function main() {
  console.log("rodando recalculateAll(headless)… (sem LLM, $0)")
  const t0 = Date.now()
  const res = await recalculateAll("headless")
  console.log(`✓ recalc: recalculated=${res.recalculated} em ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  const sb = createAdminClient()
  const { count: filled } = await sb.from("calculated_scores").select("work_id", { count: "exact", head: true }).not("chance_score", "is", null)
  const { count: total } = await sb.from("calculated_scores").select("work_id", { count: "exact", head: true })
  const { count: stub } = await sb.from("calculated_scores").select("work_id", { count: "exact", head: true }).eq("chance_is_stub", true)
  console.log(`\nchance_score no banco: preenchidos=${filled}/${total}  ·  stub=${stub}`)

  const top = await sb.from("calculated_scores").select("chance_score, works(title, user_score)").not("chance_score", "is", null).order("chance_score", { ascending: false }).limit(5)
  const bot = await sb.from("calculated_scores").select("chance_score, works(title, user_score)").not("chance_score", "is", null).order("chance_score", { ascending: true }).limit(5)
  const row = (r: any) => `  ${Number(r.chance_score).toFixed(0).padStart(3)}%  ${String(r.works?.title ?? "?").slice(0, 42).padEnd(42)} (nota ${r.works?.user_score ?? "—"})`
  console.log("\n— maior chance (do banco) —")
  ;(top.data as any[] ?? []).forEach((r) => console.log(row(r)))
  console.log("— menor chance (do banco) —")
  ;(bot.data as any[] ?? []).forEach((r) => console.log(row(r)))

  console.log("\n✓ persistido e verificado ao vivo.\n")
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.stack : String(e)); process.exit(1) })

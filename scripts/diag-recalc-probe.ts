/**
 * SONDA read-only do diagnóstico de recalc (Frente 1, $0, 0 escrita).
 * Só LÊ: estado de recalc_pending, nº de obras, nº de rotuladas (user_score),
 * e a dispersão atual dos scores em calculated_scores. Nada é computado/escrito.
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { getRecalcPendingState } from "@/server/actions/recalc-queue"

function std(xs: number[]): number {
  if (xs.length === 0) return 0
  const m = xs.reduce((a, b) => a + b, 0) / xs.length
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length)
}

async function main() {
  const supabase = createAdminClient()
  const state = await getRecalcPendingState()
  console.log(`recalc_pending=${state.pending} · last_edit_at=${state.lastEditAt ?? "—"}`)

  const { count: total } = await supabase
    .from("works")
    .select("id", { count: "exact", head: true })
    .eq("is_archived", false)
  const { count: labeled } = await supabase
    .from("works")
    .select("id", { count: "exact", head: true })
    .eq("is_archived", false)
    .not("user_score", "is", null)
  console.log(`obras (não-arquivadas)=${total} · rotuladas (user_score)=${labeled}`)

  const { data: cs } = await supabase
    .from("calculated_scores")
    .select("expected_score, calc_score, personal_fit, tag_overlap_net")
    .limit(2000)
  const rows = cs ?? []
  const col = (k: string) => rows.map((r) => (r as Record<string, number | null>)[k]).filter((v): v is number => v != null)
  for (const k of ["expected_score", "calc_score", "personal_fit", "tag_overlap_net"]) {
    const xs = col(k)
    if (xs.length === 0) { console.log(`${k}: (vazio)`); continue }
    const min = Math.min(...xs), max = Math.max(...xs)
    console.log(`${k}: n=${xs.length} std=${std(xs).toFixed(4)} min=${min.toFixed(3)} max=${max.toFixed(3)} range=${(max - min).toFixed(3)}`)
  }
}

main().catch((e) => { console.error("FATAL:", e instanceof Error ? e.message : e); process.exit(1) })

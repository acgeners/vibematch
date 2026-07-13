/**
 * A promessa da Fatia 2b: quem avalia 20 obras GANHA a Nota Prevista dele.
 *
 * E as duas coisas que não podem acontecer no caminho:
 *   1. o modelo DELA não pode encostar no do DONO (as 878 notas dele não se mexem)
 *   2. abaixo de 20 rótulos, ela NÃO ganha uma nota ruim — ganha NENHUMA
 *      (hoje o app exibe a média do treino como se fosse previsão: um chute com cara de número)
 *
 * Semeia rótulos de teste, roda o recalc dela, confere, e limpa tudo.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/verify-user-recalc.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { recalculateForUser } from "@/server/recalc/user-recalc"
import { getOwnerUserId } from "@/server/queries/current-user"

let fails = 0
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✅" : "❌"} ${msg}`)
  if (!ok) fails++
}

async function main() {
  const sb = createAdminClient()
  const ownerId = await getOwnerUserId()

  const { data: other } = await sb
    .from("user_settings")
    .select("current_user_id, email, role")
    .neq("current_user_id", ownerId)
    .limit(1)
    .maybeSingle()
  if (!other) {
    console.log("não há segundo usuário — abortando")
    return
  }
  const userId = other.current_user_id as string
  console.log(`usuária: ${other.email} [${other.role}]\n`)

  // Estado do DONO, antes de tudo — é ele que não pode se mexer.
  const ownerBefore = await sb
    .from("calculated_scores")
    .select("work_id, expected_score")
    .order("work_id")
    .limit(1000)

  const { data: works } = await sb
    .from("works")
    .select("id")
    .eq("is_archived", false)
    .not("user_score", "is", null)
    .limit(30)
  const ids = (works ?? []).map((w) => w.id as string)

  const seed = async (n: number) => {
    const now = new Date().toISOString()
    const rows = ids.slice(0, n).map((work_id, i) => ({
      user_id: userId,
      work_id,
      // Notas variadas: um Ridge treinado com 20 notas iguais não aprende nada.
      user_score: 5 + ((i * 7) % 6) * 0.8,
      personal_status_id: 1,
      updated_at: now,
    }))
    await sb.from("user_work_state").upsert(rows, { onConflict: "user_id,work_id" })
  }

  console.log("1) 12 rótulos — ABAIXO do mínimo (MIN_TRAIN = 20)")
  await seed(12)
  const r1 = await recalculateForUser(userId)
  check(r1.labelledCount === 12, `${r1.labelledCount} rótulos lidos`)
  check(!r1.hasModel, "modelo NÃO treinou (é o esperado)")
  const { count: comNota12 } = await sb
    .from("user_calculated_scores")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .not("expected_score", "is", null)
  check(
    comNota12 === 0,
    `🔴 ZERO Notas Previstas gravadas (${comNota12}) — nenhum chute com cara de número`,
  )

  console.log("\n2) 24 rótulos — ACIMA do mínimo")
  await seed(24)
  const r2 = await recalculateForUser(userId)
  check(r2.labelledCount === 24, `${r2.labelledCount} rótulos lidos`)
  check(r2.hasModel, "🔴 o MODELO DELA TREINOU — a Nota Prevista acendeu")

  const { data: hers } = await sb
    .from("user_calculated_scores")
    .select("work_id, expected_score, chance_score")
    .eq("user_id", userId)
    .not("expected_score", "is", null)
    .limit(1000)
  check((hers ?? []).length > 500, `${(hers ?? []).length} obras com Nota Prevista DELA`)

  const vals = (hers ?? []).map((h) => Number(h.expected_score))
  const media = vals.reduce((a, b) => a + b, 0) / vals.length
  const desvio = Math.sqrt(vals.reduce((s, v) => s + (v - media) ** 2, 0) / vals.length)
  check(desvio > 0.1, `as notas dela VARIAM (desvio ${desvio.toFixed(3)}) — não colapsaram na média`)

  console.log("\n3) 🔴 E O DONO? As 878 notas dele não podem ter se mexido.")
  const ownerAfter = await sb
    .from("calculated_scores")
    .select("work_id, expected_score")
    .order("work_id")
    .limit(1000)
  const beforeMap = new Map((ownerBefore.data ?? []).map((r) => [r.work_id, r.expected_score]))
  const moved = (ownerAfter.data ?? []).filter(
    (r) => String(beforeMap.get(r.work_id) ?? null) !== String(r.expected_score ?? null),
  )
  check(moved.length === 0, `calculated_scores (do dono): ${moved.length} notas mudaram`)

  const { data: ownerMirror } = await sb
    .from("user_calculated_scores")
    .select("work_id, expected_score")
    .eq("user_id", ownerId)
    .limit(3)
  check(
    (ownerMirror ?? []).some((r) => r.expected_score != null),
    "o espelho do DONO segue com as notas dele",
  )

  // As notas dela têm que ser DIFERENTES das dele — modelos diferentes, gostos diferentes.
  const { data: pair } = await sb
    .from("user_calculated_scores")
    .select("work_id, expected_score, user_id")
    .in("user_id", [ownerId, userId])
    .limit(2000)
  const byWork = new Map<string, { dono?: number; dela?: number }>()
  for (const row of pair ?? []) {
    const e = byWork.get(row.work_id as string) ?? {}
    if (row.user_id === ownerId) e.dono = Number(row.expected_score)
    else e.dela = Number(row.expected_score)
    byWork.set(row.work_id as string, e)
  }
  const comparaveis = [...byWork.values()].filter((v) => v.dono != null && v.dela != null)
  const diferentes = comparaveis.filter((v) => v.dono !== v.dela)
  check(
    diferentes.length > comparaveis.length * 0.5,
    `as notas DELA diferem das DELE em ${diferentes.length}/${comparaveis.length} obras — são modelos distintos`,
  )

  console.log("\n── limpeza")
  await sb.from("user_work_state").delete().eq("user_id", userId)
  await sb.from("user_calculated_scores").delete().eq("user_id", userId)
  const { count: sobrou } = await sb
    .from("user_calculated_scores")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
  check(sobrou === 0, `estado de teste removido (${sobrou} linhas)`)

  console.log(
    fails === 0
      ? "\n✅ O MODELO DELA É DELA — e o do dono não se mexeu."
      : `\n❌ ${fails} falha(s).`,
  )
  process.exit(fails === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`\n💥 ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})

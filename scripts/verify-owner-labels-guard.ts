/**
 * O GUARDA BARULHENTO dispara mesmo?
 *
 * Um guarda que nunca foi visto disparar é decoração. Este script aponta `loadOwnerLabels`
 * para um usuário SEM rótulos (a Leitora) e exige que ele EXPLODA — porque é exatamente esse
 * o cenário que ele existe pra pegar: o dia em que o `user_id` vier errado, ou a RLS morder, e
 * o recalc ler zero notas. Sem o guarda, o Ridge não reclamaria: cairia na média do treino e
 * devolveria 878 notas plausíveis e erradas.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/verify-owner-labels-guard.ts
 */
import { loadOwnerLabels } from "@/server/queries/owner-labels"
import { createAdminClient } from "@/lib/supabase/admin"

let failures = 0
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✅" : "❌"} ${msg}`)
  if (!ok) failures++
}

async function main() {
  const sb = createAdminClient()

  console.log("1) o DONO: o carregamento tem que funcionar")
  const owner = await loadOwnerLabels()
  check(owner.labelledCount >= 50, `${owner.labelledCount} rótulos carregados (dono ${owner.ownerId.slice(0, 8)})`)
  check(owner.byWorkId.size > 800, `${owner.byWorkId.size} obras com estado no espelho`)

  console.log("\n2) 🔴 um usuário SEM rótulos: o guarda TEM que explodir")
  const { data: reader } = await sb
    .from("user_settings")
    .select("current_user_id, email")
    .neq("role", "curador")
    .limit(1)
    .maybeSingle()

  if (!reader) {
    console.log("  ⏭️  não há usuário não-curador pra testar")
  } else {
    let threw = false
    let msg = ""
    try {
      await loadOwnerLabels(reader.current_user_id as string)
    } catch (e) {
      threw = true
      msg = e instanceof Error ? e.message : String(e)
    }
    check(threw, `explodiu ao ler os rótulos de ${reader.email} (que não tem nenhum)`)
    check(
      msg.includes("Ridge") || msg.includes("rótulos"),
      "e a mensagem DIZ o que está em jogo (não é um 'erro inesperado')",
    )
    if (threw) console.log(`\n     mensagem: "${msg.slice(0, 140)}…"`)
  }

  console.log(
    failures === 0
      ? "\n✅ O GUARDA DISPARA — o recalc falha ALTO em vez de treinar com nada."
      : `\n❌ ${failures} falha(s) — o guarda não protege.`,
  )
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`\n💥 ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})

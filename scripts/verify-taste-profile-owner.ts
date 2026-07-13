/**
 * O perfil de gosto de um usuário DERRUBA o do dono?
 *
 * Era esse o bug: `taste_profile` não tinha dono, e a linha corrente era encontrada por
 * `is_current = true` — UMA no banco inteiro. Um Assinante gerando o perfil dele desmarcava a
 * do dono, e o recalc seguinte treinava o Ridge DELE com as loved_tags DELA. Sem erro, sem log,
 * 878 notas mudadas.
 *
 * Este script simula exatamente isso: insere um perfil corrente para a Leitora e exige que o
 * do dono continue de pé. Limpa depois.
 *
 *   npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local scripts/verify-taste-profile-owner.ts
 */
import { createAdminClient } from "@/lib/supabase/admin"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
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
    .select("current_user_id, email")
    .neq("current_user_id", ownerId)
    .limit(1)
    .maybeSingle()
  if (!other) {
    console.log("não há um segundo usuário pra testar — abortando")
    return
  }
  const otherId = other.current_user_id as string

  const before = await loadCurrentTasteProfile(ownerId)
  check(before != null, `o DONO tem perfil corrente (v${before?.version}, ${before?.n_works_used} obras)`)
  const lovedBefore = (before?.profile?.loved_tags ?? []).length

  console.log(`\n🔴 simulando: ${other.email} gera o perfil DELA (is_current = true)`)
  const { error: insErr } = await sb.from("taste_profile").insert({
    user_id: otherId,
    version: 1,
    is_current: true,
    is_stub: false,
    n_works_used: 3,
    input_hash: "TESTE-DERRUBA-O-DONO",
    model_name: "teste",
    prompt_version: "teste",
    profile: { loved_tags: [{ name: "TAG DELA" }], avoided_tags: [], criterion_preferences: {} },
    raw_response: {},
  })
  if (insErr) throw new Error(`insert: ${insErr.message}`)

  const after = await loadCurrentTasteProfile(ownerId)
  check(after != null, "o perfil do DONO continua sendo encontrado")
  check(
    after?.version === before?.version,
    `é o MESMO perfil (v${after?.version}) — não foi trocado pelo dela`,
  )
  check(
    (after?.profile?.loved_tags ?? []).length === lovedBefore,
    `as loved_tags do dono estão intactas (${lovedBefore})`,
  )
  check(
    !JSON.stringify(after?.profile ?? {}).includes("TAG DELA"),
    "🔴 o perfil DELE não contém as tags DELA",
  )

  const hers = await loadCurrentTasteProfile(otherId)
  check(hers?.profile?.loved_tags?.[0]?.name === "TAG DELA", "e ela vê o perfil DELA")

  const { count } = await sb
    .from("taste_profile")
    .select("*", { count: "exact", head: true })
    .eq("is_current", true)
  check(count === 2, `há ${count} perfis correntes — UM POR PESSOA (antes: só 1 no banco todo)`)

  console.log("\n── limpeza")
  await sb.from("taste_profile").delete().eq("input_hash", "TESTE-DERRUBA-O-DONO")
  const final = await loadCurrentTasteProfile(ownerId)
  check(final?.version === before?.version, "perfil do dono intacto ao final")

  console.log(
    fails === 0
      ? "\n✅ O PERFIL DO DONO É DELE — outro usuário não o derruba mais."
      : `\n❌ ${fails} falha(s).`,
  )
  process.exit(fails === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(`\n💥 ${e instanceof Error ? e.message : e}`)
  process.exit(1)
})

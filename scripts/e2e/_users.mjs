/**
 * Descobre os DOIS usuários do teste — do banco, nunca hardcoded.
 *
 * ⚠️ Este repositório é PÚBLICO. E-mail de usuário real é dado pessoal: não entra em código,
 * nem em comentário, nem em mensagem de commit. O dono sai da linha singleton de
 * `user_settings` (a mais antiga, o mesmo critério do app); "a outra" é qualquer não-dono.
 */
export async function findTestUsers(admin) {
  const { data, error } = await admin
    .from("user_settings")
    .select("current_user_id, email, role, created_at")
    .order("created_at", { ascending: true })
  if (error) throw new Error(`user_settings: ${error.message}`)
  if (!data?.length) throw new Error("user_settings vazia")

  const owner = data[0]
  const other = data.find((u) => u.current_user_id !== owner.current_user_id)
  if (!other) {
    throw new Error(
      "só há UM usuário no banco — estas suítes precisam de dois (crie um leitor pra rodar).",
    )
  }
  return { owner, other }
}

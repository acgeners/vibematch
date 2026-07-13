"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  ensureAdmin,
  ensureSignedIn,
  getCurrentUserProfile,
  getCurrentUserSettingsId,
  getSessionUserId,
} from "@/server/queries/current-user"
import { getAnthropicBalanceStatus } from "@/server/queries/ai-usage"
import type { BalanceStatus } from "@/server/queries/ai-usage"
import { accountProfileSchema } from "@/lib/validations/account.schema"
import type { AccountProfileValues } from "@/lib/validations/account.schema"
import type { Role } from "@/lib/plans/roles"

type AdminClient = ReturnType<typeof createAdminClient>

const AVATAR_BUCKET = "avatars"
const MAX_AVATAR_BYTES = 2 * 1024 * 1024 // 2 MiB — espelha o file_size_limit do bucket (migration 090).
const AVATAR_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
}

/**
 * id da linha de user_settings do USUÁRIO ATUAL — a MESMA que as queries leem
 * (resolver session-aware, com fallback singleton p/ anon). Todos os updates de
 * conta passam por aqui pra não atualizar a linha de outro usuário.
 */
async function getSingletonId(_supabase: AdminClient): Promise<string> {
  const id = await getCurrentUserSettingsId()
  if (!id) throw new Error("user_settings sem linha pro usuário atual — rode a migration 074.")
  return id
}

/** Salva nome/email/avatar (URL) do perfil. */
export async function updateProfile(
  values: AccountProfileValues,
): Promise<{ error?: string }> {
  const parsed = accountProfileSchema.safeParse(values)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." }
  }

  // Vazio → null pra não persistir "" no banco.
  const nullable = (v: string) => (v.trim() === "" ? null : v.trim())

  const supabase = createAdminClient()
  try {
    const id = await getSingletonId(supabase)
    const { error } = await supabase
      .from("user_settings")
      .update({
        display_name: nullable(parsed.data.displayName),
        email: nullable(parsed.data.email),
        avatar_url: nullable(parsed.data.avatarUrl),
      })
      .eq("id", id)
    if (error) return { error: error.message }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro ao salvar perfil." }
  }

  revalidatePath("/conta")
  revalidatePath("/") // saudação + avatar no Header do dashboard
  return {}
}

/**
 * Sobe um arquivo de imagem pro bucket público "avatars", grava a URL pública
 * em user_settings.avatar_url e a retorna pro form refletir na hora.
 */
export async function uploadAvatar(
  formData: FormData,
): Promise<{ url?: string; error?: string }> {
  const file = formData.get("file")
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Nenhum arquivo recebido." }
  }
  if (file.size > MAX_AVATAR_BYTES) {
    return { error: "Imagem muito grande (máx. 2 MB)." }
  }
  const ext = AVATAR_MIME_EXT[file.type]
  if (!ext) {
    return { error: "Formato não suportado (use PNG, JPG, WEBP ou GIF)." }
  }

  // Sem sessão, `getCurrentUserId` cairia no singleton e o upload iria para a pasta do
  // DONO no storage.
  const auth = await ensureSignedIn()
  if (!auth.ok) return { error: auth.error }

  const supabase = createAdminClient()
  try {
    const userId = auth.userId
    const path = `${userId}/${Date.now()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: upErr } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, buffer, { contentType: file.type, upsert: true })
    if (upErr) return { error: upErr.message }

    const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)
    const url = pub.publicUrl

    const id = await getSingletonId(supabase)
    const { error: updErr } = await supabase
      .from("user_settings")
      .update({ avatar_url: url })
      .eq("id", id)
    if (updErr) return { error: updErr.message }

    revalidatePath("/conta")
    revalidatePath("/") // avatar no Header do dashboard
    return { url }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro ao enviar imagem." }
  }
}

// `setPlan` / `cancelPlan` / `reactivatePlan` foram REMOVIDAS na migration 140.
//
// Elas gravavam `user_settings.user_plan` — coluna que virou LEGADO: o acesso agora sai
// de `role`, e `getCurrentPlan()` o DERIVA. Ou seja, depois da 140 os botões "Cancelar /
// Reativar plano" do /conta viraram no-ops silenciosos: mudavam uma coluna que ninguém
// mais lê. Um botão que finge funcionar é pior que um botão morto.
//
// Não há billing. Enquanto não houver, papel se atribui no banco:
//   update user_settings set role = 'assinante' where email = '...';
// Quando a cobrança existir, o caminho é uma action `setRole` (gate de curador) chamada
// pelo webhook do provedor — não um botão de auto-serviço, que foi exatamente o buraco
// que o PR #115 fechou.

export interface AccountSummary {
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  role: Role
  signedIn: boolean
}

/**
 * Resumo enxuto do perfil pro "chrome" (chip da sidebar). Action client-callable
 * — a query getCurrentUserProfile é server-only. Omite o userId pra reduzir o
 * payload; o email fica porque é o único lugar do chrome que responde "logado em
 * QUAL conta". Falha silenciosa: nunca derruba o layout.
 */
export async function getAccountSummary(): Promise<AccountSummary> {
  // Fora do try: o menu decide entre "Sair" e "Entrar" por este flag, e um erro
  // ao ler o perfil não é motivo pra oferecer login a quem já tem sessão.
  const signedIn = (await getSessionUserId()) !== null

  try {
    const p = await getCurrentUserProfile()
    return { displayName: p.displayName, email: p.email, avatarUrl: p.avatarUrl, role: p.role, signedIn }
  } catch {
    // Fail-closed: erro transitório NÃO promove ninguém.
    return { displayName: null, email: null, avatarUrl: null, role: "leitor", signedIn }
  }
}

/**
 * Grava o saldo Anthropic informado manualmente (snapshot: valor + agora).
 * O restante é derivado depois subtraindo o custo das chamadas desde este
 * instante (ver getAnthropicBalanceStatus). Reinformar zera o desvio.
 */
export async function setAnthropicBalance(amountUsd: number): Promise<{ error?: string }> {
  // Saldo do operador: é a conta Anthropic ÚNICA que banca o app inteiro, não um
  // dado pessoal do usuário. Só o admin informa.
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  if (!Number.isFinite(amountUsd) || amountUsd < 0) {
    return { error: "Informe um valor válido (≥ 0)." }
  }

  const supabase = createAdminClient()
  try {
    const id = await getSingletonId(supabase)
    const { error } = await supabase
      .from("user_settings")
      .update({
        anthropic_balance_usd: amountUsd,
        anthropic_balance_set_at: new Date().toISOString(),
      })
      .eq("id", id)
    if (error) return { error: error.message }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro ao salvar saldo." }
  }

  revalidatePath("/ai-usage")
  return {}
}

/**
 * Status do saldo pro chip da sidebar. Wrapper client-callable da query
 * server-only getAnthropicBalanceStatus. Falha silenciosa: nunca derruba o layout.
 */
export async function getBalanceSummary(): Promise<BalanceStatus> {
  try {
    return await getAnthropicBalanceStatus()
  } catch {
    return { balanceUsd: null, setAt: null, spentSinceUsd: 0, remainingUsd: null, callsSince: 0 }
  }
}

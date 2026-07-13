"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  ensureAdmin,
  getCurrentUserId,
  getCurrentUserProfile,
  getCurrentUserSettingsId,
} from "@/server/queries/current-user"
import { getAnthropicBalanceStatus } from "@/server/queries/ai-usage"
import type { BalanceStatus } from "@/server/queries/ai-usage"
import { accountProfileSchema } from "@/lib/validations/account.schema"
import type { AccountProfileValues } from "@/lib/validations/account.schema"
import type { UserPlan } from "@/lib/plans/capabilities"

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

  const supabase = createAdminClient()
  try {
    const userId = await getCurrentUserId(supabase)
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

/**
 * Troca o plano do usuário. Revalida as rotas gateadas por plano pra refletir o
 * acesso na hora.
 *
 * GATE DE ADMIN, e não de "dono da linha": não existe billing. Sem o gate, esta
 * action é um self-service de upgrade — qualquer usuário logado chama
 * `reactivatePlan()` e vira `paid`, passando a gastar a chave Anthropic do dono
 * (as capabilities pagas só olham `user_plan`). Enquanto não houver cobrança, só
 * o admin troca plano — o dele e, via setPlan, o de quem ele liberar.
 */
export async function setPlan(plan: UserPlan): Promise<{ error?: string }> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { error: gate.error }
  if (plan !== "free" && plan !== "paid") return { error: "Plano inválido." }

  const supabase = createAdminClient()
  try {
    const id = await getSingletonId(supabase)
    const { error } = await supabase
      .from("user_settings")
      .update({ user_plan: plan })
      .eq("id", id)
    if (error) return { error: error.message }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Erro ao atualizar plano." }
  }

  for (const path of ["/conta", "/recommendations", "/ranking", "/titles"]) {
    revalidatePath(path)
  }
  return {}
}

export async function cancelPlan(): Promise<{ error?: string }> {
  return setPlan("free")
}

export async function reactivatePlan(): Promise<{ error?: string }> {
  return setPlan("paid")
}

export interface AccountSummary {
  displayName: string | null
  avatarUrl: string | null
  plan: UserPlan
}

/**
 * Resumo enxuto do perfil pro "chrome" (chip da sidebar). Action client-callable
 * — a query getCurrentUserProfile é server-only. Omite email/userId pra reduzir
 * o payload. Falha silenciosa: nunca derruba o layout.
 */
export async function getAccountSummary(): Promise<AccountSummary> {
  try {
    const p = await getCurrentUserProfile()
    return { displayName: p.displayName, avatarUrl: p.avatarUrl, plan: p.plan }
  } catch {
    return { displayName: null, avatarUrl: null, plan: "free" }
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

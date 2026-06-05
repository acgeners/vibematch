"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserId, getCurrentUserProfile } from "@/server/queries/current-user"
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
 * id da linha singleton de user_settings — a MESMA que as queries leem
 * (primeira por created_at). Todos os updates de conta passam por aqui pra
 * não atualizar uma linha diferente da lida.
 */
async function getSingletonId(supabase: AdminClient): Promise<string> {
  const { data, error } = await supabase
    .from("user_settings")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`Falha lendo user_settings: ${error.message}`)
  if (!data?.id) throw new Error("user_settings sem linha singleton — rode a migration 074.")
  return data.id as string
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
 * Troca o plano do usuário. Sem billing: "cancelar" = free, "reativar" = paid.
 * Revalida as rotas gateadas por plano pra refletir o acesso na hora.
 */
export async function setPlan(plan: UserPlan): Promise<{ error?: string }> {
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

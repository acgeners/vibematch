import "server-only"
import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { planAllows, paidOnlyMessage } from "@/lib/plans/capabilities"
import type { UserPlan, Capability } from "@/lib/plans/capabilities"

type AdminClient = ReturnType<typeof createAdminClient>

// Id do usuário autenticado, lido da sessão Supabase (cookies). Memoizado por
// request (React cache) — várias queries no mesmo request não repetem a chamada.
// Retorna null quando não há sessão: anon, ou contexto sem request (scripts,
// tarefas em background) onde cookies() lança — daí o try/catch.
export const getSessionUserId = cache(async (): Promise<string | null> => {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    if (error) return null
    return data.user?.id ?? null
  } catch {
    return null
  }
})

// Fallback pré-auth: o current_user_id da linha singleton (migration 074). É um
// UUID fixo, então cachear em módulo é seguro (não é por-usuário). Só alcançado
// quando NÃO há sessão — um usuário logado sempre resolve via getSessionUserId.
let cachedSingletonId: string | null = null

async function getSingletonUserId(admin?: AdminClient): Promise<string> {
  if (cachedSingletonId) return cachedSingletonId

  const supabase = admin ?? createAdminClient()
  const { data, error } = await supabase
    .from("user_settings")
    .select("current_user_id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`Falha lendo user_settings: ${error.message}`)
  if (!data?.current_user_id) {
    throw new Error("user_settings sem linha singleton — rode a migration 074.")
  }

  cachedSingletonId = data.current_user_id as string
  return cachedSingletonId
}

// Id do usuário atual. Prefere a sessão de auth; cai no singleton legado enquanto
// a auth não está ligada (dev / transição multi-user). Assinatura preservada —
// nenhum caller muda. É aqui a costura single-user → multi-user.
export async function getCurrentUserId(admin?: AdminClient): Promise<string> {
  const sessionId = await getSessionUserId()
  if (sessionId) return sessionId
  return getSingletonUserId(admin)
}

// Linha de user_settings do usuário ATUAL (select *), memoizada por request.
// - Prefere a linha do usuário (current_user_id = getCurrentUserId()).
// - Logado SEM linha própria → null (usa defaults; NUNCA herda a linha de outro).
// - Anon/sem sessão → cai na singleton legada, então o dono deslogado fica intocado.
const getCurrentUserSettingsRow = cache(async (): Promise<Record<string, unknown> | null> => {
  const supabase = createAdminClient()
  const uid = await getCurrentUserId(supabase)

  const own = await supabase
    .from("user_settings")
    .select("*")
    .eq("current_user_id", uid)
    .limit(1)
    .maybeSingle()
  if (!own.error && own.data) return own.data as Record<string, unknown>

  // Logado mas sem linha própria: não vaza a de ninguém.
  if (await getSessionUserId()) return null

  // Anon/legado: singleton (a mais antiga).
  const fb = await supabase
    .from("user_settings")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()
  return (fb.data as Record<string, unknown> | null) ?? null
})

// id da linha de settings do usuário atual — pros writers (setPlan, toggles,
// perfil) atualizarem a linha certa. null quando não há linha própria/legada.
export async function getCurrentUserSettingsId(): Promise<string | null> {
  const row = await getCurrentUserSettingsRow()
  return (row?.id as string | undefined) ?? null
}

// Plano do usuário atual. Default seguro 'free' quando não há linha/coluna
// (fail-closed: erro transitório ou usuário sem linha NÃO libera features pagas).
export async function getCurrentPlan(_admin?: AdminClient): Promise<UserPlan> {
  const row = await getCurrentUserSettingsRow()
  return (row?.user_plan as UserPlan | undefined) ?? "free"
}

// Toggle "avaliação IA na criação de obras" (migration 097). Default false.
export async function getAiEvalOnCreate(_admin?: AdminClient): Promise<boolean> {
  const row = await getCurrentUserSettingsRow()
  return (row?.ai_eval_on_create as boolean | undefined) ?? false
}

// Toggle "gerar sinopse canônica na criação" (migration 119). Default true.
export async function getSynopsisCanonicalOnCreate(_admin?: AdminClient): Promise<boolean> {
  const row = await getCurrentUserSettingsRow()
  return (row?.synopsis_canonical_on_create as boolean | undefined) ?? true
}

// Toggle "inferir tags por IA na criação" (migration 128). Default true.
export async function getTagInferenceOnCreate(_admin?: AdminClient): Promise<boolean> {
  const row = await getCurrentUserSettingsRow()
  return (row?.tag_inference_on_create as boolean | undefined) ?? true
}

// Toggle "shadow A/B da Previsão de Interesse na criação" (migration 128). Default false.
export async function getInterestShadowOnCreate(_admin?: AdminClient): Promise<boolean> {
  const row = await getCurrentUserSettingsRow()
  return (row?.interest_shadow_on_create as boolean | undefined) ?? false
}

// Toggle "gerar TODOS os dados na criação" (migration 130). Default false (opt-in).
export async function getGenerateAllOnCreate(_admin?: AdminClient): Promise<boolean> {
  const row = await getCurrentUserSettingsRow()
  return (row?.generate_all_on_create as boolean | undefined) ?? false
}

export interface ReviewSynthesisToggles {
  summaryEnabled: boolean
  digestEnabled: boolean
}

// Toggles "gerar Resumo / Digest de reviews" (migration 127). Default true/true.
export async function getReviewSynthesisToggles(
  _admin?: AdminClient,
): Promise<ReviewSynthesisToggles> {
  const row = await getCurrentUserSettingsRow()
  return {
    summaryEnabled: (row?.review_summary_enabled as boolean | undefined) ?? true,
    digestEnabled: (row?.review_digest_enabled as boolean | undefined) ?? true,
  }
}

export interface CurrentUserProfile {
  userId: string
  displayName: string | null
  email: string | null
  avatarUrl: string | null
  plan: UserPlan
}

/**
 * Perfil completo do usuário atual. Lê a linha do usuário (via resolver, com
 * fallback singleton só p/ anon). O userId vem da identidade (sessão/singleton),
 * não da linha, pra ser sempre o id real do usuário atual.
 */
export async function getCurrentUserProfile(admin?: AdminClient): Promise<CurrentUserProfile> {
  const [row, userId] = await Promise.all([getCurrentUserSettingsRow(), getCurrentUserId(admin)])
  return {
    userId,
    displayName: (row?.display_name as string | null | undefined) ?? null,
    email: (row?.email as string | null | undefined) ?? null,
    avatarUrl: (row?.avatar_url as string | null | undefined) ?? null,
    plan: (row?.user_plan as UserPlan | undefined) ?? "free",
  }
}

/**
 * Gate de capability pra server actions. Retorna erro estruturado quando o
 * plano atual não libera a feature — o caller propaga pro client.
 */
export async function ensureCapability(
  cap: Capability,
  admin?: AdminClient,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const plan = await getCurrentPlan(admin)
  return planAllows(plan, cap) ? { ok: true } : { ok: false, error: paidOnlyMessage(cap) }
}

// Admin = o DONO/operador do catálogo. Só o admin muta o catálogo COMPARTILHADO
// (obras/notas/status/etc.); demais usuários são read-only, o que evita corromper
// os dados do dono enquanto a partição per-obra (Fase 2) não existe. Memoizado por request.
//
// A admin-ness vem da FLAG `user_settings.is_admin` (migration 139), lida da linha
// do usuário logado. A conta do dono já foi reivindicada (claim) e loga normalmente,
// então NÃO tratamos mais "deslogado" como admin:
//  - Sem sessão (anônimo/deslogado) → NÃO admin (visitante read-only). Fecha o buraco
//    de produção em que qualquer anônimo seria admin. O dono agora usa o app LOGADO.
//  - Logado com linha própria + coluna is_admin → usa a flag.
//  - Fallback (coluna ausente pré-mig 139, ou logado sem linha própria) → critério
//    legado (=== singleton).
export const isCurrentUserAdmin = cache(async (): Promise<boolean> => {
  const sessionId = await getSessionUserId()
  if (!sessionId) return false // anônimo/deslogado = read-only

  const row = await getCurrentUserSettingsRow()
  if (row && "is_admin" in row && typeof row.is_admin === "boolean") {
    return row.is_admin
  }

  // Fallback pré-mig 139 (coluna ausente) ou logado-sem-linha-própria.
  return sessionId === (await getSingletonUserId())
})

// Gate de admin pra server actions que mutam o catálogo compartilhado.
export async function ensureAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  return (await isCurrentUserAdmin())
    ? { ok: true }
    : { ok: false, error: "Só o administrador do catálogo pode editar por enquanto." }
}

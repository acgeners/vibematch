import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import { planAllows, paidOnlyMessage, type UserPlan, type Capability } from "@/lib/plans/capabilities"

type AdminClient = ReturnType<typeof createAdminClient>

// Single-user: o UUID vive em user_settings (singleton). Cacheado em
// memória porque é imutável durante o processo — evita uma query por
// chamada de pipeline. Quando multi-user chegar, troca a fonte aqui
// (sessão de auth) sem tocar nos callers.
let cachedUserId: string | null = null

export async function getCurrentUserId(admin?: AdminClient): Promise<string> {
  if (cachedUserId) return cachedUserId

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

  cachedUserId = data.current_user_id as string
  return cachedUserId
}

// Plano do usuário atual. NÃO cacheado (pode mudar em runtime via upgrade).
// Tolerante: se a coluna user_plan ainda não existe (migration 078 não aplicada),
// assume 'paid' pra preservar o comportamento atual (tudo aberto) sem quebrar.
export async function getCurrentPlan(admin?: AdminClient): Promise<UserPlan> {
  const supabase = admin ?? createAdminClient()
  const { data, error } = await supabase
    .from("user_settings")
    .select("user_plan")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn(`[getCurrentPlan] fallback 'paid' (user_plan indisponível): ${error.message}`)
    return "paid"
  }
  return (data?.user_plan as UserPlan | undefined) ?? "free"
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

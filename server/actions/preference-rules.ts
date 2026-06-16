"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  MAX_PREFERENCE_RULES,
  MAX_PREFERENCE_RULE_LEN,
  type PreferenceRule,
} from "@/server/queries/preference-rules"

type AdminClient = ReturnType<typeof createAdminClient>

export interface PreferenceRuleInput {
  id?: string
  text: string
  enabled?: boolean
}

export type SavePreferenceRulesResult = { ok: true } | { ok: false; error: string }

/** id da linha singleton de user_settings — a MESMA que as queries leem. */
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

/**
 * Salva o conjunto COMPLETO de regras/preferências livres (batch replace) na
 * coluna jsonb `user_settings.preference_rules`. O estado do cliente é a fonte
 * da verdade.
 *
 * Diferente de `saveTagPreferences` (Item A), NÃO marca recalc-pendente: estas
 * regras alimentam só o consultor LLM (lido ao vivo na chamada), nunca o modelo
 * offline — então não há nota/feature pra recompor.
 */
export async function savePreferenceRules(
  rules: PreferenceRuleInput[],
): Promise<SavePreferenceRulesResult> {
  if (!Array.isArray(rules)) return { ok: false, error: "Payload inválido." }

  const normalized: PreferenceRule[] = []
  for (const r of rules) {
    const text = typeof r?.text === "string" ? r.text.trim() : ""
    if (!text) continue
    normalized.push({
      id: typeof r.id === "string" && r.id ? r.id : randomUUID(),
      text: text.slice(0, MAX_PREFERENCE_RULE_LEN),
      enabled: r.enabled !== false,
    })
    if (normalized.length >= MAX_PREFERENCE_RULES) break
  }

  const supabase = createAdminClient()
  try {
    const id = await getSingletonId(supabase)
    const { error } = await supabase
      .from("user_settings")
      .update({ preference_rules: normalized })
      .eq("id", id)
    if (error) return { ok: false, error: error.message }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Erro ao salvar." }
  }

  revalidatePath("/preferencias")
  return { ok: true }
}

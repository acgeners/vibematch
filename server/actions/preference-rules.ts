"use server"

import { randomUUID } from "node:crypto"
import { revalidatePath } from "next/cache"
import { createUserClient } from "@/lib/supabase/user"
import { ensureSignedIn, getCurrentUserSettingsId } from "@/server/queries/current-user"
import {
  MAX_PREFERENCE_RULES,
  MAX_PREFERENCE_RULE_LEN,
  type PreferenceRule,
} from "@/server/queries/preference-rules"

export interface PreferenceRuleInput {
  id?: string
  text: string
  enabled?: boolean
}

export type SavePreferenceRulesResult = { ok: true } | { ok: false; error: string }

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

  // Escreve na linha do PRÓPRIO usuário. Antes, um `getSingletonId()` local mirava na
  // linha mais antiga de user_settings — a do dono — então qualquer POST anônimo neste
  // endpoint sobrescrevia as regras de recomendação DELE.
  const auth = await ensureSignedIn()
  if (!auth.ok) return { ok: false, error: auth.error }
  const settingsId = await getCurrentUserSettingsId()
  if (!settingsId) return { ok: false, error: "Sua conta ainda não tem preferências." }

  // Cliente do USUÁRIO: a política user_settings_own_update (mig 142) só deixa mexer na linha
  // cuja auth_user_id é a sua — e um trigger impede que `role` ou saldo mudem por aqui.
  const supabase = await createUserClient()
  const { error } = await supabase
    .from("user_settings")
    .update({ preference_rules: normalized })
    .eq("id", settingsId)
  if (error) return { ok: false, error: error.message }

  revalidatePath("/preferencias")
  return { ok: true }
}

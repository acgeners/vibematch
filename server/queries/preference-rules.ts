import "server-only"
import { randomUUID } from "node:crypto"
import { createAdminClient } from "@/lib/supabase/admin"
import { getCurrentUserSettingsId } from "@/server/queries/current-user"

type AdminClient = ReturnType<typeof createAdminClient>

/** Uma regra/preferência livre do usuário (Item B). */
export interface PreferenceRule {
  id: string
  text: string
  enabled: boolean
}

/** Caps de produto — "poucas regras" (controle de bloat/custo no prompt). */
export const MAX_PREFERENCE_RULES = 8
export const MAX_PREFERENCE_RULE_LEN = 200

/** Coage o jsonb cru em regras válidas (defensivo — dado é editado pelo user). */
function coerceRules(raw: unknown): PreferenceRule[] {
  if (!Array.isArray(raw)) return []
  const out: PreferenceRule[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    const text = typeof r.text === "string" ? r.text.trim() : ""
    if (!text) continue
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : randomUUID(),
      text: text.slice(0, MAX_PREFERENCE_RULE_LEN),
      enabled: r.enabled !== false, // default true
    })
    if (out.length >= MAX_PREFERENCE_RULES) break
  }
  return out
}

async function readRaw(admin?: AdminClient): Promise<unknown> {
  const supabase = admin ?? createAdminClient()

  // Linha do PRÓPRIO usuário — não a mais antiga (a do dono). Isto acompanha a escrita:
  // `savePreferenceRules` grava na linha da sessão, então ler o singleton faria o
  // Assinante salvar num lugar e ler de outro (e via as regras do dono). Sem sessão,
  // sem regras.
  const settingsId = await getCurrentUserSettingsId()
  if (!settingsId) return []

  const { data, error } = await supabase
    .from("user_settings")
    .select("preference_rules")
    .eq("id", settingsId)
    .maybeSingle()
  if (error) {
    // Tolerante: a coluna pode não existir até a migration 102 ser aplicada.
    console.warn(`[preference-rules] fallback [] (coluna indisponível): ${error.message}`)
    return []
  }
  return (data as { preference_rules?: unknown } | null)?.preference_rules ?? []
}

/** Linhas completas (id/text/enabled) — pra a UI renderizar/editar. */
export async function getPreferenceRuleRows(admin?: AdminClient): Promise<PreferenceRule[]> {
  return coerceRules(await readRaw(admin))
}

/**
 * Só os textos das regras ATIVAS — o que vai pro prompt do consultor LLM.
 * Pausadas (enabled=false) ficam guardadas mas não entram no prompt.
 */
export async function getPreferenceRules(admin?: AdminClient): Promise<string[]> {
  return coerceRules(await readRaw(admin))
    .filter((r) => r.enabled)
    .map((r) => r.text)
}

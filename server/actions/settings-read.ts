"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getSettingsItemPending } from "@/server/queries/settings-pending"
import {
  BATCH_READ_SECTIONS,
  getPendingSuggestionIds,
  type BatchReadSection,
} from "@/server/queries/settings-read"

/**
 * Ações de "marcar pendências de /settings como lidas". "Lida" silencia a
 * pendência (sai do badge) SEM resolvê-la. Ver migration 134 e
 * `server/queries/settings-read.ts`.
 *
 * Não há `revalidateTag`/`revalidatePath` aqui: o `router.refresh()` do cliente
 * (via `useRefresh`) re-renderiza os Server Components de /settings (pílulas dos
 * cards + badge do tópico) e o badge da sidebar re-busca no refresh do chrome.
 * As leituras de ack não são cacheadas, então o refresh já reconcilia.
 */

function isBatchSection(section: string): section is BatchReadSection {
  return (BATCH_READ_SECTIONS as readonly string[]).includes(section)
}

/**
 * Marca UM card agregado como lido: grava um snapshot da contagem atual daquela
 * seção. Unread passa a `max(0, atual - snapshot)` → 0 agora; re-notifica quando
 * a contagem subir acima do snapshot.
 */
export async function markSettingsSectionRead(
  section: string,
): Promise<{ ok: boolean; ackedCount: number }> {
  if (!isBatchSection(section)) {
    throw new Error(`Seção inválida para marcar como lida: ${section}`)
  }
  const pending = await getSettingsItemPending()
  const ackedCount = pending[section] ?? 0
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("settings_read_acks")
    .upsert({ section, acked_count: ackedCount }, { onConflict: "section" })
  if (error) throw new Error(`Falha marcando "${section}" como lida: ${error.message}`)
  return { ok: true, ackedCount }
}

/** Desmarca UM card agregado (remove o snapshot) — volta a contar tudo. */
export async function unmarkSettingsSectionRead(section: string): Promise<{ ok: boolean }> {
  if (!isBatchSection(section)) {
    throw new Error(`Seção inválida para desmarcar: ${section}`)
  }
  const supabase = createAdminClient()
  const { error } = await supabase.from("settings_read_acks").delete().eq("section", section)
  if (error) throw new Error(`Falha desmarcando "${section}": ${error.message}`)
  return { ok: true }
}

/** Marca UMA sugestão da auditoria como lida (selo "Lida" do card). Idempotente. */
export async function markSuggestionRead(suggestionId: string): Promise<{ ok: boolean }> {
  if (!suggestionId) throw new Error("Sugestão inválida ao marcar como lida.")
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("settings_suggestion_read_acks")
    .upsert({ suggestion_id: suggestionId }, { onConflict: "suggestion_id", ignoreDuplicates: true })
  if (error) throw new Error(`Falha marcando sugestão como lida: ${error.message}`)
  return { ok: true }
}

/** Desmarca UMA sugestão da auditoria — volta a contar. */
export async function unmarkSuggestionRead(suggestionId: string): Promise<{ ok: boolean }> {
  if (!suggestionId) throw new Error("Sugestão inválida ao desmarcar.")
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("settings_suggestion_read_acks")
    .delete()
    .eq("suggestion_id", suggestionId)
  if (error) throw new Error(`Falha desmarcando sugestão: ${error.message}`)
  return { ok: true }
}

/**
 * Marca TUDO como lido (ação global): snapshot de todas as seções batch +
 * ack de todas as sugestões pendentes da auditoria. Idempotente.
 */
export async function markAllSettingsRead(): Promise<{ ok: boolean; marked: number }> {
  const [pending, suggestionIds] = await Promise.all([
    getSettingsItemPending(),
    getPendingSuggestionIds(),
  ])
  const supabase = createAdminClient()

  // (A) Snapshots das seções batch.
  const batchRows = BATCH_READ_SECTIONS.map((section) => ({
    section,
    acked_count: pending[section] ?? 0,
  }))
  const { error: batchErr } = await supabase
    .from("settings_read_acks")
    .upsert(batchRows, { onConflict: "section" })
  if (batchErr) throw new Error(`Falha marcando seções como lidas: ${batchErr.message}`)

  // (B) Acks das sugestões pendentes, em chunks de 500 (limite de payload).
  for (let i = 0; i < suggestionIds.length; i += 500) {
    const chunk = suggestionIds.slice(i, i + 500).map((id) => ({ suggestion_id: id }))
    const { error } = await supabase
      .from("settings_suggestion_read_acks")
      .upsert(chunk, { onConflict: "suggestion_id", ignoreDuplicates: true })
    if (error) throw new Error(`Falha marcando sugestões como lidas: ${error.message}`)
  }

  return { ok: true, marked: batchRows.length + suggestionIds.length }
}

/** Desmarca TUDO (limpa os dois modelos de ack). Volta a contar todas as pendências. */
export async function unmarkAllSettingsRead(): Promise<{ ok: boolean }> {
  const supabase = createAdminClient()
  // DELETE sem WHERE não é aceito pelo PostgREST; filtro sempre-verdadeiro.
  const [batch, suggestions] = await Promise.all([
    supabase.from("settings_read_acks").delete().not("section", "is", null),
    supabase.from("settings_suggestion_read_acks").delete().not("suggestion_id", "is", null),
  ])
  if (batch.error) throw new Error(`Falha desmarcando seções: ${batch.error.message}`)
  if (suggestions.error) throw new Error(`Falha desmarcando sugestões: ${suggestions.error.message}`)
  return { ok: true }
}

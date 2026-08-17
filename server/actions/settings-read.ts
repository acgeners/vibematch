"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { getSettingsItemPending } from "@/server/queries/settings-pending"
import {
  BATCH_READ_SECTIONS,
  type BatchReadSection,
} from "@/server/queries/settings-read"

/**
 * Ações de "marcar pendências de /curation/settings como lidas". "Lida" silencia a
 * pendência (sai do badge) SEM resolvê-la. Ver migration 134 e
 * `server/queries/settings-read.ts`.
 *
 * Não há `revalidateTag`/`revalidatePath` aqui: o `router.refresh()` do cliente
 * (via `useRefresh`) re-renderiza os Server Components de /curation/settings (pílulas dos
 * cards + badge do tópico) e o badge da sidebar re-busca no refresh do chrome.
 * As leituras de ack não são cacheadas, então o refresh já reconcilia.
 */

function isBatchSection(section: string): section is BatchReadSection {
  return (BATCH_READ_SECTIONS as readonly string[]).includes(section)
}

/**
 * Marca UM card agregado como lido: grava um snapshot da contagem atual daquela
 * seção. Unread passa a `max(0, atual - snapshot)` → 0 agora. Re-notifica quando
 * a contagem sobe acima do snapshot OU quando as pendências marcadas são
 * resolvidas e novas aparecem — o snapshot é um PISO que DESCE junto com a
 * pendência (`lowerSettingsReadAcks`), não uma marca d'água permanente.
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
 * Marca TUDO como lido (ação global): snapshot de todas as seções batch. Idempotente.
 *
 * O 2º modelo de ack — 1 linha por sugestão da auditoria — saiu em 2026-08-16 com a
 * aposentadoria dela. A tabela `settings_suggestion_read_acks` fica no banco com as 583
 * linhas de histórico; nada mais escreve nela.
 */
export async function markAllSettingsRead(): Promise<{ ok: boolean; marked: number }> {
  const pending = await getSettingsItemPending()
  const supabase = createAdminClient()

  // Snapshots das seções batch.
  const batchRows = BATCH_READ_SECTIONS.map((section) => ({
    section,
    acked_count: pending[section] ?? 0,
  }))
  const { error: batchErr } = await supabase
    .from("settings_read_acks")
    .upsert(batchRows, { onConflict: "section" })
  if (batchErr) throw new Error(`Falha marcando seções como lidas: ${batchErr.message}`)


  return { ok: true, marked: batchRows.length }
}

/** Desmarca TUDO (limpa os dois modelos de ack). Volta a contar todas as pendências. */
export async function unmarkAllSettingsRead(): Promise<{ ok: boolean }> {
  const supabase = createAdminClient()
  // DELETE sem WHERE não é aceito pelo PostgREST; filtro sempre-verdadeiro.
  const [batch] = await Promise.all([
    supabase.from("settings_read_acks").delete().not("section", "is", null),
  ])
  if (batch.error) throw new Error(`Falha desmarcando seções: ${batch.error.message}`)
  return { ok: true }
}

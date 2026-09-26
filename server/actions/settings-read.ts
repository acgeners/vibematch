"use server"

import { createAdminClient } from "@/lib/supabase/admin"
import { ensurePermission } from "@/server/queries/current-user"
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
 *
 * 🔴 TODA export daqui MUTA e usa `createAdminClient()` (service role, que ignora RLS),
 * sobre tabelas GLOBAIS (`settings_read_acks` é chaveada por `section`, sem `user_id`).
 * Até 2026-09-25 nenhuma tinha gate próprio: quem as protegia era o middleware barrar
 * `/curation`. Gate de ROTA não protege AÇÃO — módulo `"use server"` é superfície HTTP
 * pública, e um POST direto silenciava (ou ressuscitava) os badges de pendência do
 * curador. Daí `exigirConfigGlobal()` no topo de cada uma.
 *
 * ⚠️ O verbo é `global_config` e não `ensureAdmin()`: é o que estas ações de fato fazem
 * (configuração global), e `ensurePermission` é o preferido em call site novo — ele diz
 * o que está protegido, não só quem passa. Hoje os dois coincidem em "curador".
 */

/**
 * Gate das ações deste módulo. LANÇA, para casar com o contrato do arquivo (todas as
 * exports aqui lançam em falha; devolver `{ok:false}` faria só esta divergir).
 */
async function exigirConfigGlobal(): Promise<void> {
  const gate = await ensurePermission("global_config")
  if (!gate.ok) throw new Error(gate.error)
}

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
  await exigirConfigGlobal()
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
  await exigirConfigGlobal()
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
  await exigirConfigGlobal()
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
  await exigirConfigGlobal()
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
  await exigirConfigGlobal()
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
  await exigirConfigGlobal()
  const supabase = createAdminClient()
  // DELETE sem WHERE não é aceito pelo PostgREST; filtro sempre-verdadeiro.
  const [batch] = await Promise.all([
    supabase.from("settings_read_acks").delete().not("section", "is", null),
  ])
  if (batch.error) throw new Error(`Falha desmarcando seções: ${batch.error.message}`)
  return { ok: true }
}

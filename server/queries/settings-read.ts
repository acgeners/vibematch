import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { countPendingSuggestions } from "@/server/queries/calibration"
import { getSettingsItemPending } from "@/server/queries/settings-pending"

/**
 * "Marcar pendências de /settings como lidas" — leitura dos acks e cálculo do
 * NÃO-LIDO por seção. Ver migration 134 e `server/actions/settings-read.ts`.
 *
 * Dois modelos convivem (o mesmo split que a migration documenta):
 *   - Seções BATCH (`BATCH_READ_SECTIONS`): a pendência é uma contagem; o ack é
 *     um snapshot dessa contagem (`settings_read_acks`). Unread = `max(0,
 *     atual - snapshot)`.
 *   - Seção `ai-audit`: a pendência é por sugestão; o ack é 1 linha por sugestão
 *     (`settings_suggestion_read_acks`). Unread = pendentes sem ack.
 *
 * Toda leitura tolera a tabela/RPC ausente (migration não aplicada): degrada pra
 * "nada lido" (unread == pendente), nunca derruba o layout.
 */

/** Seções cuja pendência é uma CONTAGEM agregada (ack = snapshot da contagem). */
export const BATCH_READ_SECTIONS = [
  "embeddings",
  "synopsis-canonical",
  "review-synthesis",
  "comix",
] as const
export type BatchReadSection = (typeof BATCH_READ_SECTIONS)[number]

/** Snapshots das seções batch: `section -> acked_count`. Tolera tabela ausente. */
export async function getSettingsReadAcks(): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const supabase = createAdminClient()
  const { data, error } = await supabase.from("settings_read_acks").select("section, acked_count")
  if (error) {
    console.warn(
      "[getSettingsReadAcks] leitura falhou (migration 134 aplicada?):",
      error.message,
    )
    return map
  }
  for (const row of data ?? []) {
    const r = row as { section: string; acked_count: number }
    map.set(r.section, Number(r.acked_count) || 0)
  }
  return map
}

/** IDs das sugestões da auditoria marcadas como lidas. Tolera tabela ausente. */
export async function getSuggestionReadAckIds(): Promise<string[]> {
  const supabase = createAdminClient()
  try {
    const rows = await fetchAllRows<{ suggestion_id: string }>(
      (from, to) =>
        supabase.from("settings_suggestion_read_acks").select("suggestion_id").range(from, to),
      "getSuggestionReadAckIds",
    )
    return rows.map((r) => r.suggestion_id)
  } catch (err) {
    console.warn(
      "[getSuggestionReadAckIds] leitura falhou (migration 134 aplicada?):",
      err instanceof Error ? err.message : err,
    )
    return []
  }
}

/** Sugestões PENDENTES ainda não lidas (unread do card 'ai-audit'), via RPC. */
export async function countUnreadPendingSuggestions(): Promise<number> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("count_unread_pending_suggestions")
  if (error) {
    // RPC/migration ausente: cai pro total de pendentes (tudo conta como não-lido).
    console.warn(
      "[countUnreadPendingSuggestions] RPC falhou (migration 134 aplicada?):",
      error.message,
    )
    return countPendingSuggestions().catch(() => 0)
  }
  return Number(data) || 0
}

/**
 * IDs de todas as sugestões PENDENTES da auditoria (sem filtro). Usado por
 * "marcar tudo como lido" pra ackar a fila inteira. Bounded pelo nº de pendentes.
 */
export async function getPendingSuggestionIds(): Promise<string[]> {
  const supabase = createAdminClient()
  const rows = await fetchAllRows<{ id: string }>(
    (from, to) =>
      supabase
        .from("score_calibration_suggestions")
        .select("id")
        .eq("status", "pending")
        .range(from, to),
    "getPendingSuggestionIds",
  )
  return rows.map((r) => r.id)
}

/**
 * NÃO-LIDO por item (`Record<sectionId, count>`), com os MESMOS sectionIds que
 * `getSettingsItemPending`. É o que alimenta o badge da sidebar, o badge do
 * tópico (sub-nav) e a pílula do card — os três batem. O CORPO de cada card
 * segue mostrando a contagem REAL (via `getSettingsItemPending`/painéis); só o
 * badge é silenciado.
 */
export const getSettingsItemUnread = cache(
  async (): Promise<Record<string, number>> => {
    const [pending, batchAcks, unreadSuggestions] = await Promise.all([
      getSettingsItemPending(),
      getSettingsReadAcks(),
      countUnreadPendingSuggestions(),
    ])
    const unread: Record<string, number> = {}
    for (const section of BATCH_READ_SECTIONS) {
      unread[section] = Math.max(0, (pending[section] ?? 0) - (batchAcks.get(section) ?? 0))
    }
    unread["ai-audit"] = unreadSuggestions
    return unread
  },
)

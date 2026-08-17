import { cache } from "react"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getSettingsItemPending } from "@/server/queries/settings-pending"

/**
 * "Marcar pendências de /curation/settings como lidas" — leitura dos acks e cálculo do
 * NÃO-LIDO por seção. Ver migration 134 e `server/actions/settings-read.ts`.
 *
 * Dois modelos convivem (o mesmo split que a migration documenta):
 *   - Seções BATCH (`BATCH_READ_SECTIONS`): a pendência é uma contagem; o ack é
 *     um snapshot dessa contagem (`settings_read_acks`). Unread = `max(0,
 *     atual - snapshot)`. O snapshot é um PISO que acompanha a pendência pra
 *     BAIXO: quando pendências são resolvidas (a contagem cai abaixo do
 *     snapshot), o piso desce junto (`lowerSettingsReadAcks`, via `after()`) —
 *     senão o snapshot vira marca d'água permanente e "fica lido pra sempre",
 *     silenciando pendências novas que apareçam abaixo dele.
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

/**
 * DECAIMENTO do snapshot de leitura das seções batch. `acked_count` é o PISO de
 * pendências "já vistas"; quando a pendência REAL cai abaixo dele (pendências
 * resolvidas), o piso tem que descer junto — senão ele vira uma marca d'água
 * permanente e novas pendências abaixo dela nunca voltam a contar ("fica lido
 * pra sempre"). Aqui baixamos o snapshot pra acompanhar a contagem atual; se
 * zerou, apagamos a linha (some o selo "Lida" do card já vazio).
 *
 * Só BAIXA, nunca sobe: o `.gt("acked_count", …)` torna a operação idempotente e
 * segura contra um "marcar como lido" concorrente que acabou de gravar um piso
 * maior. Best-effort (roda em segundo plano via `after()`): erro não propaga.
 */
export async function lowerSettingsReadAcks(
  lowered: Array<{ section: string; count: number }>,
): Promise<void> {
  if (lowered.length === 0) return
  const supabase = createAdminClient()
  await Promise.all(
    lowered.map(({ section, count }) =>
      count <= 0
        ? supabase.from("settings_read_acks").delete().eq("section", section).gt("acked_count", 0)
        : supabase
            .from("settings_read_acks")
            .update({ acked_count: count })
            .eq("section", section)
            .gt("acked_count", count),
    ),
  )
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
    const [pending, batchAcks] = await Promise.all([
      getSettingsItemPending(),
      getSettingsReadAcks(),
    ])
    const unread: Record<string, number> = {}
    // Seções cujo piso ficou ACIMA da pendência atual (pendências resolvidas):
    // precisam decair pra não silenciar pendências novas pra sempre.
    const decayed: Array<{ section: string; count: number }> = []
    for (const section of BATCH_READ_SECTIONS) {
      const p = pending[section] ?? 0
      const acked = batchAcks.get(section)
      if (acked !== undefined && p < acked) decayed.push({ section, count: p })
      unread[section] = Math.max(0, p - (acked ?? 0))
    }
    if (decayed.length > 0) {
      // Persistência em segundo plano (não bloqueia o render). Fora de um escopo
      // de request `after()` lança — aí só pulamos: o unread desta leitura já
      // está correto; o piso desce na próxima leitura em request.
      try {
        after(() => lowerSettingsReadAcks(decayed))
      } catch {
        /* sem request scope: sem persistência agora */
      }
    }
    return unread
  },
)

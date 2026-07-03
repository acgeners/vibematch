import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { getAlignmentQueueWorks, getSynopsisQueueWorks, getUntrackedWorks } from "@/server/queries/recommendations"
import { getWorksWithoutReviews } from "@/server/queries/works-without-reviews"
import { getWorksWithoutTags } from "@/server/queries/works-without-tags"

/**
 * Filas de /ai-evaluation onde uma pendência pode ser marcada como "lida"
 * (silenciada sem ser resolvida). Uma obra é "lida" numa fila se existe uma
 * linha em `ai_eval_read_acks` para (work_id, queue). Ver migration 125.
 */
export const READ_QUEUES = ["attr", "veredito", "interesse", "tags_reviews", "untracked"] as const
export type ReadQueue = (typeof READ_QUEUES)[number]

/**
 * IDs das obras marcadas como lidas, agrupados por fila. Lê a tabela inteira
 * (`ai_eval_read_acks` tem no máximo ~1 linha por obra por fila — barato pro
 * catálogo atual). Retorna um Map fila -> Set<workId> pra lookups O(1).
 */
export async function getReadAckSets(): Promise<Map<ReadQueue, Set<string>>> {
  const map = new Map<ReadQueue, Set<string>>()
  for (const q of READ_QUEUES) map.set(q, new Set())
  const supabase = createAdminClient()
  try {
    const rows = await fetchAllRows<{ work_id: string; queue: string }>(
      (from, to) => supabase.from("ai_eval_read_acks").select("work_id, queue").range(from, to),
      "getReadAckSets",
    )
    for (const r of rows) {
      const set = map.get(r.queue as ReadQueue)
      if (set) set.add(r.work_id)
    }
  } catch (err) {
    // Tolera a tabela ausente (migration 125 ainda não aplicada): nada lido.
    console.warn("[getReadAckSets] leitura de acks falhou (migration 125 aplicada?):", err instanceof Error ? err.message : err)
  }
  return map
}

/**
 * IDs de TODOS os membros de cada fila (com os estados "acionáveis" de cada uma),
 * sem filtros de UI. Usado por "marcar tudo como lido" — acka o queue inteiro,
 * não só o subconjunto que o usuário está filtrando. Roda as 6 leituras em
 * paralelo (countOnly onde existe pra sair barato).
 */
export async function getAllQueueMemberIds(): Promise<Record<ReadQueue, string[]>> {
  const [attr, veredito, interesse, noReviews, noTags, untracked] = await Promise.all([
    getAttributesMemberIds(),
    getAlignmentQueueWorks({ states: ["stale", "unranked"], countOnly: true }),
    getSynopsisQueueWorks({ states: ["unpredicted", "stale"], countOnly: true }),
    getWorksWithoutReviews({}, { countOnly: true }),
    getWorksWithoutTags({}, { countOnly: true }),
    getUntrackedWorks({}),
  ])
  const tagsReviews = new Set<string>([...(noReviews.ids ?? []), ...(noTags.ids ?? [])])
  return {
    attr,
    veredito: veredito.map((w) => w.id),
    interesse: interesse.map((w) => w.id),
    tags_reviews: [...tagsReviews],
    untracked: untracked.map((w) => w.id),
  }
}

/**
 * Estado global do botão "Marcar tudo como lido" (defaults das 5 filas, sem
 * filtros de UI): `allRead` = existe algo lido E não sobra nenhuma não-lida
 * (⇒ o botão vira "Desmarcar tudo"); caso contrário oferece marcar.
 */
export async function getEvalReadSummary(): Promise<{ allRead: boolean; hasAnyRead: boolean; totalUnread: number }> {
  const [members, acks] = await Promise.all([getAllQueueMemberIds(), getReadAckSets()])
  let totalUnread = 0
  for (const q of READ_QUEUES) {
    const ack = acks.get(q)!
    totalUnread += members[q].filter((id) => !ack.has(id)).length
  }
  const hasAnyRead = [...acks.values()].some((s) => s.size > 0)
  return { allRead: hasAnyRead && totalUnread === 0, hasAnyRead, totalUnread }
}

/** Membros (ids) da fila de atributos: pending + review_pending, não-arquivadas. */
async function getAttributesMemberIds(): Promise<string[]> {
  const supabase = createAdminClient()
  const rows = await fetchAllRows<{ id: string }>(
    (from, to) =>
      supabase
        .from("works")
        .select("id")
        .in("ai_eval_status", ["pending", "review_pending"])
        .eq("is_archived", false)
        .range(from, to),
    "getAttributesMemberIds",
  )
  return rows.map((r) => r.id)
}

/**
 * Contagem do badge "Avaliação IA" da barra lateral = união DISTINTA das obras
 * NÃO-LIDAS nas 3 primeiras abas (atributos + Veredito IA "stale" + Interesse
 * "não previsto"), com os defaults das próprias abas. Subtrai os acks por fila
 * e conta ids distintos (uma obra em 2 filas não conta 2×). Some (retorna 0)
 * quando tudo está lido/resolvido — a sidebar oculta o badge no zero.
 *
 * Fresco a cada chamada (sem `unstable_cache`): 3 leituras de ids em paralelo +
 * a tabela de acks; barato com o DB em São Paulo (~30ms/round-trip).
 */
export async function getEvalBadgeUnreadCount(): Promise<number> {
  const [attrIds, veredito, interesse, ackSets] = await Promise.all([
    getAttributesMemberIds(),
    getAlignmentQueueWorks({ states: ["stale"], countOnly: true }),
    getSynopsisQueueWorks({ states: ["unpredicted"], countOnly: true }),
    getReadAckSets(),
  ])
  const ackAttr = ackSets.get("attr")!
  const ackVer = ackSets.get("veredito")!
  const ackInt = ackSets.get("interesse")!

  const unread = new Set<string>()
  for (const id of attrIds) if (!ackAttr.has(id)) unread.add(id)
  for (const w of veredito) if (!ackVer.has(w.id)) unread.add(w.id)
  for (const w of interesse) if (!ackInt.has(w.id)) unread.add(w.id)
  return unread.size
}

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
 * IDs de TODOS os membros de cada fila pedida (com os estados "acionáveis" de
 * cada uma), sem filtros de UI. Usado por "marcar tudo como lido" — acka o
 * queue inteiro, não só o subconjunto que o usuário está filtrando. `queues`
 * decide QUAIS das 5 leituras rodam (cada página só pede as suas — /ai-evaluation
 * e /fila-recomendacao dividem o antigo conjunto de 5); default é todas, pra
 * chamadas que ainda não precisam escolher.
 */
export async function getAllQueueMemberIds(
  queues: readonly ReadQueue[] = READ_QUEUES,
): Promise<Record<ReadQueue, string[]>> {
  const want = (q: ReadQueue) => queues.includes(q)
  const [attr, veredito, interesse, noReviews, noTags, untracked] = await Promise.all([
    want("attr") ? getAttributesMemberIds() : Promise.resolve([]),
    want("veredito")
      ? getAlignmentQueueWorks({ states: ["stale", "unranked"], countOnly: true })
      : Promise.resolve([]),
    want("interesse")
      ? getSynopsisQueueWorks({ states: ["unpredicted", "stale"], countOnly: true })
      : Promise.resolve([]),
    want("tags_reviews") ? getWorksWithoutReviews({}, { countOnly: true }) : Promise.resolve({ ids: [] as string[] }),
    want("tags_reviews") ? getWorksWithoutTags({}, { countOnly: true }) : Promise.resolve({ ids: [] as string[] }),
    want("untracked") ? getUntrackedWorks({}) : Promise.resolve([]),
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
 * Estado do botão "Marcar tudo como lido" pras filas pedidas (sem filtros de
 * UI): `allRead` = existe algo lido E não sobra nenhuma não-lida nessas filas
 * (⇒ o botão vira "Desmarcar tudo"); caso contrário oferece marcar. Cada
 * página passa só o subconjunto de `READ_QUEUES` que ela mostra.
 */
export async function getEvalReadSummary(
  queues: readonly ReadQueue[] = READ_QUEUES,
): Promise<{ allRead: boolean; hasAnyRead: boolean; totalUnread: number }> {
  const [members, acks] = await Promise.all([getAllQueueMemberIds(queues), getReadAckSets()])
  let totalUnread = 0
  for (const q of queues) {
    const ack = acks.get(q)!
    totalUnread += members[q].filter((id) => !ack.has(id)).length
  }
  const hasAnyRead = queues.some((q) => (acks.get(q)?.size ?? 0) > 0)
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
 * Contagem do badge "Curadoria da Obra" da barra lateral = obras NÃO-LIDAS na
 * fila de atributos (avaliação IA pendente/aguardando revisão). Sucessora da
 * antiga `getEvalBadgeUnreadCount`, que unia attr+veredito+interesse — dividida
 * quando as 3 primeiras abas de /ai-evaluation viraram duas páginas (Curadoria
 * da Obra × Fila de Recomendação). Fresco a cada chamada (sem `unstable_cache`).
 */
export async function getCuradoriaBadgeUnreadCount(): Promise<number> {
  const [attrIds, ackSets] = await Promise.all([getAttributesMemberIds(), getReadAckSets()])
  const ackAttr = ackSets.get("attr")!
  return attrIds.filter((id) => !ackAttr.has(id)).length
}

/**
 * Contagem do badge "Fila de Recomendação" da barra lateral = união DISTINTA
 * das obras NÃO-LIDAS em Veredito IA "stale" + Interesse "não previsto".
 * Metade que sobrou da antiga `getEvalBadgeUnreadCount` depois da divisão em
 * duas páginas (ver `getCuradoriaBadgeUnreadCount`). "Untracked" não entra —
 * nunca entrou no badge original, mesmo hoje morando na mesma página.
 */
export async function getRecommendationBadgeUnreadCount(): Promise<number> {
  const [veredito, interesse, ackSets] = await Promise.all([
    getAlignmentQueueWorks({ states: ["stale"], countOnly: true }),
    getSynopsisQueueWorks({ states: ["unpredicted"], countOnly: true }),
    getReadAckSets(),
  ])
  const ackVer = ackSets.get("veredito")!
  const ackInt = ackSets.get("interesse")!

  const unread = new Set<string>()
  for (const w of veredito) if (!ackVer.has(w.id)) unread.add(w.id)
  for (const w of interesse) if (!ackInt.has(w.id)) unread.add(w.id)
  return unread.size
}

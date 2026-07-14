import { createAdminClient } from "@/lib/supabase/admin"
import { getPersonalStatusIdByName } from "@/lib/constants/status-lookups"
import { pickPrimaryCover } from "@/lib/covers"
import { getPersonalStateReader, resolvePersonalFilterIds } from "@/server/queries/user-work-state"
import { getScoresReader } from "@/server/queries/user-scores"

type CoverRow = { url: string; is_primary: boolean; position: number }
type ExternalIdRow = { source: string; external_id: string | null; is_rejected: boolean }

export interface ReadingWork {
  id: string
  title: string
  coverUrl: string | null
  personalStatusId: number | null
  publicationStatusId: number | null
  chaptersRead: number | null
  totalChapters: number | null
  lastReadAt: string | null
  expectedScore: number | null
  /** hid do comix (match exato na checagem de capítulos); `null` se não confirmado. */
  comixHid: string | null
  /** Data (aprox.) do último capítulo, cacheada na última checagem. `null` até a migration 087. */
  lastChapterReleasedAt: string | null
  /** Próxima data prevista, cacheada na última checagem. `null` até a migration 087. */
  nextChapterPredictedAt: string | null
  /** Quando esta obra foi verificada pela última vez. `null` até a migration 087 / nunca verificada. */
  chaptersCheckedAt: string | null
}

// Colunas da migration 087. Mantidas num select separado pra degradar fail-soft
// quando a migration ainda não foi aplicada (não quebra a página).
const DATE_COLUMNS = "last_chapter_released_at, next_chapter_predicted_at, chapters_checked_at"

function isMissingColumnError(message: string): boolean {
  return /does not exist|42703|could not find/i.test(message)
}

/**
 * Obras com status pessoal "Reading" (opcionalmente "Started"), ordenadas pela
 * leitura mais recente. Alimenta a página /leitura e a checagem de capítulos.
 * Traz o hid do comix de `work_external_ids` pra checagem exata por ID.
 */
export async function getReadingWorks(
  opts?: { statuses?: string[] },
): Promise<ReadingWork[]> {
  const statusIds = (opts?.statuses ?? ["Reading"])
    .map((s) => getPersonalStatusIdByName(s))
    .filter((id): id is number => id != null)
  if (statusIds.length === 0) return []

  const supabase = createAdminClient()

  // ⚠️ Aqui o filtro É o estado pessoal — "o que EU estou lendo". Ele sai de
  // `user_work_state`, pra TODO MUNDO (Fase D): filtrar por `works.personal_status_id` devolvia
  // a lista de leitura DO DONO, com os capítulos DELE, na página de quem quer que abrisse.
  //
  // Aqui, ao contrário do /ranking, o filtro por id é EXATO: "estou lendo" é sempre uma linha
  // explícita de estado. Obra sem linha não é "lendo" — é justamente o que não aparece nesta
  // página. `[]` = não estou lendo nada → página vazia (e NÃO o catálogo inteiro).
  const personal = await getPersonalStateReader()
  // Fatia 2b: a Nota Prevista é de QUEM OLHA. Sem esta troca, ela vinha de `calculated_scores`
  // — a linha do DONO — e a Leitora via a previsão do gosto dele como se fosse a dela.
  const scoresReader = await getScoresReader()
  const ownIds = await resolvePersonalFilterIds({ personalStatusIds: statusIds })
  if (!ownIds || ownIds.length === 0) return []

  const baseSelect = `
    id, title, publication_status_id, total_chapters,
    calculated_scores(expected_score),
    work_covers(url, is_primary, position),
    work_external_ids(source, external_id, is_rejected)`

  const runQuery = (select: string) =>
    supabase.from("works").select(select).eq("is_archived", false).in("id", ownIds)

  // Tenta com as colunas de data (migration 087); cai pro select-base se ainda
  // não existirem, sem quebrar a página.
  let { data, error } = await runQuery(`${baseSelect}, ${DATE_COLUMNS}`)
  if (error && isMissingColumnError(error.message)) {
    ({ data, error } = await runQuery(baseSelect))
  }
  if (error) throw new Error(error.message)

  const works = ((data ?? []) as unknown as Array<{
    id: string
    title: string
    publication_status_id: number | null
    total_chapters: number | null
    last_chapter_released_at?: string | null
    next_chapter_predicted_at?: string | null
    chapters_checked_at?: string | null
    calculated_scores?: { expected_score?: number | null } | null
    work_covers?: CoverRow[] | null
    work_external_ids?: ExternalIdRow[] | null
  }>).map((w) => {
    const comix = (w.work_external_ids ?? []).find(
      (e) => e.source === "comix" && !e.is_rejected && e.external_id,
    )
    const state = personal.get(w.id)
    return {
      id: w.id,
      title: w.title,
      coverUrl: pickPrimaryCover(w.work_covers),
      personalStatusId: state.personalStatusId,
      publicationStatusId: w.publication_status_id ?? null,
      chaptersRead: state.chaptersRead,
      totalChapters: w.total_chapters ?? null,
      lastReadAt: state.lastReadAt,
      expectedScore: scoresReader.overlay(w.id, w.calculated_scores)?.expected_score ?? null,
      comixHid: comix?.external_id ?? null,
      lastChapterReleasedAt: w.last_chapter_released_at ?? null,
      nextChapterPredictedAt: w.next_chapter_predicted_at ?? null,
      chaptersCheckedAt: w.chapters_checked_at ?? null,
    }
  })

  // A ordenação por "última leitura" é EM MEMÓRIA — pra todo mundo, o dono inclusive.
  //
  // Antes ela era um `.order("last_read_at")` no SQL, ou seja, ordenava pela data que estava em
  // `works`: a DELE. Isso já estava errado pra Leitora (a lista dela saía na ordem de leitura
  // do dono) e era corrigido por um re-sort só pra ela. Agora a data vem do espelho de quem
  // olha, e o SQL não tem mais essa coluna pra ordenar — o re-sort passa a ser o único caminho,
  // e vale pros dois. Nulos por último (era `nullsFirst: false`).
  works.sort((a, b) => {
    if (a.lastReadAt === b.lastReadAt) return 0
    if (a.lastReadAt == null) return 1
    if (b.lastReadAt == null) return -1
    return b.lastReadAt.localeCompare(a.lastReadAt)
  })

  return works
}

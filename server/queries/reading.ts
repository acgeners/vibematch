import { createAdminClient } from "@/lib/supabase/admin"
import { getPersonalStatusIdByName } from "@/lib/constants/status-lookups"
import { pickPrimaryCover } from "@/lib/covers"

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

  const baseSelect = `
    id, title, personal_status_id, publication_status_id, total_chapters, chapters_read, last_read_at,
    calculated_scores(expected_score),
    work_covers(url, is_primary, position),
    work_external_ids(source, external_id, is_rejected)`

  const runQuery = (select: string) =>
    supabase
      .from("works")
      .select(select)
      .eq("is_archived", false)
      .in("personal_status_id", statusIds)
      .order("last_read_at", { ascending: false, nullsFirst: false })

  // Tenta com as colunas de data (migration 087); cai pro select-base se ainda
  // não existirem, sem quebrar a página.
  let { data, error } = await runQuery(`${baseSelect}, ${DATE_COLUMNS}`)
  if (error && isMissingColumnError(error.message)) {
    ({ data, error } = await runQuery(baseSelect))
  }
  if (error) throw new Error(error.message)

  return ((data ?? []) as unknown as Array<{
    id: string
    title: string
    personal_status_id: number | null
    publication_status_id: number | null
    total_chapters: number | null
    chapters_read: number | null
    last_read_at: string | null
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
    return {
      id: w.id,
      title: w.title,
      coverUrl: pickPrimaryCover(w.work_covers),
      personalStatusId: w.personal_status_id ?? null,
      publicationStatusId: w.publication_status_id ?? null,
      chaptersRead: w.chapters_read ?? null,
      totalChapters: w.total_chapters ?? null,
      lastReadAt: w.last_read_at ?? null,
      expectedScore: w.calculated_scores?.expected_score ?? null,
      comixHid: comix?.external_id ?? null,
      lastChapterReleasedAt: w.last_chapter_released_at ?? null,
      nextChapterPredictedAt: w.next_chapter_predicted_at ?? null,
      chaptersCheckedAt: w.chapters_checked_at ?? null,
    }
  })
}

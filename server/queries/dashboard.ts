import { createAdminClient } from "@/lib/supabase/admin"
import {
  getPublicationStatusNameById,
  getPersonalStatusNameById,
  getPersonalStatusIdByName,
} from "@/lib/constants/status-lookups"
import { pickPrimaryCover } from "@/lib/covers"

type CoverRow = { url: string; is_primary: boolean; position: number }

export interface DashboardStats {
  totalWorks: number
  pendingAi: number
  withoutExpectedScore: number
  archived: number
  avgExpectedScore: number | null
  byPublicationStatus: Record<string, number>
  byPersonalStatus: Record<string, number>
  topWorks: Array<{
    id: string
    title: string
    coverUrl: string | null
    expectedScore: number | null
    publicationStatus: string
    publicationStatusId: number | null
    personalStatus: string
    personalStatusId: number | null
    aiEvalStatus: string
  }>
}

export interface ContinueReadingItem {
  id: string
  title: string
  coverUrl: string | null
  personalStatusId: number | null
  chaptersRead: number | null
  totalChapters: number | null
  lastReadAt: string | null
  expectedScore: number | null
  lastChapterReleasedAt: string | null
  nextChapterPredictedAt: string | null
}

export interface RecentActivityItem {
  id: string
  title: string
  coverUrl: string | null
  createdAt: string
  updatedAt: string
  kind: "added" | "updated"
}

export interface AiQueueCounts {
  iaRk: number
  synopsis: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = createAdminClient()

  const [worksRes, calcRes, topRes] = await Promise.all([
    supabase
      .from("works")
      .select("id, ai_eval_status, is_archived, publication_status_id, personal_status_id"),
    supabase
      .from("calculated_scores")
      .select("work_id, expected_score"),
    supabase
      .from("works")
      .select(`
        id, title, publication_status_id, personal_status_id, ai_eval_status, is_archived,
        calculated_scores(expected_score),
        work_covers(url, is_primary, position)
      `)
      .eq("is_archived", false)
      .order("title")
      .limit(200),
  ])

  if (worksRes.error) throw new Error(worksRes.error.message)
  if (calcRes.error) throw new Error(calcRes.error.message)

  const works = worksRes.data ?? []
  const calcs = calcRes.data ?? []
  const allWorks = topRes.data ?? []

  const active = works.filter((w) => !w.is_archived)
  const totalWorks = active.length
  const pendingAi = active.filter((w) =>
    w.ai_eval_status === "pending" || w.ai_eval_status === "review_pending"
  ).length
  const archived = works.filter((w) => w.is_archived).length

  const calcMap = new Map(calcs.map((c) => [c.work_id, c]))
  const withoutExpectedScore = active.filter(
    (w) => (calcMap.get(w.id)?.expected_score ?? null) == null
  ).length

  const scoresWithValue = calcs
    .map((c) => c.expected_score)
    .filter((s): s is number => s != null)

  const avgExpectedScore =
    scoresWithValue.length > 0
      ? scoresWithValue.reduce((a, b) => a + b, 0) / scoresWithValue.length
      : null

  const byPublicationStatus: Record<string, number> = {}
  const byPersonalStatus: Record<string, number> = {}
  for (const w of active) {
    const pubName = getPublicationStatusNameById(w.publication_status_id) ?? "Unknown"
    const persName = getPersonalStatusNameById(w.personal_status_id) ?? "Want to Read"
    byPublicationStatus[pubName] = (byPublicationStatus[pubName] ?? 0) + 1
    byPersonalStatus[persName] = (byPersonalStatus[persName] ?? 0) + 1
  }

  const topWorks = (allWorks as Array<{
    id: string
    title: string
    publication_status_id: number | null
    personal_status_id: number | null
    ai_eval_status: string
    calculated_scores?: { expected_score?: number | null } | null
    work_covers?: CoverRow[] | null
  }>)
    .map((w) => ({
      id: w.id,
      title: w.title,
      coverUrl: pickPrimaryCover(w.work_covers),
      expectedScore: w.calculated_scores?.expected_score ?? null,
      publicationStatus: getPublicationStatusNameById(w.publication_status_id) ?? "Unknown",
      publicationStatusId: w.publication_status_id ?? null,
      personalStatus: getPersonalStatusNameById(w.personal_status_id) ?? "Want to Read",
      personalStatusId: w.personal_status_id ?? null,
      aiEvalStatus: w.ai_eval_status,
    }))
    .filter((w) => w.expectedScore != null)
    .sort((a, b) => (b.expectedScore ?? 0) - (a.expectedScore ?? 0))
    .slice(0, 5)

  return {
    totalWorks,
    pendingAi,
    withoutExpectedScore,
    archived,
    avgExpectedScore,
    byPublicationStatus,
    byPersonalStatus,
    topWorks,
  }
}

/**
 * Obras em leitura ativa (status pessoal Reading/Started), ordenadas pela
 * leitura mais recente. Alimenta o widget "Continuar lendo" do dashboard.
 */
export async function getContinueReading(limit = 6): Promise<ContinueReadingItem[]> {
  const readingId = getPersonalStatusIdByName("Reading")
  const startedId = getPersonalStatusIdByName("Started")
  const statusIds = [readingId, startedId].filter((id): id is number => id != null)
  if (statusIds.length === 0) return []

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select(`
      id, title, personal_status_id, total_chapters, chapters_read, last_read_at,
      last_chapter_released_at, next_chapter_predicted_at,
      calculated_scores(expected_score),
      work_covers(url, is_primary, position)
    `)
    .eq("is_archived", false)
    .in("personal_status_id", statusIds)
    .order("last_read_at", { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  return ((data ?? []) as Array<{
    id: string
    title: string
    personal_status_id: number | null
    total_chapters: number | null
    chapters_read: number | null
    last_read_at: string | null
    last_chapter_released_at: string | null
    next_chapter_predicted_at: string | null
    calculated_scores?: { expected_score?: number | null } | null
    work_covers?: CoverRow[] | null
  }>).map((w) => ({
    id: w.id,
    title: w.title,
    coverUrl: pickPrimaryCover(w.work_covers),
    personalStatusId: w.personal_status_id ?? null,
    chaptersRead: w.chapters_read ?? null,
    totalChapters: w.total_chapters ?? null,
    lastReadAt: w.last_read_at ?? null,
    expectedScore: w.calculated_scores?.expected_score ?? null,
    lastChapterReleasedAt: w.last_chapter_released_at ?? null,
    nextChapterPredictedAt: w.next_chapter_predicted_at ?? null,
  }))
}

/**
 * Obras tocadas mais recentemente (criadas ou atualizadas). `kind` distingue
 * inclusões recentes de edições, comparando created_at e updated_at.
 */
export async function getRecentActivity(limit = 6): Promise<RecentActivityItem[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works")
    .select("id, title, created_at, updated_at, work_covers(url, is_primary, position)")
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(error.message)

  return ((data ?? []) as Array<{
    id: string
    title: string
    created_at: string
    updated_at: string
    work_covers?: CoverRow[] | null
  }>).map((w) => {
    const created = new Date(w.created_at).getTime()
    const updated = new Date(w.updated_at).getTime()
    // Margem de 60s absorve o tempo de processamento do import/criação inicial.
    const kind: "added" | "updated" = updated - created < 60_000 ? "added" : "updated"
    return {
      id: w.id,
      title: w.title,
      coverUrl: pickPrimaryCover(w.work_covers),
      createdAt: w.created_at,
      updatedAt: w.updated_at,
      kind,
    }
  })
}

/**
 * Contadores das filas de IA secundárias (re-rank e interesse por sinopse).
 * Replica o predicado dos estados-padrão das abas de /ai-evaluation pra os
 * números baterem com os badges de lá — mas com queries ACHATADAS (só as colunas
 * do predicado, sem covers/título nem montar objetos). Antes chamava
 * getAlignmentQueueWorks/getSynopsisQueueWorks, que carregavam o catálogo 2x (com
 * join de covers) só pra `.length` — gargalo da home. A fila de atributos vem do
 * `pendingAi` de getDashboardStats. Falhas degradam pra 0.
 *
 * Predicados (espelham getAlignmentQueueWorks({}) e getSynopsisQueueWorks({})):
 *   - IA Rk {stale, unranked}: obra ativa com alignment_score NULL (não rankeada,
 *     inclui sem linha em calculated_scores) OU alignment_score presente + stale.
 *   - Interesse Sinopse {unpredicted}: obra ativa com sinopse canônica e SEM
 *     nenhuma previsão (qualquer versão).
 */
export async function getAiQueueCounts(): Promise<AiQueueCounts> {
  const supabase = createAdminClient()
  try {
    const [activeRes, calcRes, synRes, predRes] = await Promise.all([
      supabase.from("works").select("id").eq("is_archived", false),
      supabase.from("calculated_scores").select("work_id, alignment_score, alignment_stale"),
      supabase
        .from("works")
        .select("id")
        .eq("is_archived", false)
        .not("canonical_synopsis", "is", null),
      supabase.from("synopsis_quality_predictions").select("work_id"),
    ])
    if (activeRes.error || calcRes.error || synRes.error || predRes.error) {
      throw activeRes.error ?? calcRes.error ?? synRes.error ?? predRes.error
    }

    const calcByWork = new Map(
      (calcRes.data ?? []).map((r) => {
        const row = r as {
          work_id: string
          alignment_score: number | null
          alignment_stale: boolean | null
        }
        return [row.work_id, row] as const
      })
    )
    let iaRk = 0
    for (const w of activeRes.data ?? []) {
      const calc = calcByWork.get((w as { id: string }).id)
      const alignmentScore = calc?.alignment_score ?? null
      const isUnranked = alignmentScore == null
      const isStale = alignmentScore != null && Boolean(calc?.alignment_stale)
      if (isUnranked || isStale) iaRk++
    }

    const predicted = new Set(
      (predRes.data ?? []).map((p) => (p as { work_id: string }).work_id)
    )
    let synopsis = 0
    for (const w of synRes.data ?? []) {
      if (!predicted.has((w as { id: string }).id)) synopsis++
    }

    return { iaRk, synopsis }
  } catch {
    return { iaRk: 0, synopsis: 0 }
  }
}

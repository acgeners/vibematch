import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import {
  getPublicationStatusNameById,
  getPersonalStatusNameById,
  getPersonalStatusIdByName,
} from "@/lib/constants/status-lookups"
import { pickPrimaryCover } from "@/lib/covers"
import { comixWorkUrl } from "@/lib/external/comix"
import { getPersonalStateReader, resolvePersonalFilterIds } from "@/server/queries/user-work-state"
import { getScoresReader } from "@/server/queries/user-scores"

type CoverRow = { url: string; is_primary: boolean; position: number }
type ExternalIdRow = { source: string; external_id: string | null; is_rejected: boolean | null }

/** hid do comix aceito (não-rejeitado) de uma obra, a partir das linhas de work_external_ids. */
function pickComixHid(rows: ExternalIdRow[] | null | undefined): string | null {
  return (
    (rows ?? []).find((r) => r.source === "comix" && r.is_rejected !== true && r.external_id)
      ?.external_id ?? null
  )
}

export interface DashboardStats {
  totalWorks: number
  pendingAi: number
  withoutExpectedScore: number
  archived: number
  /** Obras em leitura ativa (status pessoal Reading/Started). */
  following: number
  /** Quantas das obras acompanhadas têm capítulos não lidos (total > lidos). */
  followingWithPending: number
  /** Obras com nota pessoal (user_score) — alimentam o perfil de gosto. */
  rated: number
  avgExpectedScore: number | null
  byPublicationStatus: Record<string, number>
  byPersonalStatus: Record<string, number>
}

export interface TopWorkItem {
  id: string
  title: string
  coverUrl: string | null
  expectedScore: number | null
  publicationStatusId: number | null
  personalStatusId: number | null
}

export interface ContinueReadingItem {
  id: string
  title: string
  coverUrl: string | null
  personalStatusId: number | null
  chaptersRead: number | null
  totalChapters: number | null
  /** Capítulos não lidos = total − lidos (mín. 0); null quando o total é desconhecido. */
  pending: number | null
  /** URL de leitura no comix.to (quando há hid aceito); null caso contrário. */
  comixUrl: string | null
  lastReadAt: string | null
  expectedScore: number | null
  lastChapterReleasedAt: string | null
  nextChapterPredictedAt: string | null
}

export interface AiQueueCounts {
  iaRk: number
  synopsis: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = createAdminClient()

  // "Avaliadas" é o número de obras que EU notei — não as que o dono notou (Fatia 2a). Pro
  // dono, a conta continua sendo em `works`; pros demais, nas linhas dela.
  //
  // Em duas funções, e não num ternário dentro do `Promise.all`: os dois query builders têm
  // tipos diferentes, e o union deles faz o TS estourar em "type instantiation is excessively
  // deep" (TS2589).
  const personal = await getPersonalStateReader()
  const countRatedByOwner = async () => {
    const { count } = await supabase
      .from("works_owner")
      .select("id", { count: "exact", head: true })
      .eq("is_archived", false)
      .not("user_score", "is", null)
    return count ?? 0
  }
  const countRatedByUser = async () => {
    const { count } = await supabase
      .from("user_work_state")
      .select("work_id", { count: "exact", head: true })
      .eq("user_id", personal.userId)
      .not("user_score", "is", null)
    return count ?? 0
  }

  const [worksRes, calcRes, rated] = await Promise.all([
    // `works` (não a view): serve qualquer usuário e passa pelo overlay abaixo.
    supabase
      .from("works")
      .select("id, ai_eval_status, is_archived, publication_status_id, personal_status_id, total_chapters, chapters_read"),
    supabase
      .from("calculated_scores")
      .select("work_id, expected_score"),
    personal.isOwner ? countRatedByOwner() : countRatedByUser(),
  ])

  if (worksRes.error) throw new Error(worksRes.error.message)
  if (calcRes.error) throw new Error(calcRes.error.message)

  const works = worksRes.data ?? []
  const calcs = calcRes.data ?? []

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

  // KPIs de LEITURA ("acompanhando", distribuição por status, capítulos pendentes) são de
  // quem está olhando — não do dono. `personal.get()` é identidade pro dono e a linha dela
  // pros demais; sem isso, a home da Leitora abriria anunciando as 14 obras que ELE está
  // lendo. Os KPIs de CATÁLOGO (total, pendências de IA, arquivadas, nota média) seguem
  // globais de propósito: o catálogo é compartilhado.
  // (`personal` já foi lido acima, pro contador de avaliadas — o reader é memoizado por
  // request, então reusar não custa query nova.)

  const byPublicationStatus: Record<string, number> = {}
  const byPersonalStatus: Record<string, number> = {}
  let following = 0
  let followingWithPending = 0
  for (const w of active) {
    const state = personal.get(w.id, w)
    const pubName = getPublicationStatusNameById(w.publication_status_id) ?? "Unknown"
    const persName = getPersonalStatusNameById(state.personalStatusId) ?? "Want to Read"
    byPublicationStatus[pubName] = (byPublicationStatus[pubName] ?? 0) + 1
    byPersonalStatus[persName] = (byPersonalStatus[persName] ?? 0) + 1
    if (persName === "Reading" || persName === "Started") {
      following++
      if (w.total_chapters != null && w.total_chapters - (state.chaptersRead ?? 0) > 0) {
        followingWithPending++
      }
    }
  }

  return {
    totalWorks,
    pendingAi,
    withoutExpectedScore,
    archived,
    following,
    followingWithPending,
    rated,
    avgExpectedScore,
    byPublicationStatus,
    byPersonalStatus,
  }
}

/**
 * Melhores obras por Nota Prevista que você ainda NÃO avaliou (user_score null)
 * — a lista "o que ler a seguir" do dashboard. Ordena por expected_score no
 * próprio calculated_scores e filtra a obra embutida (is_archived=false,
 * user_score IS NULL) via !inner, buscando só `limit` linhas.
 */
export async function getTopUnratedByExpected(limit = 5): Promise<TopWorkItem[]> {
  const supabase = createAdminClient()

  // 🔴 Este widget é PESSOAL nas duas pontas — e as duas estavam erradas:
  //   "que VOCÊ ainda não avaliou" filtrava por `works.user_score` (a nota do DONO)
  //   "melhores por Nota Prevista" ordenava por `calculated_scores` (a previsão DELE)
  // Ou seja, a home da Leitora recomendava obras pelo gosto dele, chamando de "pra você".
  // Passou batido na 2b porque eu religei o "Acompanhando" e os KPIs, mas não este.
  const [personal, scores] = await Promise.all([getPersonalStateReader(), getScoresReader()])

  const { data, error } = await supabase
    .from("works")
    .select(`
      id, title, is_archived, publication_status_id, personal_status_id, user_score,
      calculated_scores(expected_score, platform_avg),
      work_covers(url, is_primary, position)
    `)
    .eq("is_archived", false)
    .limit(2000)

  if (error) throw new Error(error.message)

  type Row = {
    id: string
    title: string
    publication_status_id: number | null
    personal_status_id: number | null
    user_score: number | null
    calculated_scores: { expected_score: number | null; platform_avg: number | null } | null
    work_covers?: CoverRow[] | null
  }

  const candidatas = ((data ?? []) as unknown as Row[])
    .map((w) => {
      const state = personal.get(w.id, w)
      const calc = scores.overlay(w.id, w.calculated_scores)
      return {
        id: w.id,
        title: w.title,
        coverUrl: pickPrimaryCover(w.work_covers),
        expectedScore: calc?.expected_score ?? null,
        platformAvg: calc?.platform_avg ?? null,
        publicationStatusId: w.publication_status_id ?? null,
        personalStatusId: state.personalStatusId,
        userScore: state.userScore,
      }
    })
    // "ainda não avaliou" = a nota DELA é nula (não a dele).
    .filter((w) => w.userScore == null)

  // Sem modelo, não há Nota Prevista pra ordenar — cai na nota da COMUNIDADE, como o ranking.
  const ordenadas = scores.hasModel
    ? candidatas.filter((w) => w.expectedScore != null).sort((a, b) => (b.expectedScore ?? -1) - (a.expectedScore ?? -1))
    : candidatas.filter((w) => w.platformAvg != null).sort((a, b) => (b.platformAvg ?? -1) - (a.platformAvg ?? -1))

  return ordenadas.slice(0, limit).map((w) => ({
    id: w.id,
    title: w.title,
    coverUrl: w.coverUrl,
    expectedScore: w.expectedScore,
    publicationStatusId: w.publicationStatusId,
    personalStatusId: w.personalStatusId,
  }))
}

/**
 * Obras em leitura ativa (Reading/Started) que têm capítulos PENDENTES
 * (total_chapters > chapters_read), ordenadas pela leitura mais recente.
 * Alimenta o widget "Acompanhando" do dashboard — só o que ainda há pra ler.
 * O filtro de pendentes é em JS (comparação coluna-a-coluna), então busca
 * todas as acompanhadas (conjunto pequeno) e corta em `limit` depois.
 */
export async function getContinueReading(limit = 6): Promise<ContinueReadingItem[]> {
  const readingId = getPersonalStatusIdByName("Reading")
  const startedId = getPersonalStatusIdByName("Started")
  const statusIds = [readingId, startedId].filter((id): id is number => id != null)
  if (statusIds.length === 0) return []

  const supabase = createAdminClient()

  // "Continue lendo" é, por definição, o que EU estou lendo. Pro dono sai de `works`; pros
  // demais, de `user_work_state` — senão o widget da home dela oferece os capítulos DELE.
  const personal = await getPersonalStateReader()
  // Fatia 2b: a Nota Prevista mostrada no card é de QUEM OLHA — não a do dono.
  const scoresReader = await getScoresReader()
  const ownIds = await resolvePersonalFilterIds({ personalStatusIds: statusIds })
  if (ownIds && ownIds.length === 0) return []

  // ⚠️ `works`, não `works_owner`: esta query serve QUALQUER usuário e passa pelo overlay do
  // `personal.get()`. A view é a fonte do DONO — usá-la aqui daria os capítulos dele como base
  // pra ela (e ainda quebra: a view não tem as colunas de data de capítulo).
  let query = supabase
    .from("works")
    .select(`
      id, title, personal_status_id, total_chapters, chapters_read, last_read_at,
      last_chapter_released_at, next_chapter_predicted_at,
      calculated_scores(expected_score),
      work_covers(url, is_primary, position),
      work_external_ids(source, external_id, is_rejected)
    `)
    .eq("is_archived", false)
  query = ownIds ? query.in("id", ownIds) : query.in("personal_status_id", statusIds)

  const { data, error } = await query.order("last_read_at", {
    ascending: false,
    nullsFirst: false,
  })

  if (error) throw new Error(error.message)

  const items = ((data ?? []) as Array<{
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
    work_external_ids?: ExternalIdRow[] | null
  }>).map((w) => {
    const comixHid = pickComixHid(w.work_external_ids)
    const state = personal.get(w.id, w)
    const pending =
      w.total_chapters != null ? Math.max(0, w.total_chapters - (state.chaptersRead ?? 0)) : null
    return {
      id: w.id,
      title: w.title,
      coverUrl: pickPrimaryCover(w.work_covers),
      personalStatusId: state.personalStatusId,
      chaptersRead: state.chaptersRead,
      totalChapters: w.total_chapters ?? null,
      pending,
      comixUrl: comixHid ? comixWorkUrl(comixHid) : null,
      lastReadAt: state.lastReadAt,
      expectedScore: scoresReader.overlay(w.id, w.calculated_scores)?.expected_score ?? null,
      lastChapterReleasedAt: w.last_chapter_released_at ?? null,
      nextChapterPredictedAt: w.next_chapter_predicted_at ?? null,
    }
  })

  // O `.order()` é por `works.last_read_at` (a data DELE) — reordena pela dela.
  if (!personal.isOwner) {
    items.sort((a, b) => (b.lastReadAt ?? "").localeCompare(a.lastReadAt ?? ""))
  }

  // Só as com capítulos pendentes (total > lidos); corta em `limit` depois do filtro.
  return items.filter((i) => i.pending != null && i.pending > 0).slice(0, limit)
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
    // Tudo pagina: works/calculated_scores/predictions são de escala catálogo
    // (predictions já passou de 1000). Sem isso o PostgREST corta em 1000 linhas e
    // as contagens da home não batem com as abas de /ai-evaluation.
    const [activeRows, calcRows, synRows, predRows] = await Promise.all([
      fetchAllRows<{ id: string }>(
        (from, to) => supabase.from("works").select("id").eq("is_archived", false).range(from, to),
        "getAiQueueCounts.works",
      ),
      fetchAllRows<{ work_id: string; alignment_score: number | null; alignment_stale: boolean | null }>(
        (from, to) => supabase.from("calculated_scores").select("work_id, alignment_score, alignment_stale").range(from, to),
        "getAiQueueCounts.calculated_scores",
      ),
      fetchAllRows<{ id: string }>(
        (from, to) =>
          supabase.from("works").select("id").eq("is_archived", false).not("canonical_synopsis", "is", null).range(from, to),
        "getAiQueueCounts.synopsis_works",
      ),
      fetchAllRows<{ work_id: string }>(
        (from, to) => supabase.from("synopsis_quality_predictions").select("work_id").range(from, to),
        "getAiQueueCounts.predictions",
      ),
    ])

    const calcByWork = new Map(calcRows.map((row) => [row.work_id, row] as const))
    let iaRk = 0
    for (const w of activeRows) {
      const calc = calcByWork.get(w.id)
      const alignmentScore = calc?.alignment_score ?? null
      const isUnranked = alignmentScore == null
      const isStale = alignmentScore != null && Boolean(calc?.alignment_stale)
      if (isUnranked || isStale) iaRk++
    }

    const predicted = new Set(predRows.map((p) => p.work_id))
    let synopsis = 0
    for (const w of synRows) {
      if (!predicted.has(w.id)) synopsis++
    }

    return { iaRk, synopsis }
  } catch {
    return { iaRk: 0, synopsis: 0 }
  }
}

import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import {
  getPublicationStatusNameById,
  getPersonalStatusNameById,
  getPersonalStatusIdByName,
} from "@/lib/constants/status-lookups"
import { pickPrimaryCover } from "@/lib/covers"
import type { SynopsisQuality } from "@/types/domain"
import { comixWorkUrl } from "@/lib/external/comix"
import { getPersonalStateReader, resolvePersonalFilterIds } from "@/server/queries/user-work-state"
import { getScoresReader } from "@/server/queries/user-scores"
import { FOLLOWING_PERSONAL_STATUSES } from "@/lib/constants/criteria"
import { isFollowingPersonalStatus, personalStatusNameOrDefault } from "@/lib/constants/status-lookups"

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
  /** Conteúdo adulto (18+) efetivo — works.is_adult. */
  isAdult: boolean
  /** Total de capítulos conhecido; null quando nenhuma fonte sabe. */
  totalChapters: number | null
  /** Interesse na obra de QUEM OLHA (♥…♥♥♥♥), quando já declarado. */
  synopsisQuality: SynopsisQuality | null
}

export interface ContinueReadingItem {
  id: string
  title: string
  coverUrl: string | null
  personalStatusId: number | null
  /** Status de PUBLICAÇÃO — a home usa para o hiato oficial das bandas de ritmo. */
  publicationStatusId: number | null
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
  /** Conteúdo adulto (18+) efetivo — works.is_adult. */
  isAdult: boolean
}

export interface AiQueueCounts {
  iaRk: number
  synopsis: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = createAdminClient()

  // "Avaliadas" é o número de obras que EU notei — não as que o dono notou (Fatia 2a). Agora
  // sai de `user_work_state` pra TODO MUNDO (Fase D): eram duas contas, uma em `works_owner`
  // (dono) e outra no espelho (os demais).
  //
  // ⚠️ E elas não contavam a mesma coisa: a do dono excluía arquivadas (`is_archived = false`),
  // a dela não. Unificar exigiu escolher — ficou a semântica DELE (arquivada não conta), que é
  // a que o resto da home usa. O `!inner` é o que permite filtrar por uma coluna de `works` a
  // partir do espelho; sem ele o filtro de arquivada seria silenciosamente ignorado.
  const personal = await getPersonalStateReader()
  const countRated = async () => {
    const { count } = await supabase
      .from("user_work_state")
      .select("work_id, works!inner(is_archived)", { count: "exact", head: true })
      .eq("user_id", personal.userId)
      .eq("works.is_archived", false)
      .not("user_score", "is", null)
    return count ?? 0
  }

  const [worksRes, calcRes, rated] = await Promise.all([
    // `works` (não a view): serve qualquer usuário e passa pelo overlay abaixo.
    supabase
      .from("works")
      .select("id, ai_eval_status, is_archived, publication_status_id, total_chapters"),
    supabase
      .from("calculated_scores")
      .select("work_id, expected_score"),
    countRated(),
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
    const state = personal.get(w.id)
    const pubName = getPublicationStatusNameById(w.publication_status_id) ?? "Unknown"
    const persName = personalStatusNameOrDefault(state.personalStatusId)
    byPublicationStatus[pubName] = (byPublicationStatus[pubName] ?? 0) + 1
    byPersonalStatus[persName] = (byPersonalStatus[persName] ?? 0) + 1
    if (isFollowingPersonalStatus(persName)) {
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
      id, title, is_archived, publication_status_id, is_adult, total_chapters,
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
    is_adult?: boolean | null
    total_chapters?: number | null
    calculated_scores: { expected_score: number | null; platform_avg: number | null } | null
    work_covers?: CoverRow[] | null
  }

  const candidatas = ((data ?? []) as unknown as Row[])
    .map((w) => {
      const state = personal.get(w.id)
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
        isAdult: Boolean(w.is_adult),
        totalChapters: w.total_chapters ?? null,
        synopsisQuality: state.synopsisQuality,
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
    isAdult: w.isAdult,
    totalChapters: w.totalChapters,
    synopsisQuality: w.synopsisQuality,
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
  // "Acompanhando" = os status marcados `is_following` no banco (migration 156).
  const followingIds = FOLLOWING_PERSONAL_STATUSES.map((s) => getPersonalStatusIdByName(s)).filter(
    (id): id is number => id != null,
  )
  const [readingId, startedId] = followingIds
  const statusIds = [readingId, startedId].filter((id): id is number => id != null)
  if (statusIds.length === 0) return []

  const supabase = createAdminClient()

  // "Continue lendo" é, por definição, o que EU estou lendo — sai de `user_work_state`, pra
  // todo mundo (Fase D). "Lendo" é sempre uma linha explícita de estado, então o recorte por id
  // é exato aqui (diferente do /ranking, onde obra SEM linha é "Want to Read" e um filtro por
  // id não consegue dizer isso). `[]` = não estou lendo nada → widget vazio.
  const personal = await getPersonalStateReader()
  // Fatia 2b: a Nota Prevista mostrada no card é de QUEM OLHA — não a do dono.
  const scoresReader = await getScoresReader()
  const ownIds = await resolvePersonalFilterIds({ personalStatusIds: statusIds })
  if (!ownIds || ownIds.length === 0) return []

  // ⚠️ `works`, não `works_owner`: esta query serve QUALQUER usuário e passa pelo overlay do
  // `personal.get()`. A view é a fonte do DONO — usá-la aqui daria os capítulos dele como base
  // pra ela (e ainda quebra: a view não tem as colunas de data de capítulo).
  const { data, error } = await supabase
    .from("works")
    .select(`
      id, title, total_chapters, is_adult, publication_status_id,
      last_chapter_released_at, next_chapter_predicted_at,
      calculated_scores(expected_score),
      work_covers(url, is_primary, position),
      work_external_ids(source, external_id, is_rejected)
    `)
    .eq("is_archived", false)
    .in("id", ownIds)

  if (error) throw new Error(error.message)

  const items = ((data ?? []) as Array<{
    id: string
    title: string
    total_chapters: number | null
    is_adult?: boolean | null
    last_chapter_released_at: string | null
    next_chapter_predicted_at: string | null
    publication_status_id?: number | null
    calculated_scores?: { expected_score?: number | null } | null
    work_covers?: CoverRow[] | null
    work_external_ids?: ExternalIdRow[] | null
  }>).map((w) => {
    const comixHid = pickComixHid(w.work_external_ids)
    const state = personal.get(w.id)
    const pending =
      w.total_chapters != null ? Math.max(0, w.total_chapters - (state.chaptersRead ?? 0)) : null
    return {
      id: w.id,
      title: w.title,
      coverUrl: pickPrimaryCover(w.work_covers),
      personalStatusId: state.personalStatusId,
      publicationStatusId: w.publication_status_id ?? null,
      chaptersRead: state.chaptersRead,
      totalChapters: w.total_chapters ?? null,
      pending,
      comixUrl: comixHid ? comixWorkUrl(comixHid) : null,
      lastReadAt: state.lastReadAt,
      expectedScore: scoresReader.overlay(w.id, w.calculated_scores)?.expected_score ?? null,
      lastChapterReleasedAt: w.last_chapter_released_at ?? null,
      nextChapterPredictedAt: w.next_chapter_predicted_at ?? null,
      isAdult: Boolean(w.is_adult),
    }
  })

  // Ordena pela "última leitura" de QUEM OLHA — em memória. Era um `.order("last_read_at")` no
  // SQL (a data que estava em `works`, ou seja, a DELE) corrigido depois por um re-sort só pros
  // outros usuários. Agora a data vem do espelho e o SQL não tem mais essa coluna: o re-sort é
  // o único caminho, e vale pros dois. Nulos por último (era `nullsFirst: false`).
  items.sort((a, b) => {
    if (a.lastReadAt === b.lastReadAt) return 0
    if (a.lastReadAt == null) return 1
    if (b.lastReadAt == null) return -1
    return b.lastReadAt.localeCompare(a.lastReadAt)
  })

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

    // ⚠️ `calculated_scores` é a linha do DONO. O Veredito IA virou per-usuário (mora em
    // `user_calculated_scores` para os demais), então contar direto daqui devolvia a fila
    // DELE para qualquer pessoa logada — no `/painel`, que qualquer logado abre. O overlay
    // troca os campos pessoais pelos de quem olha; para o dono é identidade e custa zero
    // query.
    //
    // ⚠️ Isto NÃO faz o número bater com o que `/fila-recomendacao?tab=ia-rk` lista: a aba
    // filtra `["stale"]` por padrão e esta contagem usa `["stale","unranked"]`. A divergência
    // é anterior e vale para o dono também — só ficou visível agora. Decidir qual dos dois é
    // "pendente" é decisão de produto, não de leitura.
    const scores = await getScoresReader()
    const calcByWork = new Map(calcRows.map((row) => [row.work_id, row] as const))
    let iaRk = 0
    for (const w of activeRows) {
      const calc = scores.overlay(w.id, calcByWork.get(w.id) ?? null)
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

import { createAdminClient } from "@/lib/supabase/admin"
import { selectByIdsInChunks } from "@/lib/supabase/paginate"
import { pickPrimaryCover } from "@/lib/covers"
import { CRITERION_SLUGS, type CriterionSlug } from "@/types/domain"
import type { FavoritesSummary } from "@/server/queries/favorites"
import { getPersonalStateReader } from "@/server/queries/user-work-state"
import { getCurrentUserId, getHideAdultContent } from "@/server/queries/current-user"
import { getScoresReader } from "@/server/queries/user-scores"

// ────────────────────────────────────────────────────────────────────────────
// Grupos de favoritos (work_lists). Ver migration 123 e o topic file
// project_favorites_groups_feature. O índice de /favorites lista grupos com
// um resumo agregado (capa + nº de obras + Nota Prevista média + 3 critérios
// de destaque); o detalhe /favorites/[listId] reusa a máquina do ranking
// escopada às obras do grupo (filters.onlyWorkIds).
// ────────────────────────────────────────────────────────────────────────────

export interface WorkListSummary extends FavoritesSummary {
  id: string
  name: string
  description: string | null
  color: string | null
  /** IDs escolhidos manualmente pra capa (ordem preservada); [] = automático. */
  coverWorkIds: string[]
  /** IDs das obras do grupo (pra alimentar o picker de capas na edição). */
  workIds: string[]
  /** Até 3 URLs de capa pra o "cover stack" do card. */
  coverUrls: string[]
  /** Nº de comentários do grupo (badge 💬 do card). */
  commentCount: number
}

export interface WorkListDetail {
  id: string
  name: string
  description: string | null
  color: string | null
  /** IDs escolhidos manualmente pra capa (ordem preservada); [] = automático. */
  coverWorkIds: string[]
  /** IDs das obras do grupo (escopo do ranking). */
  workIds: string[]
  /** Log de comentários do grupo (mais recentes por último na ordem de inserção). */
  comments: ListComment[]
  summary: FavoritesSummary
}

export interface WorkLiteForPicker {
  id: string
  title: string
  coverUrl: string | null
  expectedScore: number | null
  isFavorite: boolean
}

/** Grupo "lite" pro seletor de destino (mover obras selecionadas pra um grupo). */
export interface ListPickerOption {
  id: string
  name: string
  color: string | null
  count: number
}

type WorkRow = {
  id: string
  title?: string
  is_favorite?: boolean
  calculated_scores: { expected_score: number | null } | null
  category_scores: Array<{ criterion_slug: string; score: number | null }> | null
  work_covers: Array<{ url: string; is_primary: boolean; position: number }> | null
}

/** Um comentário do grupo (log JSONB em work_lists.comments). */
export interface ListComment {
  id: string
  text: string
  created_at: string
}

const VALID_SLUGS = new Set<string>(CRITERION_SLUGS)

/** Resumo agregado (Nota Prevista média + top-3 critérios) de um conjunto de obras. */
function summarizeWorks(rows: WorkRow[]): FavoritesSummary {
  let expectedSum = 0
  let expectedCount = 0
  const critSum = new Map<string, number>()
  const critCount = new Map<string, number>()

  for (const w of rows) {
    const f = w.calculated_scores?.expected_score
    if (f != null) {
      expectedSum += Number(f)
      expectedCount += 1
    }
    for (const cs of w.category_scores ?? []) {
      if (cs.score == null || !VALID_SLUGS.has(cs.criterion_slug)) continue
      critSum.set(cs.criterion_slug, (critSum.get(cs.criterion_slug) ?? 0) + Number(cs.score))
      critCount.set(cs.criterion_slug, (critCount.get(cs.criterion_slug) ?? 0) + 1)
    }
  }

  const topCriteria: Array<{ slug: CriterionSlug; avg: number; n: number }> = []
  for (const [slug, sum] of critSum) {
    const n = critCount.get(slug) ?? 0
    if (n === 0) continue
    topCriteria.push({ slug: slug as CriterionSlug, avg: sum / n, n })
  }
  topCriteria.sort((a, b) => b.avg - a.avg)

  return {
    total: rows.length,
    withExpectedScore: expectedCount,
    avgExpectedScore: expectedCount > 0 ? expectedSum / expectedCount : null,
    topCriteria: topCriteria.slice(0, 3),
  }
}

/** Escolhe até 3 capas: usa `coverWorkIds` na ordem escolhida; senão as obras
 *  de maior Nota Prevista (ordenação padrão). */
function pickCoverUrls(
  coverWorkIds: string[],
  memberRows: WorkRow[],
  byId: Map<string, WorkRow>,
): string[] {
  const source =
    coverWorkIds.length > 0
      ? coverWorkIds.map((id) => byId.get(id)).filter((r): r is WorkRow => Boolean(r))
      : [...memberRows].sort(
          (a, b) =>
            (Number(b.calculated_scores?.expected_score ?? -Infinity)) -
            (Number(a.calculated_scores?.expected_score ?? -Infinity)),
        )
  const urls: string[] = []
  for (const row of source) {
    const url = pickPrimaryCover(row.work_covers)
    if (url) urls.push(url)
    if (urls.length >= 3) break
  }
  return urls
}

const WORK_SUMMARY_SELECT =
  "id, is_archived, calculated_scores(expected_score), category_scores(criterion_slug, score), work_covers(url, is_primary, position)"

/** Índice de grupos com resumo agregado. Uma varredura de itens + uma de obras. */
export async function getListsWithSummary(): Promise<WorkListSummary[]> {
  const supabase = createAdminClient()
  // Fatia 2b (mig 149): os grupos têm DONO. Sem este filtro, a Leitora abriria /favoritos e
  // veria os grupos DELE ("Comfort reads", "Pra maratonar") como se fossem dela.
  const viewerId = await getCurrentUserId()

  const [listsRes, itemsRes] = await Promise.all([
    supabase
      .from("work_lists")
      .select("id, name, description, color, cover_work_ids, comments, position, created_at")
      .eq("user_id", viewerId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("work_list_items")
      .select("list_id, work_id, position")
      .order("position", { ascending: true }),
  ])

  if (listsRes.error) {
    console.error("[lists] erro lendo grupos:", listsRes.error)
    return []
  }
  const lists = (listsRes.data ?? []) as Array<{
    id: string
    name: string
    description: string | null
    color: string | null
    cover_work_ids: string[] | null
    comments: ListComment[] | null
    position: number
  }>
  if (lists.length === 0) return []

  const items = (itemsRes.data ?? []) as Array<{ list_id: string; work_id: string }>
  const itemsByList = new Map<string, string[]>()
  for (const it of items) {
    const arr = itemsByList.get(it.list_id) ?? []
    arr.push(it.work_id)
    itemsByList.set(it.list_id, arr)
  }

  const allIds = Array.from(new Set(items.map((i) => i.work_id)))
  const byId = new Map<string, WorkRow>()
  if (allIds.length > 0) {
    const { data, error } = await selectByIdsInChunks<WorkRow>(
      allIds,
      (chunk) =>
        supabase.from("works").select(WORK_SUMMARY_SELECT).eq("is_archived", false).in("id", chunk) as unknown as PromiseLike<{ data: WorkRow[] | null; error: { message: string } | null }>,
    )
    if (error) console.error("[lists] erro lendo obras dos grupos:", error.message)
    for (const row of data) byId.set(row.id, row)
  }

  return lists.map((list) => {
    const memberIds = itemsByList.get(list.id) ?? []
    const memberRows = memberIds.map((id) => byId.get(id)).filter((r): r is WorkRow => Boolean(r))
    const coverWorkIds = list.cover_work_ids ?? []
    return {
      id: list.id,
      name: list.name,
      description: list.description,
      color: list.color,
      coverWorkIds,
      workIds: memberIds,
      coverUrls: pickCoverUrls(coverWorkIds, memberRows, byId),
      commentCount: (list.comments ?? []).length,
      ...summarizeWorks(memberRows),
    }
  })
}

/** Detalhe de um grupo: metadados + IDs (escopo do ranking) + resumo escopado. */
export async function getListDetail(id: string): Promise<WorkListDetail | null> {
  const supabase = createAdminClient()

  // Escopado ao dono: sem isso, bastaria a URL /favorites/<id-de-um-grupo-dele> pra ela abrir
  // o grupo dele. Um id não é um segredo.
  const { data: list, error } = await supabase
    .from("work_lists")
    .select("id, name, description, color, cover_work_ids, comments")
    .eq("id", id)
    .eq("user_id", await getCurrentUserId())
    .maybeSingle()

  if (error || !list) {
    if (error) console.error("[lists] erro lendo grupo:", error.message)
    return null
  }

  const { data: itemRows } = await supabase
    .from("work_list_items")
    .select("work_id, position")
    .eq("list_id", id)
    .order("position", { ascending: true })

  const workIds = (itemRows ?? []).map((r) => (r as { work_id: string }).work_id)

  const byId = new Map<string, WorkRow>()
  if (workIds.length > 0) {
    const { data } = await selectByIdsInChunks<WorkRow>(
      workIds,
      (chunk) =>
        supabase.from("works").select(WORK_SUMMARY_SELECT).eq("is_archived", false).in("id", chunk) as unknown as PromiseLike<{ data: WorkRow[] | null; error: { message: string } | null }>,
    )
    for (const row of data) byId.set(row.id, row)
  }
  const memberRows = workIds.map((wid) => byId.get(wid)).filter((r): r is WorkRow => Boolean(r))

  return {
    id: list.id as string,
    name: list.name as string,
    description: (list.description ?? null) as string | null,
    color: (list.color ?? null) as string | null,
    coverWorkIds: ((list.cover_work_ids ?? []) as string[]),
    workIds,
    comments: ((list.comments ?? []) as ListComment[]),
    summary: summarizeWorks(memberRows),
  }
}

export interface ListRecommendation {
  slug: string
  createdAt: string
  nCandidates: number | null
}

/** Recomendações IA atreladas a um grupo (recommendation_runs.list_id).
 *  Requer migration 124; sem ela, o filtro erra e devolve []. */
export async function getListRecommendations(listId: string): Promise<ListRecommendation[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("recommendation_runs")
    .select("slug, created_at, n_candidates")
    .eq("list_id", listId)
    .order("created_at", { ascending: false })
    .limit(10)
  if (error) return []
  return (data ?? []).map((r) => {
    const row = r as { slug: string; created_at: string; n_candidates: number | null }
    return { slug: row.slug, createdAt: row.created_at, nCandidates: row.n_candidates ?? null }
  })
}

/** Grupos "lite" pro seletor de destino (barra de seleção → "Adicionar a grupo").
 *  Só id/nome/cor + contagem de obras — sem os agregados de resumo do índice. */
export async function getListsForPicker(): Promise<ListPickerOption[]> {
  const supabase = createAdminClient()
  const [listsRes, itemsRes] = await Promise.all([
    supabase
      .from("work_lists")
      .select("id, name, color, position, created_at")
      .eq("user_id", await getCurrentUserId())
      .order("position", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase.from("work_list_items").select("list_id"),
  ])
  if (listsRes.error) {
    console.error("[lists] erro lendo grupos (picker):", listsRes.error.message)
    return []
  }
  const counts = new Map<string, number>()
  for (const it of (itemsRes.data ?? []) as Array<{ list_id: string }>) {
    counts.set(it.list_id, (counts.get(it.list_id) ?? 0) + 1)
  }
  return ((listsRes.data ?? []) as Array<{ id: string; name: string; color: string | null }>).map(
    (l) => ({ id: l.id, name: l.name, color: l.color, count: counts.get(l.id) ?? 0 }),
  )
}

export interface FavoriteFolderMenu {
  /** Grupos do usuário (id/nome/cor/contagem), na ordem do índice. */
  folders: ListPickerOption[]
  /** IDs dos grupos (⊆ `folders`) que já contêm esta obra. */
  memberOf: string[]
}

/** Dados do menu "salvar em pasta" do botão de favoritar na página da obra: os
 *  grupos do usuário + em quais deles esta obra já está. Escopado ao dono — sem
 *  `user_id` (anônimo) devolve vazio. */
export async function getFavoriteFolderMenu(workId: string): Promise<FavoriteFolderMenu> {
  const supabase = createAdminClient()
  const viewerId = await getCurrentUserId()
  if (!viewerId) return { folders: [], memberOf: [] }

  const [listsRes, itemsRes, memberRes] = await Promise.all([
    supabase
      .from("work_lists")
      .select("id, name, color, position, created_at")
      .eq("user_id", viewerId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase.from("work_list_items").select("list_id"),
    supabase.from("work_list_items").select("list_id").eq("work_id", workId),
  ])

  if (listsRes.error) {
    console.error("[lists] erro lendo menu de pastas:", listsRes.error.message)
    return { folders: [], memberOf: [] }
  }

  const lists = (listsRes.data ?? []) as Array<{ id: string; name: string; color: string | null }>
  const ownedIds = new Set(lists.map((l) => l.id))

  const counts = new Map<string, number>()
  for (const it of (itemsRes.data ?? []) as Array<{ list_id: string }>) {
    counts.set(it.list_id, (counts.get(it.list_id) ?? 0) + 1)
  }

  // `memberRes` (admin) traz itens desta obra de QUALQUER dono; interseção com os
  // grupos do viewer garante que só as pastas dele contam como membership.
  const memberOf = Array.from(
    new Set(
      ((memberRes.data ?? []) as Array<{ list_id: string }>)
        .map((r) => r.list_id)
        .filter((id) => ownedIds.has(id)),
    ),
  )

  const folders: ListPickerOption[] = lists.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    count: counts.get(l.id) ?? 0,
  }))

  return { folders, memberOf }
}

/** Catálogo "lite" pro picker de obras (adicionar/remover do grupo) e pra
 *  escolha de capas. Todas as obras não arquivadas, mais leves. */
export async function getWorksLiteForPicker(): Promise<WorkLiteForPicker[]> {
  const supabase = createAdminClient()
  let query = supabase
    .from("works")
    .select("id, title, calculated_scores(expected_score), work_covers(url, is_primary, position)")
    .eq("is_archived", false)
    .order("title", { ascending: true })
    .limit(3000)
  // Quem oculta 18+ não vê obras adultas nem no picker de adicionar à lista.
  if (await getHideAdultContent()) query = query.eq("is_adult", false)
  const { data, error } = await query

  if (error) {
    console.error("[lists] erro lendo catálogo lite:", error.message)
    return []
  }

  const rows = (data ?? []) as unknown as Array<{
    id: string
    title: string
    calculated_scores: { expected_score: number | null } | null
    work_covers: Array<{ url: string; is_primary: boolean; position: number }> | null
  }>

  // ⚠️ `is_favorite` aqui é a coluna de `works` — o favorito do DONO. Este catálogo lite vai
  // pro /favorites, e o `GroupsIndex` filtra por `isFavorite` pra montar o mosaico de "Todos
  // os favoritos": sem esta troca, a Leitora abre /favoritos e vê as capas dos favoritos DELE
  // como se fossem dela. Foi exatamente o que o teste de dois usuários pegou.
  const personal = await getPersonalStateReader()
  // Fatia 2b: idem — a Nota Prevista no picker é a DELA (ou nenhuma).
  const scoresReader = await getScoresReader()

  return rows
    .map((w) => ({
      id: w.id,
      title: w.title,
      coverUrl: pickPrimaryCover(w.work_covers),
      expectedScore: scoresReader.overlay(w.id, w.calculated_scores)?.expected_score ?? null,
      isFavorite: personal.get(w.id).isFavorite,
    }))
    .sort((a, b) => {
      const ea = a.expectedScore ?? -Infinity
      const eb = b.expectedScore ?? -Infinity
      if (eb !== ea) return eb - ea
      return a.title.localeCompare(b.title)
    })
}

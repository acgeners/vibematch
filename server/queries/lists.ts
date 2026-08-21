import { cache } from "react"
import { createAdminClient } from "@/lib/supabase/admin"
import { createUserClient } from "@/lib/supabase/user"
import { fetchAllRows, selectByIdsInChunks } from "@/lib/supabase/paginate"
import { pickPrimaryCover } from "@/lib/covers"
import { coverCandidates } from "@/lib/work-derived"
import { CRITERION_SLUGS, type CriterionSlug } from "@/types/domain"
import type { FavoritesSummary } from "@/server/queries/favorites"
import { getPersonalStateReader, resolvePersonalFilterIds } from "@/server/queries/user-work-state"
import { getHideAdultContent, getSessionUserId } from "@/server/queries/current-user"
import { getScoresReader } from "@/server/queries/user-scores"
import type { ScoresReader } from "@/server/queries/user-scores"

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
  /** Até 3 slots do "cover stack" do card, cada um com as candidatas de uma obra. */
  mosaicCovers: string[][]
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
  /** Candidatas de capa DESTA obra (ver MAX_COVER_CANDIDATES). */
  coverUrls: string[]
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

/**
 * Itens (obra↔grupo) dos grupos informados, PAGINADO.
 *
 * ⚠️ Era um `.select("list_id, work_id")` cru, e o PostgREST corta em 1000 linhas sem avisar.
 * Com o teto estourado, um grupo grande perderia membros no card — e, pior, o "Sem grupo"
 * passaria a listar como solta uma obra que ESTÁ num grupo (o conjunto de agrupadas viria
 * truncado). Erro que produz resultado, o padrão mais caro deste projeto.
 *
 * Escopado por `list_id`: os grupos já vêm filtrados pelo dono, então isto nunca varre os
 * itens de outra pessoa.
 */
async function fetchListItems(
  supabase: ReturnType<typeof createAdminClient>,
  listIds: string[],
): Promise<Array<{ list_id: string; work_id: string }>> {
  if (listIds.length === 0) return []
  return fetchAllRows<{ list_id: string; work_id: string }>(
    (from, to) =>
      supabase
        .from("work_list_items")
        .select("list_id, work_id")
        .in("list_id", listIds)
        .order("list_id", { ascending: true })
        .order("position", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: Array<{ list_id: string; work_id: string }> | null
        error: { message: string } | null
      }>,
    "work_list_items",
  )
}

/** Resumo agregado (Nota Prevista média + top-3 critérios) de um conjunto de obras.
 *
 *  `scores` sobrepõe a Nota Prevista PESSOAL de quem está olhando: `calculated_scores` na
 *  linha de `works` é a do DONO. Sem o overlay, a Leitora abria /favoritos e via a média
 *  prevista DELE estampada nos grupos dela — número plausível, silenciosamente errado. */
function summarizeWorks(rows: WorkRow[], scores: ScoresReader): FavoritesSummary {
  let expectedSum = 0
  let expectedCount = 0
  const critSum = new Map<string, number>()
  const critCount = new Map<string, number>()

  for (const w of rows) {
    const f = scores.overlay(w.id, w.calculated_scores)?.expected_score
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

/**
 * Escolhe até 3 OBRAS pro mosaico do grupo: usa `coverWorkIds` na ordem escolhida;
 * senão as de maior Nota Prevista (ordenação padrão). Devolve as CANDIDATAS de cada
 * uma — `string[][]`, uma lista por slot —, então cada quadradinho do mosaico cai
 * pra próxima capa se a primeira morrer.
 *
 * ⚠️ Chamava-se `pickCoverUrls` e colidia com o `pickCoverUrls` de `lib/work-derived`,
 * que responde outra pergunta: aquele são as candidatas de UMA obra, este são obras
 * DIFERENTES. Mesmo nome para coisas diferentes é a família cara desta base — aqui
 * ainda por cima com assinaturas incompatíveis, o que só não quebrou porque a local
 * sombreava a importada dentro deste arquivo.
 */
function pickMosaicCovers(
  coverWorkIds: string[],
  memberRows: WorkRow[],
  byId: Map<string, WorkRow>,
): string[][] {
  const source =
    coverWorkIds.length > 0
      ? coverWorkIds.map((id) => byId.get(id)).filter((r): r is WorkRow => Boolean(r))
      : [...memberRows].sort(
          (a, b) =>
            (Number(b.calculated_scores?.expected_score ?? -Infinity)) -
            (Number(a.calculated_scores?.expected_score ?? -Infinity)),
        )
  const slots: string[][] = []
  for (const row of source) {
    const candidatas = coverCandidates(row.work_covers)
    if (candidatas.length > 0) slots.push(candidatas)
    if (slots.length >= 3) break
  }
  return slots
}

const WORK_SUMMARY_SELECT =
  "id, is_archived, calculated_scores(expected_score), category_scores(criterion_slug, score), work_covers(url, is_primary, position)"

/**
 * Carrega as linhas de resumo de um conjunto de obras, em blocos (o `.in("id")` com muitos
 * ids + embeds derruba o plano do PostgREST — ver `selectByIdsInChunks`).
 *
 * `hideAdult` tem que valer aqui pelo mesmo motivo do header de /favorites: o DETALHE
 * (getRanking) já esconde 18+ de quem desligou, então sem o filtro o card diria "14 obras" e
 * a lista abriria com 11. A contagem do card É a promessa do que o clique vai mostrar.
 */
async function loadWorkRows(
  supabase: ReturnType<typeof createAdminClient>,
  ids: string[],
  hideAdult: boolean,
  label: string,
): Promise<Map<string, WorkRow>> {
  const byId = new Map<string, WorkRow>()
  if (ids.length === 0) return byId

  const { data, error } = await selectByIdsInChunks<WorkRow>(ids, (chunk) => {
    let q = supabase.from("works").select(WORK_SUMMARY_SELECT).eq("is_archived", false).in("id", chunk)
    if (hideAdult) q = q.eq("is_adult", false)
    return q as unknown as PromiseLike<{ data: WorkRow[] | null; error: { message: string } | null }>
  })
  if (error) console.error(`[lists] erro lendo obras (${label}):`, error.message)
  for (const row of data) byId.set(row.id, row)
  return byId
}

/** Índice de grupos com resumo agregado. Uma varredura de itens + uma de obras. */
export async function getListsWithSummary(): Promise<WorkListSummary[]> {
  const supabase = createAdminClient()
  // Fatia 2b (mig 149): os grupos têm DONO. Sem este filtro, a Leitora abriria /favoritos e
  // veria os grupos DELE ("Comfort reads", "Pra maratonar") como se fossem dela.
  //
  // 🔴 O filtro existia e mesmo assim vazava: `getCurrentUserId()` devolve o DONO quando não há
  // sessão, então /favorites servia os grupos dele a VISITANTE ANÔNIMO — nomes das pastas,
  // contagens e médias, medido em 2026-08-03. Ver [[gotcha-anonimo-vira-dono]].
  const viewerId = await getSessionUserId()
  if (!viewerId) return []

  const listsRes = await supabase
    .from("work_lists")
    .select("id, name, description, color, cover_work_ids, comments, position, created_at")
    .eq("user_id", viewerId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: false })

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

  const items = await fetchListItems(supabase, lists.map((l) => l.id))
  const itemsByList = new Map<string, string[]>()
  for (const it of items) {
    const arr = itemsByList.get(it.list_id) ?? []
    arr.push(it.work_id)
    itemsByList.set(it.list_id, arr)
  }

  const allIds = Array.from(new Set(items.map((i) => i.work_id)))
  const [byId, scores] = await Promise.all([
    loadWorkRows(supabase, allIds, await getHideAdultContent(), "grupos"),
    getScoresReader(),
  ])

  return lists.map((list) => {
    // `memberIds` é a associação CRUA (inclui arquivada/18+-oculta) — é o que as operações de
    // membro precisam. `memberRows` já sai filtrado pelo que `loadWorkRows` deixou passar, e é
    // dele que sai a contagem do card: o número mostrado é o que o clique vai abrir.
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
      mosaicCovers: pickMosaicCovers(coverWorkIds, memberRows, byId),
      commentCount: (list.comments ?? []).length,
      ...summarizeWorks(memberRows, scores),
    }
  })
}

/**
 * Só o NOME do grupo — para o título da aba (`generateMetadata`).
 *
 * ⚠️ Não use `getListDetail` para isso: ele carrega as linhas de TODAS as obras membras, e o
 * `generateMetadata` roda numa passada separada da página. Seria o custo do grupo inteiro pago
 * duas vezes por visita, para escrever uma palavra na aba.
 *
 * Mesmo escopo por dono do `getListDetail`: um id não é segredo, e sem o `user_id` a aba
 * revelaria o nome do grupo de outra pessoa.
 */
export async function getListName(id: string): Promise<string | null> {
  const supabase = createAdminClient()
  const viewerId = await getSessionUserId()
  if (!viewerId) return null

  const { data } = await supabase
    .from("work_lists")
    .select("name")
    .eq("id", id)
    .eq("user_id", viewerId)
    .maybeSingle()

  return (data?.name as string | undefined) ?? null
}

/** Detalhe de um grupo: metadados + IDs (escopo do ranking) + resumo escopado. */
export async function getListDetail(id: string): Promise<WorkListDetail | null> {
  const supabase = createAdminClient()
  const viewerId = await getSessionUserId()
  if (!viewerId) return null

  // Escopado ao dono: sem isso, bastaria a URL /favorites/<id-de-um-grupo-dele> pra ela abrir
  // o grupo dele. Um id não é um segredo.
  const { data: list, error } = await supabase
    .from("work_lists")
    .select("id, name, description, color, cover_work_ids, comments")
    .eq("id", id)
    .eq("user_id", viewerId)
    .maybeSingle()

  if (error || !list) {
    if (error) console.error("[lists] erro lendo grupo:", error.message)
    return null
  }

  const workIds = (await fetchListItems(supabase, [id])).map((r) => r.work_id)
  const byId = await loadWorkRows(supabase, workIds, await getHideAdultContent(), "grupo")
  const memberRows = workIds.map((wid) => byId.get(wid)).filter((r): r is WorkRow => Boolean(r))

  return {
    id: list.id as string,
    name: list.name as string,
    description: (list.description ?? null) as string | null,
    color: (list.color ?? null) as string | null,
    coverWorkIds: ((list.cover_work_ids ?? []) as string[]),
    workIds,
    comments: ((list.comments ?? []) as ListComment[]),
    summary: summarizeWorks(memberRows, await getScoresReader()),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// "Sem grupo" — visão DERIVADA, não um `work_lists`.
// ────────────────────────────────────────────────────────────────────────────

export interface UngroupedFavorites {
  /** IDs das favoritas que não estão em nenhum grupo (escopo do ranking). */
  workIds: string[]
  /** Até 3 URLs de capa pro "cover stack" do card. */
  mosaicCovers: string[][]
  summary: FavoritesSummary
  /** Quantos grupos o usuário tem — 0 esconde o card (seria igual a "Todos os favoritos"). */
  groupCount: number
}

/**
 * Favoritas que não caíram em nenhum grupo: `favoritas − ∪(membros dos grupos)`.
 *
 * Não existe linha em `work_lists` pra isto — é calculado a cada leitura. Duas consequências
 * que valem lembrar: (a) não dá pra editar/excluir/comentar, e a UI não oferece; (b) o
 * conjunto se conserta sozinho quando uma obra entra num grupo ou deixa de ser favorita, sem
 * backfill nenhum.
 *
 * Arquivadas não entram (o `WORK_SUMMARY_SELECT` filtra `is_archived = false`), igual ao
 * resto de /favorites.
 */
export async function getUngroupedFavorites(): Promise<UngroupedFavorites> {
  const supabase = createAdminClient()
  const viewerId = await getSessionUserId()
  const empty: UngroupedFavorites = {
    workIds: [],
    mosaicCovers: [],
    summary: { total: 0, withExpectedScore: 0, avgExpectedScore: null, topCriteria: [] },
    groupCount: 0,
  }
  if (!viewerId) return empty

  const [listsRes, favoriteIds] = await Promise.all([
    supabase.from("work_lists").select("id").eq("user_id", viewerId),
    // Favoritas DE QUEM ESTÁ OLHANDO (user_work_state), não a coluna de `works`.
    resolvePersonalFilterIds({ onlyFavorites: true }),
  ])

  if (listsRes.error) {
    console.error("[lists] erro lendo grupos (sem grupo):", listsRes.error.message)
    return empty
  }
  const listIds = ((listsRes.data ?? []) as Array<{ id: string }>).map((l) => l.id)
  const groupCount = listIds.length

  if (!favoriteIds || favoriteIds.length === 0) return { ...empty, groupCount }

  const grouped = new Set((await fetchListItems(supabase, listIds)).map((r) => r.work_id))
  const candidates = favoriteIds.filter((id) => !grouped.has(id))
  if (candidates.length === 0) return { ...empty, groupCount }

  const byId = await loadWorkRows(supabase, candidates, await getHideAdultContent(), "sem grupo")
  // Filtrado pelo que `loadWorkRows` deixou passar (arquivada / 18+ oculta): a contagem do card
  // e o escopo do detalhe saem da MESMA lista, então não têm como divergir.
  const workIds = candidates.filter((id) => byId.has(id))
  const rows = workIds.map((id) => byId.get(id)!) as WorkRow[]

  return {
    workIds,
    mosaicCovers: pickMosaicCovers([], rows, byId),
    summary: summarizeWorks(rows, await getScoresReader()),
    groupCount,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Recorrência — em quantos recortes a mesma obra aparece.
//
// Uma obra pode estar em vários grupos (a tabela é M-pra-N desde a migration 123), e
// isso é sinal de CURADORIA: medido em 2026-08-15 sobre as 126 favoritas, a contagem
// tem correlação 0,13 com a Nota Prevista e 0,11 com o Alinhamento — quase ortogonal a
// ambos —, e separa 309 dos 481 pares empatados na Prevista exibida (64%). É por isso
// que ela vale como nível de ordenação e como linha do comparador.
//
// ⚠️ O que ela NÃO é: convergência de GOSTO. Os grupos misturam duas naturezas — uns
// descrevem a obra ("Spicy", "Fotos boas"), outros o estado dela no fluxo de quem
// organiza ("Lendo agora", "Next", "Ongoing"). Medido no mesmo dia: das 46 obras em 2+
// grupos, 8 são só-tema, 8 só-fluxo e 30 mistas — e a obra com mais grupos (5) tem
// quatro deles de fluxo. Daí o texto da UI falar em "recortes", nunca em gosto: a
// promessa maior seria falsa em 38 das 46. Separar as duas leituras exigiria marcar o
// TIPO do grupo (coluna nova em `work_lists`) — decidido em 2026-08-15 NÃO fazer agora.
// ────────────────────────────────────────────────────────────────────────────

/** Um grupo a que a obra pertence — o bastante para nomear e colorir no tooltip. */
export interface WorkGroupRef {
  id: string
  name: string
  color: string | null
}

/** Par de grupos em que o primeiro está INTEIRO dentro do segundo. */
export interface NestedGroupPair {
  innerId: string
  innerName: string
  innerCount: number
  outerId: string
  outerName: string
}

export interface GroupMembership {
  /** work_id → grupos do dono a que ela pertence, na ordem do índice. Record (não Map)
   *  porque atravessa a fronteira server→client até a célula da tabela. */
  byWork: Record<string, WorkGroupRef[]>
  /** Grupos 100% contidos em outro. Hoje 1 par em 33 (3%) — ver o aviso no card. */
  nested: NestedGroupPair[]
  /** Quantos grupos o dono tem. 0/1 desliga tudo que depende de recorrência. */
  totalGroups: number
}

const EMPTY_MEMBERSHIP: GroupMembership = { byWork: {}, nested: [], totalGroups: 0 }

/**
 * DONO ÚNICO de "em quais grupos esta obra está".
 *
 * 🔴 Existe para que a contagem que ORDENA, a que a célula MOSTRA, a do card derivado e a
 * do comparador saiam todas da mesma leitura. Quatro superfícies contando por conta
 * própria é a classe de erro mais cara desta base (ver "DOIS critérios para o MESMO
 * fato"): bastaria uma delas esquecer o filtro por dono, ou contar itens em vez de
 * grupos distintos, para duas telas discordarem sobre a mesma obra.
 *
 * `cache()` por requisição: o índice de /favorites chama isto, o `getMultiGroupFavorites`
 * consome daqui e a página de detalhe também — sem ele seriam três varreduras do mesmo
 * `work_list_items` na mesma renderização.
 *
 * Custo: ZERO consulta nova no fluxo de /favorites — `getListsWithSummary` e
 * `getListsForPicker` já paginavam esses mesmos itens e descartavam o vínculo.
 */
export const getGroupMembership = cache(async (): Promise<GroupMembership> => {
  const supabase = createAdminClient()
  // Mesmo gate do resto do arquivo: sem sessão não há grupos: `getCurrentUserId()` cairia
  // no dono e a contagem da visitante seria a DELE ([[gotcha-anonimo-vira-dono]]).
  const viewerId = await getSessionUserId()
  if (!viewerId) return EMPTY_MEMBERSHIP

  const listsRes = await supabase
    .from("work_lists")
    .select("id, name, color, position, created_at")
    .eq("user_id", viewerId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: false })

  if (listsRes.error) {
    console.error("[lists] erro lendo grupos (recorrência):", listsRes.error.message)
    return EMPTY_MEMBERSHIP
  }
  const lists = (listsRes.data ?? []) as Array<{ id: string; name: string; color: string | null }>
  if (lists.length === 0) return EMPTY_MEMBERSHIP

  const items = await fetchListItems(supabase, lists.map((l) => l.id))

  const byWork: Record<string, WorkGroupRef[]> = {}
  const membersByList = new Map<string, Set<string>>()
  const listById = new Map(lists.map((l) => [l.id, l]))

  for (const it of items) {
    const list = listById.get(it.list_id)
    if (!list) continue
    // A PK é (list_id, work_id), então não há repetição a deduplicar — mas a ordem sai
    // do `fetchListItems`, que já vem ordenado por lista: o tooltip lista os grupos na
    // mesma ordem do índice, e não na ordem em que a obra entrou em cada um.
    ;(byWork[it.work_id] ??= []).push({ id: list.id, name: list.name, color: list.color })
    let members = membersByList.get(it.list_id)
    if (!members) {
      members = new Set<string>()
      membersByList.set(it.list_id, members)
    }
    members.add(it.work_id)
  }

  // Grupo contido em outro: para essas obras, "2 grupos" não é convergência nenhuma — é o
  // mesmo recorte contado duas vezes. Medido na nuvem em 2026-08-15: `Best Spicy` (13) está
  // 100% dentro de `Spicy` (53), e é o ÚNICO par assim em 33 pares possíveis.
  const nested: NestedGroupPair[] = []
  for (const inner of lists) {
    const si = membersByList.get(inner.id)
    if (!si || si.size === 0) continue
    for (const outer of lists) {
      if (inner.id === outer.id) continue
      const so = membersByList.get(outer.id)
      if (!so || si.size > so.size) continue
      // Grupos de mesmo tamanho são iguais quando um contém o outro: reporta uma vez só,
      // senão os dois cards acusariam um ao outro.
      if (si.size === so.size && inner.id >= outer.id) continue
      let contained = true
      for (const w of si) {
        if (!so.has(w)) {
          contained = false
          break
        }
      }
      if (contained) {
        nested.push({
          innerId: inner.id,
          innerName: inner.name,
          innerCount: si.size,
          outerId: outer.id,
          outerName: outer.name,
        })
      }
    }
  }

  return { byWork, nested, totalGroups: lists.length }
})

/** Só a contagem, na forma que o `getRanking` consegue ordenar (Record serializável).
 *  DERIVADO do mapa acima, nunca contado de novo — é o que impede a coluna mostrar "3"
 *  e a ordenação usar outro número. */
export function groupCountsFrom(membership: GroupMembership): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [workId, groups] of Object.entries(membership.byWork)) out[workId] = groups.length
  return out
}

export interface MultiGroupFavorites {
  /** IDs das obras em 2+ grupos, já ordenadas por recorrência desc (escopo do ranking). */
  workIds: string[]
  mosaicCovers: string[][]
  summary: FavoritesSummary
  /** Maior nº de grupos de uma obra — só para o card dizer até onde vai. */
  maxGroups: number
}

/**
 * Visão DERIVADA "Em vários grupos": as favoritas que aparecem em 2+ recortes.
 *
 * Irmã de `getUngroupedFavorites` — as duas respondem perguntas opostas sobre a mesma
 * coleção ("o que falta organizar" × "onde os recortes se cruzam") e nenhuma das duas tem
 * linha em `work_lists`, então não há o que editar, comentar ou excluir.
 *
 * O corte é 2+, sem limiar inventado: quem destaca é a ORDENAÇÃO. Medido em 2026-08-15,
 * 2+ são 46 obras (37% das favoritas) — é justamente por ser tão comum que a recorrência
 * é número e não chip aceso na lista.
 */
export async function getMultiGroupFavorites(): Promise<MultiGroupFavorites> {
  const empty: MultiGroupFavorites = {
    workIds: [],
    mosaicCovers: [],
    summary: { total: 0, withExpectedScore: 0, avgExpectedScore: null, topCriteria: [] },
    maxGroups: 0,
  }

  const membership = await getGroupMembership()
  // Com um grupo só, "vários" não existe — e o card não deve aparecer.
  if (membership.totalGroups < 2) return empty

  const candidates = Object.entries(membership.byWork)
    .filter(([, groups]) => groups.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([workId]) => workId)
  if (candidates.length === 0) return empty

  const supabase = createAdminClient()
  const byId = await loadWorkRows(supabase, candidates, await getHideAdultContent(), "vários grupos")
  // Mesma disciplina do "Sem grupo": a contagem do card e o escopo do detalhe saem da MESMA
  // lista filtrada, então não têm como divergir — o número no card é o que o clique abre.
  const workIds = candidates.filter((id) => byId.has(id))
  if (workIds.length === 0) return empty
  const rows = workIds.map((id) => byId.get(id)!) as WorkRow[]

  return {
    workIds,
    // Capas das MAIS recorrentes (workIds já vem nessa ordem), não das de maior nota: o card
    // é sobre recorrência, e `pickMosaicCovers` sem ids explícitos reordenaria por Prevista.
    mosaicCovers: pickMosaicCovers(workIds.slice(0, 3), rows, byId),
    summary: summarizeWorks(rows, await getScoresReader()),
    maxGroups: membership.byWork[workIds[0]]?.length ?? 0,
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
  const viewerId = await getSessionUserId()
  if (!viewerId) return []

  const listsRes = await supabase
    .from("work_lists")
    .select("id, name, color, position, created_at")
    .eq("user_id", viewerId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: false })
  if (listsRes.error) {
    console.error("[lists] erro lendo grupos (picker):", listsRes.error.message)
    return []
  }
  const lists = (listsRes.data ?? []) as Array<{ id: string; name: string; color: string | null }>
  const items = await fetchListItems(supabase, lists.map((l) => l.id))

  const counts = new Map<string, number>()
  for (const it of items) counts.set(it.list_id, (counts.get(it.list_id) ?? 0) + 1)
  return lists.map((l) => ({ id: l.id, name: l.name, color: l.color, count: counts.get(l.id) ?? 0 }))
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
  // O `if (!viewerId)` abaixo era LETRA MORTA: `getCurrentUserId()` nunca devolve null (cai no
  // dono ou estoura). Guard presente, proteção nenhuma — só com `getSessionUserId()` ele passa
  // a valer de fato.
  const viewerId = await getSessionUserId()
  if (!viewerId) return { folders: [], memberOf: [] }

  const listsRes = await supabase
    .from("work_lists")
    .select("id, name, color, position, created_at")
    .eq("user_id", viewerId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: false })

  if (listsRes.error) {
    console.error("[lists] erro lendo menu de pastas:", listsRes.error.message)
    return { folders: [], memberOf: [] }
  }

  const lists = (listsRes.data ?? []) as Array<{ id: string; name: string; color: string | null }>
  // Itens já escopados aos grupos DELE — não precisa mais interseccionar depois.
  const items = await fetchListItems(supabase, lists.map((l) => l.id))

  const counts = new Map<string, number>()
  for (const it of items) counts.set(it.list_id, (counts.get(it.list_id) ?? 0) + 1)

  const memberOf = Array.from(
    new Set(items.filter((it) => it.work_id === workId).map((it) => it.list_id)),
  )

  const folders: ListPickerOption[] = lists.map((l) => ({
    id: l.id,
    name: l.name,
    color: l.color,
    count: counts.get(l.id) ?? 0,
  }))

  return { folders, memberOf }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// ESCRITA — grupo ⊂ favoritos
//
// ⚠️ Isto NÃO é uma server action (o arquivo não tem "use server") — é chamado de DENTRO
// delas, com o gate já verificado no call site. Exportar daqui um "apague as pastas de
// alguém" viraria endpoint HTTP público; aqui, o cliente de SESSÃO faz o Postgres escopar
// pela RLS da mig 149 (só grupos com `user_id = auth.uid()`).
// ═══════════════════════════════════════════════════════════════════════════════════════

/**
 * Tira as obras de TODAS as pastas de quem chamou. É a outra metade do invariante "grupo ⊂
 * favoritos": desfavoritou, some das pastas — senão sobra o estado órfão "está na pasta mas
 * não é favorita", que fazia a obra continuar listada no grupo depois de desfavoritada.
 *
 * Sem filtro de `list_id` de propósito: a RLS de `work_list_items` só deixa apagar itens de
 * grupos DELE, então isto nunca alcança a pasta de outra pessoa.
 */
export async function purgeWorksFromAllLists(workIds: string[]): Promise<{ error?: string }> {
  const ids = Array.from(new Set(workIds.filter(Boolean)))
  if (ids.length === 0) return {}
  const supabase = await createUserClient()
  const { error } = await supabase.from("work_list_items").delete().in("work_id", ids)
  return error ? { error: error.message } : {}
}

/** Quantas das obras informadas estão em ao menos uma pasta do usuário, e em quantas linhas
 *  de pasta no total. Alimenta o aviso do "Desfavoritar N" — como refavoritar NÃO devolve a
 *  obra ao grupo, o lote precisa dizer o que está prestes a se perder. */
export async function countWorksInLists(
  workIds: string[],
): Promise<{ works: number; memberships: number }> {
  const ids = Array.from(new Set(workIds.filter(Boolean)))
  if (ids.length === 0) return { works: 0, memberships: 0 }

  const viewerId = await getSessionUserId() // idem getFavoriteFolderMenu: o guard só vale com este
  if (!viewerId) return { works: 0, memberships: 0 }

  const supabase = createAdminClient()
  const { data, error } = await supabase.from("work_lists").select("id").eq("user_id", viewerId)
  if (error) {
    console.error("[lists] erro contando pastas:", error.message)
    return { works: 0, memberships: 0 }
  }
  const listIds = ((data ?? []) as Array<{ id: string }>).map((l) => l.id)
  const wanted = new Set(ids)
  const hits = (await fetchListItems(supabase, listIds)).filter((it) => wanted.has(it.work_id))

  return { works: new Set(hits.map((h) => h.work_id)).size, memberships: hits.length }
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
      coverUrls: coverCandidates(w.work_covers),
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

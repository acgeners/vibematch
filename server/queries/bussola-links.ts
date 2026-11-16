import "server-only"

import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { SCORING_CRITERION_SLUGS } from "@/lib/calculations/scoring-features"
import { isMixedEditionState } from "@/lib/editions/mixed-edition"
import {
  PROFILE_LIST_MAX,
  SIMILAR_LIMIT,
  profileNeighbors,
  type AttributeVectorRow,
  type BussolaLinkedWork,
  type BussolaLinks,
} from "@/lib/ranking/bussola-links"
import { getGroupMembership } from "@/server/queries/lists"
import { getHideAdultContent, getSessionUserId } from "@/server/queries/current-user"

/** O que `find_similar_works` devolve e esta leitura usa (o resto do RETURNS TABLE fica de fora). */
interface SimilarRow {
  id: string
  title: string
  similarity: number
}

interface WorkMetaRow {
  id: string
  title: string
  is_adult: boolean | null
  edition_state: string | null
}

interface ScoreRow {
  work_id: string
  criterion_slug: string
  score: number | null
}

interface CatalogIndex {
  /** Obras ativas do catálogo (título e selo), para dar nome às ligações. */
  works: BussolaLinkedWork[]
  /** As 9 notas de cálculo, só das obras que têm as 9. */
  vectors: AttributeVectorRow[]
}

const toLinked = (r: WorkMetaRow): BussolaLinkedWork => ({
  id: r.id,
  title: r.title,
  isAdult: r.is_adult === true,
  isMixed: isMixedEditionState(r.edition_state),
})

/**
 * Índice do catálogo para as ligações: títulos e o vetor das 9 notas de cada obra ativa. É
 * catálogo (sem dado pessoal), então cabe em cache compartilhado; 1h de validade porque as notas
 * mudam por reavaliação, que é rara, e um "mesmo perfil" de uma hora atrás não engana ninguém.
 *
 * ⚠️ PAGINA as duas leituras: `category_scores` tem ~10k linhas e `works` passou de 1000. Sem
 * isso o perfil seria calculado sobre um recorte, sem erro nem aviso.
 */
const getCatalogIndex = unstable_cache(
  async (): Promise<CatalogIndex> => {
    const supabase = createAdminClient()
    const [workRows, scoreRows] = await Promise.all([
      fetchAllRows<WorkMetaRow>(
        () => supabase.from("works").select("id, title, is_adult, edition_state").eq("is_archived", false),
        { orderBy: ["id"], label: "bussola: obras" },
      ),
      fetchAllRows<ScoreRow>(
        () =>
          supabase
            .from("category_scores")
            .select("work_id, criterion_slug, score")
            .in("criterion_slug", [...SCORING_CRITERION_SLUGS]),
        { orderBy: ["work_id", "criterion_slug"], label: "bussola: notas" },
      ),
    ])

    const works = workRows.map(toLinked)
    const slot = new Map<string, number>(SCORING_CRITERION_SLUGS.map((s, i) => [s, i]))
    const byWork = new Map<string, Array<number | null>>()
    for (const r of scoreRows) {
      const i = slot.get(r.criterion_slug)
      if (i == null) continue
      const v = byWork.get(r.work_id) ?? Array<number | null>(SCORING_CRITERION_SLUGS.length).fill(null)
      v[i] = r.score == null ? null : Number(r.score)
      byWork.set(r.work_id, v)
    }
    const vectors: AttributeVectorRow[] = []
    for (const w of works) {
      const v = byWork.get(w.id)
      if (!v || v.some((x) => x == null || !Number.isFinite(x))) continue
      vectors.push({ ...w, vector: v as number[] })
    }
    return { works, vectors }
  },
  ["bussola-catalog-index-v1"],
  { revalidate: 3600 },
)

/**
 * As ligações de uma obra para o painel da Bússola. As de catálogo (parecidas, mesmo perfil) são
 * iguais para todo mundo; as de grupo são de QUEM OLHA, e sem sessão não existem (`null`). Quem
 * esconde 18+ não vê obra 18+ em nenhuma das listas — o mapa já a tirava, e o painel listaria o
 * que a pessoa pediu para não ver.
 */
export async function getBussolaLinksFor(workId: string): Promise<BussolaLinks> {
  const supabase = createAdminClient()
  const [index, hideAdult, viewerId, similarRes] = await Promise.all([
    getCatalogIndex(),
    getHideAdultContent(),
    getSessionUserId(),
    supabase.rpc("find_similar_works", { target_work_id: workId, match_limit: SIMILAR_LIMIT }),
  ])

  const meta = new Map(index.works.map((w) => [w.id, w]))
  const visible = (w: { isAdult: boolean }) => !(hideAdult && w.isAdult)

  if (similarRes.error) console.warn("[bussola] find_similar_works falhou:", similarRes.error.message)
  const similarRows = ((similarRes.data as SimilarRow[] | null) ?? [])
  const similar = similarRows
    .map((r) => {
      const m = meta.get(r.id)
      return {
        id: r.id,
        title: m?.title ?? r.title,
        isAdult: m?.isAdult ?? false,
        isMixed: m?.isMixed ?? false,
        similarity: Number(r.similarity),
      }
    })
    .filter(visible)

  const allProfile = profileNeighbors(index.vectors, workId)
  const profileVisible = allProfile?.filter(visible) ?? null

  let groups: BussolaLinks["groups"] = null
  if (viewerId) {
    const membership = await getGroupMembership()
    const mine = new Set((membership.byWork[workId] ?? []).map((g) => g.id))
    const shared = new Map<string, string[]>()
    if (mine.size > 0) {
      for (const [otherId, refs] of Object.entries(membership.byWork)) {
        if (otherId === workId) continue
        const names = refs.filter((g) => mine.has(g.id)).map((g) => g.name)
        if (names.length) shared.set(otherId, names)
      }
    }
    const missing = [...shared.keys()].filter((id) => !meta.has(id))
    if (missing.length > 0) {
      // Obra entrou no catálogo depois do índice em cache: busca só ela (no máximo um punhado).
      const { data, error } = await supabase
        .from("works")
        .select("id, title, is_adult, edition_state")
        .eq("is_archived", false)
        .in("id", missing)
      if (error) console.warn("[bussola] obras de grupo fora do índice:", error.message)
      for (const r of (data as WorkMetaRow[] | null) ?? []) meta.set(r.id, toLinked(r))
    }
    groups = [...shared.entries()]
      .map(([id, names]) => {
        const m = meta.get(id)
        return m ? { ...m, groups: names } : null
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .filter(visible)
  }

  return {
    similar,
    profile: profileVisible ? profileVisible.slice(0, PROFILE_LIST_MAX) : null,
    profileTotal: profileVisible?.length ?? 0,
    groups,
  }
}

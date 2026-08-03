import { unstable_cache } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { CRITERION_SLUGS, type CriterionSlug } from "@/types/domain"
import { getPersonalStateReader, resolvePersonalFilterIds } from "@/server/queries/user-work-state"
import { getScoresReader } from "@/server/queries/user-scores"
import { getHideAdultContent } from "@/server/queries/current-user"

export interface FavoritesSummary {
  total: number
  withExpectedScore: number
  avgExpectedScore: number | null
  topCriteria: Array<{ slug: CriterionSlug; avg: number; n: number }>
}

/**
 * Stats agregados dos favoritos DO USUÁRIO ATUAL. Reflete a biblioteca inteira de favoritos
 * (não respeita filtros aplicados na página) — usado pra contexto rápido no header de
 * /favorites.
 *
 * `favoriteIds` são os ids vindos de `user_work_state` — de TODO MUNDO, o dono inclusive
 * (Fase D). Lista vazia = zero favoritos, e o resultado tem que ser vazio DE VERDADE: era um
 * `null` que caía num `.eq("is_favorite", true)` sobre `works`, ou seja, sobre os favoritos
 * DELE. `null` aqui já não acontece (o caller sempre pede o filtro), mas se acontecesse seria
 * "sem favorito", nunca "o catálogo inteiro".
 */
async function _getFavoritesSummary(
  favoriteIds: string[] | null,
  hideAdult: boolean,
): Promise<FavoritesSummary> {
  const empty = { total: 0, withExpectedScore: 0, avgExpectedScore: null, topCriteria: [] }
  if (!favoriteIds || favoriteIds.length === 0) return empty

  const supabase = createAdminClient()

  let query = supabase
    .from("works")
    .select(`
      id,
      calculated_scores(expected_score),
      category_scores(criterion_slug, score)
    `)
    .eq("is_archived", false)
    .in("id", favoriteIds)
  // Parity com a lista de favoritos (getRanking): quem oculta 18+ não conta obras
  // adultas no header também, senão o "N favoritos" não bate com a lista exibida.
  // hideAdult vem por PARÂMETRO — resolvê-lo aqui dentro leria cookies() no callback
  // do unstable_cache (fora do request scope) e quebraria.
  if (hideAdult) query = query.eq("is_adult", false)
  const { data: works, error } = await query

  if (error) {
    console.error("[favorites] erro lendo stats:", error)
    return empty
  }

  const rows = (works ?? []) as unknown as Array<{
    id: string
    calculated_scores: { expected_score: number | null } | null
    category_scores: Array<{ criterion_slug: string; score: number | null }> | null
  }>

  // Fatia 2b: a média de Nota Prevista dos favoritos DELA tem que sair dos scores DELA.
  const scoresReader = await getScoresReader()

  let expectedSum = 0
  let expectedCount = 0
  const critSum = new Map<string, number>()
  const critCount = new Map<string, number>()
  for (const w of rows) {
    const f = scoresReader.overlay(w.id, w.calculated_scores)?.expected_score
    if (f != null) {
      expectedSum += Number(f)
      expectedCount += 1
    }
    for (const cs of w.category_scores ?? []) {
      if (cs.score == null) continue
      const slug = cs.criterion_slug
      critSum.set(slug, (critSum.get(slug) ?? 0) + Number(cs.score))
      critCount.set(slug, (critCount.get(slug) ?? 0) + 1)
    }
  }

  const validSlugs = new Set<string>(CRITERION_SLUGS)
  const avgByCriterion: Array<{ slug: CriterionSlug; avg: number; n: number }> = []
  for (const [slug, sum] of critSum) {
    if (!validSlugs.has(slug)) continue
    const n = critCount.get(slug) ?? 0
    if (n === 0) continue
    avgByCriterion.push({ slug: slug as CriterionSlug, avg: sum / n, n })
  }
  avgByCriterion.sort((a, b) => b.avg - a.avg)

  return {
    total: rows.length,
    withExpectedScore: expectedCount,
    avgExpectedScore: expectedCount > 0 ? expectedSum / expectedCount : null,
    topCriteria: avgByCriterion.slice(0, 3),
  }
}

/**
 * ⚠️ O `userId` PRECISA entrar na chave do cache.
 *
 * Isto era `unstable_cache(fn, ["favorites-summary"])` — uma chave GLOBAL para um dado que
 * agora é per-usuário. O primeiro a abrir /favorites populava o cache e os próximos 5 minutos
 * serviam os favoritos DELE para todo mundo, sem erro e sem log. Chave global + dado pessoal
 * é vazamento por construção.
 *
 * A tag continua a mesma (`favorites-summary`), então `revalidateTag` invalida as chaves de
 * todos os usuários de uma vez — que é o que os writers já fazem.
 */
export async function getFavoritesSummary(): Promise<FavoritesSummary> {
  const [reader, favoriteIds, hideAdult] = await Promise.all([
    getPersonalStateReader(),
    resolvePersonalFilterIds({ onlyFavorites: true }),
    getHideAdultContent(),
  ])

  // hideAdult entra na CHAVE do cache: sem isso, ligar/desligar o toggle serviria
  // o contador antigo por até 5 min (a chave é por usuário, não pela preferência).
  //
  // ⚠️ `"anon"` para quem não tem sessão. Enquanto `reader.userId` devolvia o id do DONO para o
  // anônimo, a chave do visitante era a MESMA do dono — e o `unstable_cache` servia o resumo de
  // favoritos dele a quem passasse. Compartilhar uma chave entre todos os anônimos é seguro
  // (o estado deles é igual: vazio); compartilhar com o dono é o vazamento.
  const cacheOwner = reader.userId ?? "anon"

  return unstable_cache(
    () => _getFavoritesSummary(favoriteIds, hideAdult),
    ["favorites-summary", cacheOwner, hideAdult ? "noadult" : "all"],
    { revalidate: 300, tags: ["favorites-summary"] },
  )()
}

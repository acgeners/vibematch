import { CRITERION_SLUGS } from "@/types/domain"
import type { RankingFilters } from "@/server/queries/ranking"

/**
 * Converte uma URLSearchParams da página /ranking em RankingFilters. Compartilhado
 * entre componentes que querem rodar algo (LLM rerank, recomendação) respeitando
 * o filtro que o usuário tem aplicado naquele momento.
 */
export function parseFiltersFromSearchParams(sp: URLSearchParams): RankingFilters {
  const num = (key: string) => {
    const v = sp.get(key)
    if (!v) return undefined
    const n = parseFloat(v)
    return Number.isFinite(n) ? n : undefined
  }
  const multi = (key: string) => {
    const v = sp.get(key)
    if (!v) return undefined
    return v.split(",").map((s) => s.trim()).filter(Boolean)
  }

  const criterionMin: Partial<Record<string, number>> = {}
  const criterionMax: Partial<Record<string, number>> = {}
  for (const slug of CRITERION_SLUGS) {
    const mn = num(`min_${slug}`)
    const mx = num(`max_${slug}`)
    if (mn != null) criterionMin[slug] = mn
    if (mx != null) criterionMax[slug] = mx
  }

  const perStatusParam = sp.get("per_status")
  const personalStatus =
    perStatusParam === "all"
      ? undefined
      : perStatusParam
        ? perStatusParam.split(",").map((s) => s.trim()).filter(Boolean)
        : ["Want to Read", "Untracked"]

  const pubStatusParam = sp.get("pub_status")
  const publicationStatus =
    pubStatusParam === "all"
      ? undefined
      : pubStatusParam
        ? pubStatusParam.split(",").map((s) => s.trim()).filter(Boolean)
        : ["Completed"]

  return {
    criterionMin: Object.keys(criterionMin).length ? criterionMin : undefined,
    criterionMax: Object.keys(criterionMax).length ? criterionMax : undefined,
    publicationStatus,
    personalStatus: personalStatus?.length ? personalStatus : undefined,
    genreAll: multi("genres_all"),
    genreAny: multi("genres_any") ?? multi("genres"),
    genreExclude: multi("genres_exclude"),
    tagSlugsAll: multi("tags_all"),
    tagSlugsAny: multi("tags_any") ?? multi("tags"),
    tagSlugsExclude: multi("tags_exclude"),
    synopsisQualities: multi("synopsis_q"),
    minTotalChapters: num("min_chapters"),
    maxTotalChapters: num("max_chapters"),
    minYear: num("min_year"),
    maxYear: num("max_year"),
    minExpectedScore: num("min_expected"),
    maxExpectedScore: num("max_expected"),
    minPersonalFitPct: num("min_fit"),
    maxPersonalFitPct: num("max_fit"),
    minAlignment: num("min_align"),
    maxAlignment: num("max_align"),
    minPlatformAvg: num("min_platform_avg"),
    maxPlatformAvg: num("max_platform_avg"),
    minTotalVotes: num("min_votes"),
    maxTotalVotes: num("max_votes"),
    onlyWithFinalScore: sp.get("only_scored") === "1",
    onlyFavorites: sp.get("fav") === "1",
  }
}

export function describeRankingFilters(filters: RankingFilters): string {
  const parts: string[] = []
  if (filters.genreAny?.length) parts.push(`gêneros: ${filters.genreAny.join(", ")}`)
  if (filters.tagSlugsAny?.length) parts.push(`tags: ${filters.tagSlugsAny.join(", ")}`)
  if (filters.publicationStatus?.length)
    parts.push(`pub: ${filters.publicationStatus.join(", ")}`)
  if (filters.personalStatus?.length) parts.push(`status: ${filters.personalStatus.join(", ")}`)
  return parts.length > 0 ? parts.join(" | ") : "sem filtros específicos"
}

import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"

const ANILIST_URL = "https://graphql.anilist.co"

const SEARCH_QUERY = `
query SearchManga($search: String) {
  Page(page: 1, perPage: 10) {
    media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
      id
      idMal
      title { romaji english native }
      synonyms
      description(asHtml: false)
      coverImage { large }
      status
      chapters
      startDate { year }
      endDate { year }
      genres
      tags { name category isGeneralSpoiler }
      meanScore
      popularity
    }
  }
}
`

const DETAIL_QUERY = `
query GetManga($id: Int) {
  Media(id: $id, type: MANGA) {
    id
    title { romaji english native }
    description(asHtml: false)
    coverImage { large }
    status
    chapters
    startDate { year }
    endDate { year }
    genres
    tags { name category isGeneralSpoiler }
    meanScore
    popularity
    stats { scoreDistribution { score amount } }
  }
}
`

function mapStatus(status: string): PublicationStatus {
  switch (status) {
    case "FINISHED": return "Completed"
    case "RELEASING": return "Ongoing"
    case "HIATUS": return "Hiatus"
    case "CANCELLED": return "Cancelled"
    default: return "Unknown"
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseMedia(m: any) {
  const title = m.title?.english ?? m.title?.romaji ?? m.title?.native ?? ""
  const originalTitle = m.title?.native ?? undefined
  const synonyms: string[] = Array.isArray(m.synonyms)
    ? (m.synonyms as unknown[]).filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : []
  const alternativeTitles = [
    m.title?.english,
    m.title?.romaji,
    m.title?.native,
    ...synonyms,
  ].filter((item): item is string => Boolean(item && item !== title))

  const rawDesc: string = m.description ?? ""
  const synopsis = rawDesc
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim() || undefined

  const genres: string[] = m.genres ?? []
  const tags: string[] = (m.tags ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((t: any) => !t.isGeneralSpoiler)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((t: any) => t.name as string)
    .slice(0, 20)

  return {
    id: m.id as number,
    malId: typeof m.idMal === "number" ? m.idMal : undefined,
    title,
    originalTitle,
    alternativeTitles,
    synopsis,
    coverUrl: m.coverImage?.large ?? undefined,
    year: m.startDate?.year ?? undefined,
    yearEnd: m.endDate?.year ?? undefined,
    status: mapStatus(m.status),
    chapters: m.chapters ?? undefined,
    genres,
    tags,
    score: m.meanScore != null ? Math.round((m.meanScore / 10) * 10) / 10 : undefined,
    // Real vote count = sum of users in scoreDistribution. AniList "popularity" is the
    // total list-add count (followers), not the rating sample size — different signal.
    votes: (() => {
      const dist = m.stats?.scoreDistribution as Array<{ score?: number; amount?: number }> | undefined
      if (!Array.isArray(dist) || dist.length === 0) {
        return typeof m.popularity === "number" ? m.popularity : undefined
      }
      const total = dist.reduce((sum, entry) => sum + (typeof entry?.amount === "number" ? entry.amount : 0), 0)
      return total > 0 ? total : undefined
    })(),
  }
}

async function anilistRequest(query: string, variables: Record<string, unknown>, label = "anilist") {
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  })
  if (!res.ok) {
    console.warn(`[anilist:${label}] request falhou: HTTP ${res.status}`)
    return null
  }
  return res.json()
}

export async function searchAniList(search: string): Promise<ExternalSearchResult[]> {
  try {
    const json = await anilistRequest(SEARCH_QUERY, { search }, "search")
    const media: unknown[] = json?.data?.Page?.media ?? []
    return media.map((m) => {
      const p = parseMedia(m)
      return {
        id: `anilist:${p.id}`,
        source: "anilist" as const,
        title: p.title,
        originalTitle: p.originalTitle,
        alternativeTitles: p.alternativeTitles,
        synopsis: p.synopsis,
        coverUrl: p.coverUrl,
        year: p.year,
        yearEnd: p.yearEnd,
        publicationStatus: p.status,
        chapters: p.chapters,
        score: p.score,
        votes: p.votes,
        genres: p.genres,
        crossIds: p.malId != null ? { myanimelist: String(p.malId) } : undefined,
      }
    })
  } catch {
    return []
  }
}

export async function fetchAniListById(anilistId: number) {
  try {
    const json = await anilistRequest(DETAIL_QUERY, { id: anilistId }, "detail")
    const m = json?.data?.Media
    if (!m) return null
    return parseMedia(m)
  } catch {
    return null
  }
}

const REVIEWS_QUERY = `
query GetMangaReviews($id: Int) {
  Media(id: $id, type: MANGA) {
    reviews(sort: SCORE_DESC, perPage: 50) {
      nodes {
        summary
        body(asHtml: false)
        score
      }
    }
  }
}
`

const RECOMMENDATIONS_QUERY = `
query GetRecommendations($id: Int) {
  Media(id: $id, type: MANGA) {
    recommendations(sort: RATING_DESC, perPage: 10) {
      nodes {
        rating
        mediaRecommendation {
          title { romaji english }
          genres
          tags(sort: RANK_DESC) { name rank isGeneralSpoiler }
        }
      }
    }
  }
}
`

export interface AniListRecommendation {
  title: string
  genres: string[]
  tags: string[]
  /** Rating dado pela comunidade AniList à recomendação (>0 = upvoted). */
  rating: number
}

export async function fetchAniListRecommendations(anilistId: number): Promise<AniListRecommendation[]> {
  try {
    const json = await anilistRequest(RECOMMENDATIONS_QUERY, { id: anilistId }, "recommendations")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodes: any[] = json?.data?.Media?.recommendations?.nodes ?? []
    return nodes
      .map((node): AniListRecommendation | null => {
        const media = node?.mediaRecommendation
        if (!media) return null
        const title = media.title?.english ?? media.title?.romaji ?? null
        if (!title) return null
        const genres: string[] = Array.isArray(media.genres) ? media.genres : []
        const tags: string[] = Array.isArray(media.tags)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? media.tags.filter((t: any) => !t.isGeneralSpoiler).slice(0, 5).map((t: any) => t.name as string)
          : []
        const rating = typeof node.rating === "number" ? node.rating : 0
        return { title, genres, tags, rating }
      })
      .filter((entry): entry is AniListRecommendation => entry !== null)
      .filter((entry) => entry.rating > 0)
      .slice(0, 10)
  } catch {
    return []
  }
}

export async function fetchAniListReviews(anilistId: number): Promise<string[]> {
  try {
    const json = await anilistRequest(REVIEWS_QUERY, { id: anilistId }, "reviews")
    if (json && json?.data?.Media == null) {
      console.warn(`[fetchAniListReviews] AniList id=${anilistId}: Media null (possível id de ANIME — a query usa type: MANGA)`)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodes: any[] = json?.data?.Media?.reviews?.nodes ?? []
    return nodes
      .map((r) => {
        const summary = r.summary?.trim()
        const body = r.body?.replace(/<[^>]+>/g, "").trim()
        const text = [summary, body].filter(Boolean).join("\n").slice(0, 900)
        if (!text) return ""
        // score 0-100 → prefixo "Nota do usuário: X/10\n" para extractUserRating()
        const score10 = typeof r.score === "number" && r.score > 0
          ? Math.round(r.score / 10 * 10) / 10
          : null
        return score10 !== null ? `Nota do usuário: ${score10}/10\n${text}` : text
      })
      .filter(Boolean)
  } catch (err) {
    console.warn(`[fetchAniListReviews] AniList id=${anilistId} falhou:`, err instanceof Error ? err.message : err)
    return []
  }
}

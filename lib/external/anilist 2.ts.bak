import type { PublicationStatus } from "@/types/domain"
import type { ExternalSearchResult } from "./types"

const ANILIST_URL = "https://graphql.anilist.co"

const SEARCH_QUERY = `
query SearchManga($search: String) {
  Page(page: 1, perPage: 10) {
    media(search: $search, type: MANGA, sort: SEARCH_MATCH) {
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
      averageScore
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
    averageScore
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
  const alternativeTitles = [
    m.title?.english,
    m.title?.romaji,
    m.title?.native,
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
    score: m.averageScore != null ? Math.round((m.averageScore / 10) * 10) / 10 : undefined,
  }
}

async function anilistRequest(query: string, variables: Record<string, unknown>) {
  const res = await fetch(ANILIST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  })
  if (!res.ok) return null
  return res.json()
}

export async function searchAniList(search: string): Promise<ExternalSearchResult[]> {
  try {
    const json = await anilistRequest(SEARCH_QUERY, { search })
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
        genres: p.genres,
      }
    })
  } catch {
    return []
  }
}

export async function fetchAniListById(anilistId: number) {
  try {
    const json = await anilistRequest(DETAIL_QUERY, { id: anilistId })
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
    reviews(sort: SCORE_DESC, perPage: 25) {
      nodes {
        summary
        body(asHtml: false)
      }
    }
  }
}
`

export async function fetchAniListReviews(anilistId: number): Promise<string[]> {
  try {
    const json = await anilistRequest(REVIEWS_QUERY, { id: anilistId })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nodes: any[] = json?.data?.Media?.reviews?.nodes ?? []
    return nodes
      .map((r) => {
        const summary = r.summary?.trim()
        const body = r.body?.replace(/<[^>]+>/g, "").trim()
        const text = [summary, body].filter(Boolean).join("\n")
        return text.slice(0, 900)
      })
      .filter(Boolean)
  } catch {
    return []
  }
}

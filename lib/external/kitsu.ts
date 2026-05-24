import type { PublicationStatus } from "@/types/domain"

const KITSU_BASE = "https://kitsu.io/api/edge"

const KITSU_HEADERS = {
  Accept: "application/vnd.api+json",
}

export interface KitsuMangaResult {
  id: string
  title: string
  alternativeTitles: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  chapters?: number
  averageRating?: number  // 0-100 from Kitsu, we keep raw
  userCount?: number
}

export interface KitsuMangaDetail {
  id: string
  title: string
  alternativeTitles: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  yearEnd?: number
  chapters?: number
  publicationStatus?: PublicationStatus
  /** 0-10 normalized from Kitsu's 0-100 averageRating */
  rating?: number
  /** userCount (people who added it to a library) — not exactly votes but the closest signal */
  votes?: number
  genres: string[]
}

function titleFromAttributes(attributes: Record<string, unknown>): string {
  const titles = attributes.titles as Record<string, string | undefined> | undefined
  return (
    titles?.en
    ?? attributes.canonicalTitle as string | undefined
    ?? titles?.en_us
    ?? titles?.en_jp
    ?? titles?.en_kr
    ?? ""
  )
}

function alternativeTitlesFromAttributes(attributes: Record<string, unknown>): string[] {
  const titles = attributes.titles as Record<string, string | undefined> | undefined
  const out: string[] = []
  if (titles) {
    for (const v of Object.values(titles)) if (v) out.push(v)
  }
  const abbreviated = attributes.abbreviatedTitles
  if (Array.isArray(abbreviated)) {
    for (const v of abbreviated) if (typeof v === "string") out.push(v)
  }
  return out
}

function cleanText(text: unknown): string {
  return String(text ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function statusFromKitsu(raw: unknown): PublicationStatus | undefined {
  if (typeof raw !== "string") return undefined
  switch (raw.toLowerCase()) {
    case "finished": return "Completed"
    case "current": return "Ongoing"
    case "tba":
    case "upcoming": return "Ongoing"
    case "unreleased": return "Unknown"
    case "hiatus": return "Hiatus"
    case "cancelled":
    case "discontinued": return "Cancelled"
    default: return "Unknown"
  }
}

function yearFromDate(date: unknown): number | undefined {
  if (typeof date !== "string" || date.length < 4) return undefined
  const n = parseInt(date.slice(0, 4), 10)
  return Number.isFinite(n) ? n : undefined
}

export async function searchKitsuManga(title: string): Promise<KitsuMangaResult[]> {
  try {
    const url = new URL(`${KITSU_BASE}/manga`)
    url.searchParams.set("filter[text]", title)
    url.searchParams.set(
      "fields[manga]",
      "canonicalTitle,titles,slug,synopsis,startDate,chapterCount,averageRating,userCount,posterImage",
    )
    url.searchParams.set("page[limit]", "5")

    const res = await fetch(url, {
      cache: "no-store",
      headers: KITSU_HEADERS,
    })
    if (!res.ok) return []

    const json = await res.json()
    const data: unknown[] = Array.isArray(json?.data) ? json.data : []

    return data
      .map((item) => {
        const record = item as { id?: string; attributes?: Record<string, unknown> }
        const attr = record.attributes ?? {}
        const poster = attr.posterImage as Record<string, string> | undefined
        const rawRating = attr.averageRating
        return {
          id: record.id ?? "",
          title: titleFromAttributes(attr),
          alternativeTitles: alternativeTitlesFromAttributes(attr),
          synopsis: cleanText(attr.synopsis),
          coverUrl: poster?.original ?? poster?.large ?? poster?.medium,
          year: yearFromDate(attr.startDate),
          chapters: typeof attr.chapterCount === "number" ? attr.chapterCount : undefined,
          averageRating: typeof rawRating === "string" ? parseFloat(rawRating) : (typeof rawRating === "number" ? rawRating : undefined),
          userCount: typeof attr.userCount === "number" ? attr.userCount : undefined,
        }
      })
      .filter((item) => item.id && item.title)
  } catch {
    return []
  }
}

export async function fetchKitsuMangaById(id: string): Promise<KitsuMangaDetail | null> {
  try {
    const url = new URL(`${KITSU_BASE}/manga/${id}`)
    url.searchParams.set(
      "fields[manga]",
      "canonicalTitle,titles,abbreviatedTitles,synopsis,description,startDate,endDate,chapterCount,status,averageRating,userCount,ratingFrequencies,posterImage",
    )
    url.searchParams.set("include", "genres,categories")
    url.searchParams.set("fields[genres]", "name")
    url.searchParams.set("fields[categories]", "title")

    const res = await fetch(url, {
      cache: "no-store",
      headers: KITSU_HEADERS,
    })
    if (!res.ok) return null

    const json = await res.json()
    const data = json?.data as { id?: string; attributes?: Record<string, unknown> } | undefined
    if (!data?.attributes) return null
    const attr = data.attributes
    const poster = attr.posterImage as Record<string, string> | undefined
    const rawRating = attr.averageRating
    let ratingNum = typeof rawRating === "string" ? parseFloat(rawRating) : (typeof rawRating === "number" ? rawRating : undefined)

    // Fallback: when Kitsu doesn't expose averageRating, compute weighted mean from
    // ratingFrequencies. The keys are integers 2..20 representing rating × 2 (so "20"
    // means 10/10). Returned average is on the same 0-100 scale used downstream.
    let ratingVotes: number | undefined
    const freq = attr.ratingFrequencies as Record<string, string> | undefined
    if (freq && typeof freq === "object") {
      let totalVotes = 0
      let weightedSum = 0
      for (const [key, value] of Object.entries(freq)) {
        const k = Number(key)
        const v = Number(value)
        if (!Number.isFinite(k) || !Number.isFinite(v) || v <= 0) continue
        totalVotes += v
        weightedSum += (k * 5) * v // k is on 2-20 scale; multiply by 5 to get 10-100
      }
      if (totalVotes > 0) {
        ratingVotes = totalVotes
        if (ratingNum == null || !Number.isFinite(ratingNum)) {
          ratingNum = weightedSum / totalVotes
        }
      }
    }

    const included = Array.isArray(json?.included) ? (json.included as Array<Record<string, unknown>>) : []
    const genres: string[] = []
    for (const inc of included) {
      if (inc.type === "genres" || inc.type === "categories") {
        const incAttr = inc.attributes as Record<string, unknown> | undefined
        const name = (incAttr?.name ?? incAttr?.title) as string | undefined
        if (name) genres.push(name)
      }
    }

    return {
      id: data.id ?? id,
      title: titleFromAttributes(attr),
      alternativeTitles: alternativeTitlesFromAttributes(attr),
      synopsis: cleanText(attr.synopsis ?? attr.description),
      coverUrl: poster?.original ?? poster?.large ?? poster?.medium,
      year: yearFromDate(attr.startDate),
      yearEnd: yearFromDate(attr.endDate),
      chapters: typeof attr.chapterCount === "number" ? attr.chapterCount : undefined,
      publicationStatus: statusFromKitsu(attr.status),
      // Convert Kitsu's 0-100 average to 0-10 scale
      rating: ratingNum != null && Number.isFinite(ratingNum) ? Math.round((ratingNum / 10) * 10) / 10 : undefined,
      // Prefer actual rating sample size (sum of ratingFrequencies). Fall back to
      // userCount (= users who added it to library) when the distribution is missing.
      votes: ratingVotes ?? (typeof attr.userCount === "number" ? attr.userCount : undefined),
      genres: Array.from(new Set(genres)),
    }
  } catch {
    return null
  }
}

export async function fetchKitsuReactions(mangaId: string): Promise<string[]> {
  // Kitsu limita 20/página. Pegamos 2 páginas em paralelo pra chegar a 40
  // reações; a API aceita `page[offset]` pra paginação.
  async function fetchPage(offset: number): Promise<unknown[]> {
    try {
      // Não usamos `fields[mediaReactions]=reaction,upVotesCount,likesCount` —
      // URLSearchParams codifica as vírgulas como %2C e Kitsu interpreta o
      // valor inteiro como um único nome de campo, retornando data:[]. O
      // response sem `fields` traz mais campos mas continua pequeno.
      const url = new URL(`${KITSU_BASE}/media-reactions`)
      url.searchParams.set("filter[mangaId]", mangaId)
      url.searchParams.set("sort", "-upVotesCount")
      url.searchParams.set("page[limit]", "20")
      if (offset > 0) url.searchParams.set("page[offset]", String(offset))

      const res = await fetch(url, { cache: "no-store", headers: KITSU_HEADERS })
      if (!res.ok) return []
      const json = await res.json()
      return Array.isArray(json?.data) ? json.data : []
    } catch {
      return []
    }
  }

  try {
    const [page1, page2] = await Promise.all([fetchPage(0), fetchPage(20)])
    return [...page1, ...page2]
      .map((item) => {
        const attributes = (item as { attributes?: Record<string, unknown> }).attributes ?? {}
        const reaction = cleanText(attributes.reaction)
        if (!reaction) return ""

        const upVotes = attributes.upVotesCount
        const likes = attributes.likesCount
        const meta = [
          typeof upVotes === "number" ? `upvotes: ${upVotes}` : null,
          typeof likes === "number" ? `likes: ${likes}` : null,
        ].filter(Boolean).join(", ")

        return meta ? `${reaction}\n(${meta})` : reaction
      })
      .filter(Boolean)
      .map((reaction) => reaction.slice(0, 900))
  } catch {
    return []
  }
}

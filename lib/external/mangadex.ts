import type { PublicationStatus } from "@/types/domain"

const MD_BASE = "https://api.mangadex.org"
const COVER_BASE = "https://uploads.mangadex.org/covers"

export interface MangaDexResult {
  id: string
  title: string
  alternativeTitles: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  chapters?: number
  /** Cross-platform IDs from MangaDex `attributes.links`: al=AniList, mu=MangaUpdates, mal=MyAnimeList, kt=Kitsu, ap=AnimePlanet. */
  links?: { al?: string; mu?: string; mal?: string; kt?: string; ap?: string }
}

export interface MangaDexDetail {
  id: string
  title: string
  alternativeTitles: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  chapters?: number
  publicationStatus?: PublicationStatus
  /** rating average 0-10 from /statistics */
  rating?: number
  /** follows count from /statistics — closest signal MangaDex offers */
  votes?: number
  genres: string[]
}

interface MdRelationship {
  id: string
  type: string
  attributes?: Record<string, unknown>
}

function pickLocalized(value: unknown, preferred: string[] = ["en", "ja-ro", "ja"]): string | undefined {
  if (!value || typeof value !== "object") return undefined
  const obj = value as Record<string, string>
  for (const key of preferred) {
    if (typeof obj[key] === "string" && obj[key].trim()) return obj[key].trim()
  }
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return undefined
}

function flattenAltTitles(altTitles: unknown): string[] {
  if (!Array.isArray(altTitles)) return []
  const out: string[] = []
  for (const entry of altTitles) {
    if (entry && typeof entry === "object") {
      for (const v of Object.values(entry as Record<string, string>)) {
        if (typeof v === "string" && v.trim()) out.push(v.trim())
      }
    }
  }
  return out
}

function statusFromMd(raw: unknown): PublicationStatus | undefined {
  if (typeof raw !== "string") return undefined
  switch (raw.toLowerCase()) {
    case "completed": return "Completed"
    case "ongoing": return "Ongoing"
    case "hiatus": return "Hiatus"
    case "cancelled": return "Cancelled"
    default: return "Unknown"
  }
}

function coverFromRelationships(mangaId: string, relationships: unknown): string | undefined {
  if (!Array.isArray(relationships)) return undefined
  for (const rel of relationships as MdRelationship[]) {
    if (rel.type === "cover_art") {
      const fileName = rel.attributes?.fileName
      if (typeof fileName === "string") {
        return `${COVER_BASE}/${mangaId}/${fileName}.512.jpg`
      }
    }
  }
  return undefined
}

function tagsFromAttributes(attrs: Record<string, unknown>): string[] {
  const tags = attrs.tags
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  for (const tag of tags) {
    const tagAttrs = (tag as Record<string, unknown>)?.attributes as Record<string, unknown> | undefined
    const name = pickLocalized(tagAttrs?.name)
    if (name) out.push(name)
  }
  return out
}

function extractLinks(raw: unknown): MangaDexResult["links"] | undefined {
  if (!raw || typeof raw !== "object") return undefined
  const src = raw as Record<string, unknown>
  const pick = (key: string): string | undefined => {
    const v = src[key]
    if (typeof v === "string" && v.trim()) return v.trim()
    if (typeof v === "number") return String(v)
    return undefined
  }
  const out = {
    al: pick("al"),
    mu: pick("mu"),
    mal: pick("mal"),
    kt: pick("kt"),
    ap: pick("ap"),
  }
  return Object.values(out).some(Boolean) ? out : undefined
}

function chapterCountFromLastChapter(raw: unknown): number | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined
  const n = parseFloat(raw)
  if (!Number.isFinite(n)) return undefined
  return Math.floor(n)
}

export async function searchMangaDex(title: string): Promise<MangaDexResult[]> {
  try {
    const url = new URL(`${MD_BASE}/manga`)
    url.searchParams.set("title", title)
    url.searchParams.set("limit", "5")
    url.searchParams.set("order[relevance]", "desc")
    url.searchParams.append("includes[]", "cover_art")
    url.searchParams.append("contentRating[]", "safe")
    url.searchParams.append("contentRating[]", "suggestive")
    url.searchParams.append("contentRating[]", "erotica")
    url.searchParams.append("contentRating[]", "pornographic")

    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return []

    const json = await res.json()
    const data: unknown[] = Array.isArray(json?.data) ? json.data : []

    return data
      .map((item): MangaDexResult | null => {
        const record = item as { id?: string; attributes?: Record<string, unknown>; relationships?: unknown }
        if (!record.id || !record.attributes) return null
        const attr = record.attributes
        const t = pickLocalized(attr.title) ?? pickLocalized(attr.altTitles)
        if (!t) return null
        const alternativeTitles = flattenAltTitles(attr.altTitles).filter((title) => title !== t)
        return {
          id: record.id,
          title: t,
          alternativeTitles,
          synopsis: pickLocalized(attr.description),
          coverUrl: coverFromRelationships(record.id, record.relationships),
          year: typeof attr.year === "number" ? attr.year : undefined,
          chapters: chapterCountFromLastChapter(attr.lastChapter),
          links: extractLinks(attr.links),
        }
      })
      .filter((item): item is MangaDexResult => item !== null)
  } catch {
    return []
  }
}

export async function fetchMangaDexById(id: string): Promise<MangaDexDetail | null> {
  try {
    const url = new URL(`${MD_BASE}/manga/${id}`)
    url.searchParams.append("includes[]", "cover_art")

    const [detailRes, statsRes] = await Promise.allSettled([
      fetch(url, { cache: "no-store" }),
      fetch(`${MD_BASE}/statistics/manga/${id}`, { cache: "no-store" }),
    ])

    if (detailRes.status !== "fulfilled" || !detailRes.value.ok) return null
    const detailJson = await detailRes.value.json()
    const record = detailJson?.data as { id?: string; attributes?: Record<string, unknown>; relationships?: unknown } | undefined
    if (!record?.attributes || !record.id) return null
    const attr = record.attributes

    const titleEn = pickLocalized(attr.title)
    const altTitles = flattenAltTitles(attr.altTitles)
    const primary = titleEn ?? altTitles[0] ?? ""

    let rating: number | undefined
    let votes: number | undefined
    if (statsRes.status === "fulfilled" && statsRes.value.ok) {
      try {
        const statsJson = await statsRes.value.json()
        const stat = statsJson?.statistics?.[id] as Record<string, unknown> | undefined
        if (stat) {
          const r = stat.rating as Record<string, unknown> | undefined
          const avg = r?.bayesian ?? r?.average
          if (typeof avg === "number" && Number.isFinite(avg)) {
            rating = Math.round(avg * 10) / 10
          }
          // Sum the rating distribution to get actual vote count (not follows/saves)
          const dist = r?.distribution
          if (dist && typeof dist === "object") {
            const total = Object.values(dist as Record<string, number>)
              .reduce((sum, n) => sum + (typeof n === "number" ? n : 0), 0)
            if (total > 0) votes = total
          }
        }
      } catch { /* ignore */ }
    }

    return {
      id: record.id,
      title: primary,
      alternativeTitles: Array.from(new Set(altTitles.filter((t) => t !== primary))),
      synopsis: pickLocalized(attr.description),
      coverUrl: coverFromRelationships(record.id, record.relationships),
      year: typeof attr.year === "number" ? attr.year : undefined,
      chapters: chapterCountFromLastChapter(attr.lastChapter),
      publicationStatus: statusFromMd(attr.status),
      rating,
      votes,
      genres: tagsFromAttributes(attr),
    }
  } catch {
    return null
  }
}

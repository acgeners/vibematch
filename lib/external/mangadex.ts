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
  /** "safe" | "suggestive" | "erotica" | "pornographic". */
  contentRating?: string
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
  /** "safe" | "suggestive" | "erotica" | "pornographic". */
  contentRating?: string
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
          contentRating: typeof attr.contentRating === "string" ? attr.contentRating : undefined,
          links: extractLinks(attr.links),
        }
      })
      .filter((item): item is MangaDexResult => item !== null)
  } catch {
    return []
  }
}

/**
 * Comentários do fórum MangaDex (XenForo). A página principal da obra esconde
 * os comments atrás de gating de supporter; o conteúdo público mora em
 * `forums.mangadex.org/threads/{threadId}`. O `threadId` vem do endpoint
 * `/statistics/manga/{id}`.
 *
 * Sinal de qualidade variável: a maioria dos posts são reações curtas ("OMG",
 * "can't wait"). Filtramos por tamanho (>=200 chars depois de strip de HTML)
 * pra ficar com os comentários substantivos. Pagamos custo de scraping em
 * troca de cobertura — MangaDex tem 1000+ posts em obras populares.
 */
export async function fetchMangaDexForumComments(mangadexId: string): Promise<string[]> {
  try {
    // 1. Resolve threadId + total de replies via statistics endpoint.
    const statsRes = await fetch(`${MD_BASE}/statistics/manga/${mangadexId}`, { cache: "no-store" })
    if (!statsRes.ok) return []
    const statsJson = await statsRes.json()
    const stat = statsJson?.statistics?.[mangadexId] as { comments?: { threadId?: number; repliesCount?: number } } | undefined
    const threadId = stat?.comments?.threadId
    if (!threadId) return []
    const repliesCount = stat?.comments?.repliesCount ?? 0

    // 2. XenForo pagina 20 posts/página. As páginas iniciais costumam ser
    // reações curtas ("OMG release!"); o meio/fim do thread concentra
    // discussão substantiva. Em vez de pegar só 1-2, samplamos 5 páginas
    // distribuídas pelo thread inteiro.
    const totalPages = Math.max(1, Math.ceil(repliesCount / 20))
    const pagesToFetch: number[] = totalPages <= 5
      ? Array.from({ length: totalPages }, (_, i) => i + 1)
      : [
          1,
          Math.max(2, Math.ceil(totalPages * 0.25)),
          Math.max(3, Math.ceil(totalPages * 0.5)),
          Math.max(4, Math.ceil(totalPages * 0.75)),
          totalPages,
        ]
    const uniquePages = Array.from(new Set(pagesToFetch))

    const fetchPage = async (page: number): Promise<string> => {
      try {
        const url = `https://forums.mangadex.org/threads/${threadId}/page-${page}`
        const res = await fetch(url, {
          cache: "no-store",
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0" },
        })
        if (!res.ok) return ""
        return await res.text()
      } catch {
        return ""
      }
    }

    const htmls = await Promise.all(uniquePages.map(fetchPage))
    const combined = htmls.join("")

    // 3. Extrai bodies dos posts (XenForo: <div class="bbWrapper">...</div>),
    // filtra por tamanho (>=150 chars) e dedup por prefixo pra evitar quote-spam.
    const bodyRegex = /<div class="bbWrapper">([\s\S]*?)<\/div>\s*\n/g
    const posts: string[] = []
    const seenPrefixes = new Set<string>()
    let match: RegExpExecArray | null
    while ((match = bodyRegex.exec(combined)) !== null) {
      const raw = match[1]
      const noHtml = raw.replace(/<[^>]+>/g, " ")
      const decoded = noHtml
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&nbsp;/g, " ")
      const cleaned = decoded.replace(/\s+/g, " ").trim()
      if (cleaned.length < 150) continue
      const prefix = cleaned.slice(0, 80).toLowerCase()
      if (seenPrefixes.has(prefix)) continue
      seenPrefixes.add(prefix)
      posts.push(cleaned.slice(0, 900))
    }

    return posts
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
      contentRating: typeof attr.contentRating === "string" ? attr.contentRating : undefined,
    }
  } catch {
    return null
  }
}

/**
 * Datas de lançamento (ISO, `readableAt`) dos capítulos EN mais recentes, uma por
 * número de capítulo (a mais antiga quando vários grupos sobem o mesmo cap),
 * em ordem decrescente. Usado só pra estimar a CADÊNCIA (gap entre lançamentos):
 * os intervalos são confiáveis mesmo quando as datas absolutas do MangaDex estão
 * defasadas em relação a agregadores (ex.: comix mais adiantado).
 */
export async function fetchMangaDexChapterDates(id: string, limit = 16): Promise<string[]> {
  try {
    const url = new URL(`${MD_BASE}/manga/${id}/feed`)
    url.searchParams.append("translatedLanguage[]", "en")
    url.searchParams.append("order[readableAt]", "desc")
    url.searchParams.append("limit", String(Math.min(100, Math.max(1, limit))))
    url.searchParams.append("includeFutureUpdates", "0")
    for (const cr of ["safe", "suggestive", "erotica", "pornographic"]) {
      url.searchParams.append("contentRating[]", cr)
    }

    const res = await fetch(url, { cache: "no-store" })
    if (!res.ok) return []
    const json = await res.json()
    const data = (json?.data ?? []) as Array<{
      attributes?: { chapter?: string | null; readableAt?: string; publishAt?: string }
    }>

    // Uma data por número de capítulo (a mais antiga = primeira disponibilização).
    const byChapter = new Map<string, string>()
    for (const c of data) {
      const at = c.attributes?.readableAt ?? c.attributes?.publishAt
      if (typeof at !== "string" || !at) continue
      const chap = c.attributes?.chapter
      const key = typeof chap === "string" && chap.trim() ? chap.trim() : at
      const prev = byChapter.get(key)
      if (!prev || new Date(at).getTime() < new Date(prev).getTime()) byChapter.set(key, at)
    }
    return [...byChapter.values()].sort((a, b) => new Date(b).getTime() - new Date(a).getTime())
  } catch {
    return []
  }
}

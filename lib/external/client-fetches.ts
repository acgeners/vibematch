// Fetches for Cloudflare-protected sources — routed through internal Next.js proxy
// routes to avoid CORS and Cloudflare bot detection.

export interface ComicKClientResult {
  chapters?: number
  rating?: number
  votes?: number
  tags?: string[]
}

export interface AnimePlanetClientResult {
  rating?: number
  votes?: number
}

export async function fetchComicKClient(title: string): Promise<ComicKClientResult | null> {
  try {
    const searchRes = await fetch(`/api/comick/search?q=${encodeURIComponent(title)}`)
    if (!searchRes.ok) return null

    const data: unknown[] = await searchRes.json()
    if (!Array.isArray(data) || data.length === 0) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = data[0] as any
    const hid: string = item.hid
    if (!hid) return null

    const detailRes = await fetch(`/api/comick/${hid}`)
    if (!detailRes.ok) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detail: any = await detailRes.json()
    if (!detail) return null
    const comic = detail?.comic ?? detail

    // Prefer real average over Bayesian (smoothed) — same reasoning as MU.
    const rawRating = comic.rating ?? comic.bayesian_rating
    const rating = rawRating != null ? parseFloat(String(rawRating)) : undefined
    const rawChapter = comic.last_chapter
    const chapters = rawChapter != null ? Math.floor(parseFloat(String(rawChapter))) : undefined
    const votes = comic.rating_count ?? comic.follow_count ?? undefined

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawTags: any[] = comic.md_tags ?? []
    const tags = rawTags
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((t: any) => (t.md_tag?.name ?? t.name ?? "") as string)
      .filter(Boolean)

    return {
      chapters: chapters != null && !isNaN(chapters) ? chapters : undefined,
      rating: rating != null && !isNaN(rating) ? rating : undefined,
      votes: typeof votes === "number" ? votes : undefined,
      tags: tags.length > 0 ? tags : undefined,
    }
  } catch {
    return null
  }
}

export async function fetchAnimePlanetClient(title: string): Promise<AnimePlanetClientResult | null> {
  try {
    const res = await fetch(`/api/animeplanet?title=${encodeURIComponent(title)}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

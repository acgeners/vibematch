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

/** Sinaliza que a busca do ComicK falhou por indisponibilidade da fonte
 * (Cloudflare/FlareSolverr/rede) — distinto de "sem match". A UI usa isso pra
 * oferecer um retry em vez de descartar a fonte em silêncio. */
export class ComicKUnavailableError extends Error {
  constructor() {
    super("comick_upstream_unavailable")
    this.name = "ComicKUnavailableError"
  }
}

// IMPORTANTE: lança `ComicKUnavailableError` quando a fonte está indisponível
// (rota responde 502, ver app/api/comick/*) e retorna `null` SÓ quando o ComicK
// genuinamente não tem dados pra obra (no-match). Antes engolia tudo em `null`,
// o que escondia falhas de FlareSolverr (a obra ficava sem dados, sem aviso).
export async function fetchComicKClient(title: string, hid?: string): Promise<ComicKClientResult | null> {
  let selectedHid = hid?.trim()
  if (!selectedHid) {
    const searchRes = await fetch(`/api/comick/search?q=${encodeURIComponent(title)}`)
    if (searchRes.status === 502) throw new ComicKUnavailableError()
    if (!searchRes.ok) return null

    const data: unknown = await searchRes.json()
    if (!Array.isArray(data) || data.length === 0) return null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = data[0] as any
    selectedHid = item.hid
    if (!selectedHid) return null
  }

  const detailRes = await fetch(`/api/comick/${selectedHid}`)
  if (detailRes.status === 502) throw new ComicKUnavailableError()
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
}

export async function fetchAnimePlanetClient(title: string, slug?: string): Promise<AnimePlanetClientResult | null> {
  try {
    const params = new URLSearchParams()
    if (title) params.set("title", title)
    if (slug) params.set("slug", slug)
    const res = await fetch(`/api/animeplanet?${params.toString()}`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

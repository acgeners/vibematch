import type { PublicationStatus } from "@/types/domain"

const COMICK_BASE = "https://api.comick.io"

function mapStatus(status: number | undefined): PublicationStatus {
  switch (status) {
    case 1: return "Ongoing"
    case 2: return "Completed"
    case 3: return "Hiatus"
    case 4: return "Cancelled"
    default: return "Unknown"
  }
}

function coverUrl(b2key: string | undefined): string | undefined {
  if (!b2key) return undefined
  return `https://meo.comick.pictures/${b2key}`
}

export interface ComicKDetail {
  title: string
  coverUrl?: string
  publicationStatus: PublicationStatus
  lastChapter?: number
  rating?: number
  votes?: number
}

export async function fetchComicKByHid(hid: string): Promise<ComicKDetail | null> {
  try {
    const res = await fetch(`${COMICK_BASE}/comic/${hid}`, {
      cache: "no-store",
    })
    if (!res.ok) return null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await res.json()
    const comic = data?.comic ?? data

    const rawRating = comic.bayesian_rating
    const rating = rawRating != null ? parseFloat(String(rawRating)) : undefined
    const rawChapter = comic.last_chapter
    const lastChapter = rawChapter != null ? Math.floor(parseFloat(String(rawChapter))) : undefined
    return {
      title: comic.title ?? "",
      coverUrl: coverUrl(comic.md_covers?.[0]?.b2key),
      publicationStatus: mapStatus(comic.status),
      lastChapter: lastChapter != null && !isNaN(lastChapter) ? lastChapter : undefined,
      rating: rating != null && !isNaN(rating) ? rating : undefined,
      votes: comic.rating_count ?? comic.follow_count ?? undefined,
    }
  } catch {
    return null
  }
}

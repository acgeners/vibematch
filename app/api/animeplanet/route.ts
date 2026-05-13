import { NextRequest, NextResponse } from "next/server"
import { fetchHtmlWithCfFallback } from "@/lib/external/flaresolverr"

const AP_BASE = "https://www.anime-planet.com"
const AP_META = new Set(["all", "tags", "genres", "top-100", "recommendations", "browse"])

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  "Referer": "https://www.anime-planet.com/manga/all",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
}

export async function GET(req: NextRequest) {
  const title = req.nextUrl.searchParams.get("title")
  if (!title) return NextResponse.json(null)

  try {
    const listResult = await fetchHtmlWithCfFallback(
      `${AP_BASE}/manga/all?name=${encodeURIComponent(title)}`,
      HEADERS
    )
    if (!listResult) return NextResponse.json(null)

    // AP collapses a single-result search to the detail page (HTTP redirect).
    // Recognize that and skip the slug-discovery step entirely.
    const directDetailMatch = listResult.finalUrl.match(/\/manga\/([a-z0-9][a-z0-9-]*)\/?$/)
    let detailHtml: string | null = null
    if (directDetailMatch && !AP_META.has(directDetailMatch[1])) {
      detailHtml = listResult.html
    } else {
      const slugRegex = /href="\/manga\/([a-z0-9][a-z0-9-]*)"[^>]*title="([^"]*)"/g
      let slug: string | null = null
      let match: RegExpExecArray | null
      while ((match = slugRegex.exec(listResult.html)) !== null) {
        const [, s, t] = match
        if (!AP_META.has(s) && !/\(novel\)$/i.test(t.trim())) {
          slug = s
          break
        }
      }
      if (!slug) return NextResponse.json(null)

      const detailResult = await fetchHtmlWithCfFallback(`${AP_BASE}/manga/${slug}`, HEADERS)
      if (!detailResult) return NextResponse.json(null)
      detailHtml = detailResult.html
    }

    const m = detailHtml.match(/class="avgRating"[^>]*title="([\d.]+) out of 5 from ([\d,]+) votes"/)
    if (!m) return NextResponse.json(null)

    const raw = parseFloat(m[1])
    const votes = parseInt(m[2].replace(/,/g, ""), 10)
    if (isNaN(raw) || isNaN(votes)) return NextResponse.json(null)

    return NextResponse.json({
      rating: Math.round(raw * 2 * 10) / 10,
      votes,
    })
  } catch {
    return NextResponse.json(null)
  }
}

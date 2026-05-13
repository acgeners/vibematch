import { NextRequest, NextResponse } from "next/server"

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
    const listRes = await fetch(`${AP_BASE}/manga/all?name=${encodeURIComponent(title)}`, {
      headers: HEADERS,
      cache: "no-store",
    })
    if (!listRes.ok) return NextResponse.json(null)
    const ct = listRes.headers.get("content-type") ?? ""
    if (!ct.includes("html")) return NextResponse.json(null)

    const listHtml = await listRes.text()

    const slugRegex = /href="\/manga\/([a-z0-9][a-z0-9-]*)"[^>]*title="([^"]*)"/g
    let slug: string | null = null
    let match: RegExpExecArray | null
    while ((match = slugRegex.exec(listHtml)) !== null) {
      const [, s, t] = match
      if (!AP_META.has(s) && !/\(novel\)$/i.test(t.trim())) {
        slug = s
        break
      }
    }
    if (!slug) return NextResponse.json(null)

    const detailRes = await fetch(`${AP_BASE}/manga/${slug}`, {
      headers: HEADERS,
      cache: "no-store",
    })
    if (!detailRes.ok) return NextResponse.json(null)
    const detailHtml = await detailRes.text()

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

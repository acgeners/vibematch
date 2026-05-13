import { NextRequest, NextResponse } from "next/server"

const COMICK_BASES = [
  "https://api.comick.io",
  "https://comick.dev",
  "https://api.comick.app",
]

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "application/json, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Referer": "https://comick.io/",
  "Origin": "https://comick.io",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
}

async function fetchJson(url: URL) {
  for (const base of COMICK_BASES) {
    const nextUrl = new URL(url.pathname, base)
    nextUrl.search = url.search
    try {
      const res = await fetch(nextUrl.toString(), { headers: HEADERS, cache: "no-store" })
      if (!res.ok) continue
      const ct = res.headers.get("content-type") ?? ""
      if (!ct.includes("json")) continue
      return await res.json()
    } catch {
      continue
    }
  }

  return null
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")
  if (!q) return NextResponse.json([])

  try {
    const url = new URL("/v1.0/search/", COMICK_BASES[0])
    url.searchParams.set("q", q)
    url.searchParams.set("limit", "3")
    url.searchParams.set("type", "comic")

    return NextResponse.json(await fetchJson(url))
  } catch {
    return NextResponse.json(null)
  }
}

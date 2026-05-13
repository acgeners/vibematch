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

async function fetchJson(pathname: string) {
  for (const base of COMICK_BASES) {
    try {
      const res = await fetch(new URL(pathname, base).toString(), {
        headers: HEADERS,
        cache: "no-store",
      })
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ hid: string }> }
) {
  const { hid } = await params
  try {
    return NextResponse.json(await fetchJson(`/comic/${hid}`))
  } catch {
    return NextResponse.json(null)
  }
}

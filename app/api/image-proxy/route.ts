import { NextRequest, NextResponse } from "next/server"
import { PROXIED_COVER_HOSTS } from "@/lib/image-proxy"

// Referer por host: anime-planet exige o www; os demais CDNs liberam com a
// própria origem do alvo.
function refererFor(host: string, origin: string): string {
  if (host === "cdn.anime-planet.com" || host === "www.anime-planet.com") {
    return "https://www.anime-planet.com/"
  }
  return `${origin}/`
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url")
  if (!rawUrl) {
    return new NextResponse("Missing url", { status: 400 })
  }

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return new NextResponse("Invalid url", { status: 400 })
  }

  const host = url.hostname.toLowerCase()
  if (!["https:", "http:"].includes(url.protocol) || !PROXIED_COVER_HOSTS.has(host)) {
    return new NextResponse("Unsupported image host", { status: 400 })
  }

  let upstream: Response
  try {
    upstream = await fetch(url, {
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: refererFor(host, url.origin),
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      next: { revalidate: 60 * 60 * 24 * 7 },
    })
  } catch {
    return new NextResponse("Upstream fetch failed", { status: 502 })
  }

  if (!upstream.ok) {
    return new NextResponse("Image unavailable", { status: upstream.status })
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg"
  if (!contentType.startsWith("image/")) {
    return new NextResponse("Not an image", { status: 415 })
  }

  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  })
}

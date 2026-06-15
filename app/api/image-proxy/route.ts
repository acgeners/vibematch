import { NextRequest, NextResponse } from "next/server"
import { PROXIED_COVER_HOSTS } from "@/lib/image-proxy"
import { recordCoverHostResult } from "@/lib/external/blocked-covers"

// Referer por host: anime-planet exige o www; os demais CDNs liberam com a
// própria origem do alvo.
function refererFor(host: string, origin: string): string {
  if (host === "cdn.anime-planet.com" || host === "www.anime-planet.com") {
    return "https://www.anime-planet.com/"
  }
  return `${origin}/`
}

// User-Agent por host. O CDN do MangaDex (uploads.mangadex.org) REJEITA com 400 o
// UA spoofado de Chrome — pede um UA descritivo (ou nenhum). Os demais CDNs
// (anime-planet/comick/mangaupdates) liberam com o UA de navegador.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
function userAgentFor(host: string): string {
  if (host === "uploads.mangadex.org" || host === "mangadex.org") {
    return "SatorIA/1.0 (anime catalog; cover proxy)"
  }
  return BROWSER_UA
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
        "User-Agent": userAgentFor(host),
      },
      next: { revalidate: 60 * 60 * 24 * 7 },
    })
  } catch {
    // Aprende a saúde dos CDNs dinâmicos (ex.: static.comix.to): erro → re-bloqueia.
    recordCoverHostResult(host, false)
    return new NextResponse("Upstream fetch failed", { status: 502 })
  }

  if (!upstream.ok) {
    recordCoverHostResult(host, false)
    return new NextResponse("Image unavailable", { status: upstream.status })
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg"
  if (!contentType.startsWith("image/")) {
    recordCoverHostResult(host, false)
    return new NextResponse("Not an image", { status: 415 })
  }

  // 200 + imagem → host saudável: libera o CDN dinâmico pela janela de TTL.
  recordCoverHostResult(host, true)
  return new NextResponse(upstream.body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  })
}

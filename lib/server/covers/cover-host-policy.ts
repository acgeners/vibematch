import "server-only"

import { PROXIED_COVER_HOSTS } from "@/lib/image-proxy"

// Política CENTRAL de fetch de capa no servidor (allowlist + Referer/UA por host).
// Antes essa lógica vivia duplicada em app/api/image-proxy/route.ts; agora há uma
// fonte de verdade compartilhada pelo proxy de imagem (cards) e pelo pré-fetch da
// capa enviada ao modelo (avaliação IA).

/** Allowlist de hosts de capa (reusa a do image-proxy). */
export function isAllowedCoverHost(host: string): boolean {
  return PROXIED_COVER_HOSTS.has(host.toLowerCase())
}

// Referer por host: anime-planet exige o www; os demais CDNs liberam com a
// própria origem do alvo.
export function refererFor(host: string, origin: string): string {
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

export function userAgentFor(host: string): string {
  if (host === "uploads.mangadex.org" || host === "mangadex.org") {
    return "SatorIA/1.0 (anime catalog; cover proxy)"
  }
  return BROWSER_UA
}

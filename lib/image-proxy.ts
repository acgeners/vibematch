// Hosts de capa que bloqueiam hotlink no browser (referer/hotlink protection),
// mas respondem 200 a um fetch de servidor. Roteamos essas imagens pelo
// /api/image-proxy (servidor busca e serve same-origin) pra carregarem nos cards.
// myanimelist e anilist carregam direto no browser — ficam de fora pra evitar
// proxy desnecessário.
export const PROXIED_COVER_HOSTS = new Set([
  "cdn.anime-planet.com",
  "www.anime-planet.com",
  "meo.comick.pictures",
  "uploads.mangadex.org",
  "mangadex.org",
  "media.kitsu.app",
  "static.comix.to",
  "cdn.mangaupdates.com",
])

export function getCoverImageSrc(url: string | null | undefined): string {
  if (!url) return ""
  try {
    const parsed = new URL(url)
    if (PROXIED_COVER_HOSTS.has(parsed.hostname.toLowerCase())) {
      return `/api/image-proxy?url=${encodeURIComponent(url)}`
    }
  } catch {
    return url
  }
  return url
}

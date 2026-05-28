// CDNs de fontes externas que ficam atrás de Cloudflare bot protection e
// rejeitam requests de <img> do browser (mesmo via /api/image-proxy server-side
// — o Next bate na mesma proteção). Quando uma cover aponta pra um desses
// hosts, descartamos pra não poluir work_covers com URLs broken, e na UI de
// revalidação fazemos fallback pra cover de outra fonte cruzada via crossIds.
const BLOCKED_COVER_HOSTS = new Set(["static.comix.to"])

export function isBlockedCoverUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    return BLOCKED_COVER_HOSTS.has(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

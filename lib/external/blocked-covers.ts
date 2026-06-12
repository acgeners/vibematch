// CDNs de fontes externas que ficam atrás de bot protection e rejeitam requests
// de imagem MESMO via /api/image-proxy (o servidor bate na mesma proteção). Quando
// uma cover aponta pra um desses hosts, descartamos pra não poluir work_covers com
// URLs broken e fazemos fallback pra cover de outra fonte cruzada via crossIds.
//
// `static.comix.to` foi REMOVIDO em 2026-06-12: re-testado e o CDN agora responde
// 200 image/jpg tanto a fetch de servidor quanto via /api/image-proxy (que já lista
// o host em PROXIED_COVER_HOSTS) — a cover da Comix exibe normalmente. Mantemos o
// mecanismo (set vazio) pro caso de outro host precisar ser bloqueado no futuro.
const BLOCKED_COVER_HOSTS = new Set<string>([])

export function isBlockedCoverUrl(url: string | null | undefined): boolean {
  if (!url || BLOCKED_COVER_HOSTS.size === 0) return false
  try {
    return BLOCKED_COVER_HOSTS.has(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

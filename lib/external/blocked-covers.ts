// CDNs de fontes externas que ficam atrás de bot protection e rejeitam requests
// de imagem MESMO via /api/image-proxy (o servidor bate na mesma proteção). Quando
// uma cover aponta pra um desses hosts, descartamos pra não poluir work_covers com
// URLs broken e fazemos fallback pra cover de outra fonte cruzada via crossIds.
//
// `static.comix.to` foi removido em 2026-06-12 (CDN voltou a servir 200) e
// RE-ADICIONADO no mesmo dia (fim da tarde): a Cloudflare do comix ficou estrita e
// o CDN voltou a dar 403 (challenge) — direto, com UA e até com cf_clearance (não
// replayável). O /api/image-proxy bate na mesma proteção (502), então a cover do
// comix entra broken. Bloqueado → fallback cross-source via crossIds. Não dá pra
// destravar por fetch (cf_clearance amarrado ao browser) e o FlareSolverr serve
// HTML, não bytes de imagem. SEMPRE re-testar com curl + /api/image-proxy antes de
// remover de novo — o estado do CDN oscila.
const BLOCKED_COVER_HOSTS = new Set<string>(["static.comix.to"])

export function isBlockedCoverUrl(url: string | null | undefined): boolean {
  if (!url || BLOCKED_COVER_HOSTS.size === 0) return false
  try {
    return BLOCKED_COVER_HOSTS.has(new URL(url).hostname.toLowerCase())
  } catch {
    return false
  }
}

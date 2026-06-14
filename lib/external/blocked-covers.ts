// CDNs de fontes externas que ficam atrás de bot protection (Cloudflare) e
// OSCILAM entre servir 200 e dar 403 (challenge) — mesmo via /api/image-proxy o
// servidor bate na mesma proteção. Quando bloqueado, descartamos a cover na
// SELEÇÃO (pra não persistir URL broken em work_covers) e caímos pra cover de
// outra fonte cruzada via crossIds.
//
// `static.comix.to` é o caso vivo: a Cloudflare do comix abre e fecha de um dia
// pro outro. Em vez de manter uma lista hardcoded (que exigia editar à mão toda
// vez que o CDN oscilava — ver histórico), o estado é DINÂMICO: aprendemos com o
// desfecho real do fetch. Modelo OTIMISTA: liberado por padrão; um erro/403
// (image-proxy em tráfego real ou canário "Testar agora") bloqueia por uma
// janela; um 200 limpa o bloqueio na hora. Assim, com o CDN de pé, obras novas
// já persistem a capa do Comix na criação; quando o CF re-fecha, o 1º fetch que
// falha re-bloqueia e cai pro fallback cross-source.
const DYNAMIC_COVER_HOSTS = new Set<string>(["static.comix.to"])

// Por quanto tempo um erro mantém o host bloqueado antes de re-tentar sozinho.
// Curto o bastante pra auto-recuperar quando o CF reabre; longo o bastante pra
// não martelar um CDN que acabou de dar 403.
const BLOCK_TTL_MS = 15 * 60_000

// host → epoch até quando o host está bloqueado (erro recente observado).
const blockedUntil = new Map<string, number>()

function hostOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

export function isBlockedCoverUrl(url: string | null | undefined): boolean {
  const host = hostOf(url)
  if (!host || !DYNAMIC_COVER_HOSTS.has(host)) return false
  // Otimista: liberado a menos que um erro recente tenha bloqueado nesta janela.
  const until = blockedUntil.get(host)
  return until != null && Date.now() < until
}

/**
 * Registra o desfecho real de um fetch de cover (image-proxy em tráfego real ou
 * canário de saúde). `ok` = 200 + content-type de imagem. No-op pra hosts não
 * dinâmicos (os demais CDNs nunca são bloqueados).
 */
export function recordCoverHostResult(host: string | null | undefined, ok: boolean): void {
  if (!host) return
  const h = host.toLowerCase()
  if (!DYNAMIC_COVER_HOSTS.has(h)) return
  if (ok) blockedUntil.delete(h)
  else blockedUntil.set(h, Date.now() + BLOCK_TTL_MS)
}

/** Conveniência: registra a partir da URL inteira (extrai o host). */
export function recordCoverUrlResult(url: string | null | undefined, ok: boolean): void {
  recordCoverHostResult(hostOf(url), ok)
}

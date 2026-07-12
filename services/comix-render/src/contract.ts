// Contrato PÚBLICO devolvido pelo sidecar. Espelha, do lado do produtor, o schema
// Zod que o app valida (lib/validations/comix-render.schema.ts). É a MESMA forma;
// a fonte de verdade é o schema + o Design Doc. Qualquer mudança de payload é
// coordenada com o app ANTES (contrato fechado).

export interface SidecarItem {
  hid: string
  url: string
  title: string
  altTitles?: string[]
  links?: Record<string, string | null>
}

export interface SidecarMeta {
  query: string
  elapsedMs: number
  totalCandidates: number
  source: string
}

export type SidecarResponse =
  | { ok: true; items: SidecarItem[]; meta: SidecarMeta }
  | { ok: false; error: string; meta: { elapsedMs: number; source: string } }

export const SOURCE = "comix:browse-relevance"
export const SOURCE_RENDER = "render:browser"

// ---------------------------------------------------------------------------
// POST /render — busca HTML por BROWSER REAL (substitui o FlareSolverr).
// Genérico de propósito: recebe uma URL e devolve o HTML já renderizado. Quem
// sabe o que fazer com o HTML é o app; o sidecar continua agnóstico.
// ---------------------------------------------------------------------------

export interface RenderInput {
  url: string
  headers?: Record<string, string>
  /** Teto por request (ms). O server clampa ao máximo da config. */
  timeoutMs?: number
}

export type RenderResponse =
  | { ok: true; html: string; finalUrl: string; status: number; meta: { elapsedMs: number; source: string } }
  | { ok: false; error: string; meta: { elapsedMs: number; source: string } }

/**
 * Interstitial de DESAFIO do Cloudflare (bloqueio), não a página protegida.
 *
 * Espelha `isCloudflareChallenge` do app (lib/external/flaresolverr.ts) — os dois
 * precisam concordar. NÃO casar com `challenge-platform` solto: o script passivo
 * (`/cdn-cgi/challenge-platform/scripts/jsd/main.js`) vem em páginas BOAS, e tratá-lo
 * como bloqueio faz descartar HTML válido.
 */
export function isChallengeHtml(html: string): boolean {
  return /cf-mitigated|Just a moment|cf-chl-bypass|_cf_chl_opt|challenge-platform\/h\/[a-z]+\/orchestrate/i.test(html)
}

/** Host permitido? O sidecar roda na rede interna: sem allowlist, `POST /render`
 *  viraria um proxy aberto (SSRF) pra qualquer endereço alcançável daqui. */
export function isAllowedUrl(raw: string, allowed: readonly string[]): boolean {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false
  const host = u.hostname.toLowerCase()
  return allowed.some((a) => host === a || host.endsWith(`.${a}`))
}

/** Códigos de erro do contrato → status HTTP (§1). Um corpo de contrato VÁLIDO
 *  sempre acompanha o status; o app parseia o corpo (não confia só no status). */
export const ERROR_STATUS: Record<string, number> = {
  bad_request: 400,
  upstream_blocked: 502,
  no_xhr: 502,
  busy: 503,
  render_timeout: 504,
  internal: 500,
}

/** Normaliza um item cru da busca do Comix pro shape do contrato (passthrough
 *  de `links` como URLs completas; `url` cai pro canônico por hid se faltar). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function shapeItem(raw: any): SidecarItem | null {
  const hid = typeof raw?.hid === "string" ? raw.hid : null
  if (!hid) return null
  const url = typeof raw?.url === "string" && raw.url ? raw.url : `/title/${hid}`
  const altTitles = Array.isArray(raw?.altTitles)
    ? raw.altTitles
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((t: any) => (typeof t === "string" ? t : t?.title))
        .filter((t: unknown): t is string => typeof t === "string" && t.length > 0)
    : []
  const links =
    raw?.links && typeof raw.links === "object" ? (raw.links as Record<string, string | null>) : {}
  return { hid, url, title: typeof raw?.title === "string" ? raw.title : "", altTitles, links }
}

/** Classifica um erro do fluxo de resolução num código do contrato (§1). Puro
 *  (sem deps de Playwright) pra ser testável isoladamente. */
export function classifyError(err: unknown, phase: "nav" | "xhr" | "parse", timedOut: boolean): string {
  if (timedOut) return "render_timeout"
  const msg = err instanceof Error ? err.message : String(err)
  const isTimeout = /Timeout .* exceeded|timeout/i.test(msg)
  // XHR não apareceu no teto → provável mudança de rota/param do Comix (ou CF).
  if (isTimeout && phase === "xhr") return "no_xhr"
  if (isTimeout) return "render_timeout" // nav
  // Página fechada pelo backstop de tempo, ou target morto.
  if (/Target .*closed|browser has been closed/i.test(msg)) return "render_timeout"
  return "internal"
}

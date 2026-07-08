import { linksFromItem } from "./comix"
import { bestTitleMatch, normalizeText } from "./title-match"
import { httpComixRenderClient } from "./comix-render-client"
import type { ComixResolveInput, ComixSidecarItem, ComixRenderClient } from "./comix-render-client"

// ============================================================================
// Resolução da URL do Comix a partir de título + cross-IDs (Peça 1)
// ----------------------------------------------------------------------------
// `resolveComixUrl` descobre a obra no Comix SEM o usuário informar a URL. A
// descoberta dos candidatos é delegada ao sidecar `comix-render` (browser real,
// via `./comix-render-client`); TODA a lógica de negócio (cache, matching por
// cross-ID, escolha, montagem da URL) mora aqui, no app. O sidecar é caixa-preta.
//
// Contrato HTTP = fronteira ESTÁVEL (ver DESIGN-COMIX-RENDER-SIDECAR.md); a forma
// do payload e sua validação Zod vivem em lib/validations/comix-render.schema.ts.
// Detalhes internos do sidecar (goto/type/intercept/browse) NÃO são conhecidos aqui.
// ============================================================================

// Re-export do contrato — o app importa os tipos daqui (fonte real: o schema Zod).
export type {
  ComixResolveInput,
  ComixSidecarItem,
  ComixSidecarMeta,
  ComixSidecarResponse,
  ComixRenderClient,
} from "./comix-render-client"

/** Resultado resolvido: o `hid` é a âncora (imune a mudança de formato de URL);
 *  `url` é a URL canônica absoluta pronta pro `fetchComixDetail`. */
export interface ComixResolved {
  hid: string
  url: string
}

/** Como a obra foi resolvida — pra observabilidade/debug. */
export type ComixMatchMethod = "anilist" | "mal" | "mangaupdates" | "title" | "none"

// ---- Parâmetros (env, com defaults) ----------------------------------------

const num = (env: string | undefined, fallback: number) => {
  const n = Number(env)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const RESULT_LIMIT = num(process.env.COMIX_RENDER_RESULT_LIMIT, 12)
const SIM_ACCEPT_THRESHOLD = Number(process.env.COMIX_SIM_ACCEPT_THRESHOLD) || 0.72
const CACHE_TTL_HIT_MS = num(process.env.COMIX_RESOLVE_TTL_HIT_MS, 24 * 60 * 60_000)
const CACHE_TTL_MISS_MS = num(process.env.COMIX_RESOLVE_TTL_MISS_MS, 6 * 60 * 60_000)
const CACHE_MAX = num(process.env.COMIX_RESOLVE_CACHE_MAX, 1000)

const COMIX_ORIGIN = "https://comix.to"

// ---- URL absoluta ----------------------------------------------------------

/** Normaliza a `url` do sidecar (path relativo) pra URL canônica absoluta.
 *  Se o path vier vazio/estranho, cai pro canônico por hid (`/title/{hid}`),
 *  que resolve mesmo sem slug (comprovado). */
function absoluteUrl(hid: string, url: string | undefined): string {
  const path = (url ?? "").trim()
  if (path.startsWith("http")) return path
  if (path.startsWith("/title/")) return `${COMIX_ORIGIN}${path}`
  return `${COMIX_ORIGIN}/title/${hid}`
}

// ---- Matching (cross-ID → título) ------------------------------------------

function normId(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim().toLowerCase()
  return s ? s : null
}

/**
 * Escolhe o candidato certo, em ordem determinística:
 *   1. AniList ID  2. MAL ID  3. MangaUpdates ID  4. similaridade de título.
 * Cross-ID casa exato (zero ambiguidade). O fallback por título só roda quando
 * `allowTitleFallback` é true (gate desta peça = false) — e só aceita acima de
 * `SIM_ACCEPT_THRESHOLD` (senão devolve null: melhor não resolver que errar).
 */
export function matchComixCandidate(
  items: ComixSidecarItem[],
  input: ComixResolveInput,
  allowTitleFallback = false,
): { resolved: ComixResolved; method: ComixMatchMethod } | null {
  // Pré-parseia os cross-IDs de cada item uma vez (URLs completas → id cru).
  const parsed = items.map((it) => ({ it, ids: linksFromItem(it.links) ?? {} }))

  const byCrossId = (
    wanted: string | number | undefined,
    pick: (ids: NonNullable<ReturnType<typeof linksFromItem>>) => string | undefined,
    method: ComixMatchMethod,
  ): { resolved: ComixResolved; method: ComixMatchMethod } | null => {
    const want = normId(wanted)
    if (!want) return null
    const hit = parsed.find(({ ids }) => normId(pick(ids)) === want)
    return hit ? { resolved: { hid: hit.it.hid, url: absoluteUrl(hit.it.hid, hit.it.url) }, method } : null
  }

  return (
    byCrossId(input.anilistId, (ids) => ids.anilist, "anilist") ??
    byCrossId(input.malId, (ids) => ids.mal, "mal") ??
    byCrossId(input.mangaUpdatesId, (ids) => ids.mu, "mangaupdates") ??
    (allowTitleFallback ? matchByTitle(items, input.title) : null)
  )
}

function matchByTitle(
  items: ComixSidecarItem[],
  title: string,
): { resolved: ComixResolved; method: ComixMatchMethod } | null {
  let best: { it: ComixSidecarItem; score: number } | null = null
  for (const it of items) {
    // Reusa o mesmo similaridade do searchAllSources (title + altTitles).
    const score = bestTitleMatch(title, { title: it.title, alternativeTitles: it.altTitles ?? [] })
    if (!best || score > best.score) best = { it, score }
  }
  if (!best || best.score < SIM_ACCEPT_THRESHOLD) return null
  return { resolved: { hid: best.it.hid, url: absoluteUrl(best.it.hid, best.it.url) }, method: "title" }
}

// ---- Cache (LRU + TTL, negativo incluído) ----------------------------------

interface CacheEntry {
  value: ComixResolved | null
  expiresAt: number
}

/** LRU simples com TTL. `null` (miss confirmado) também é cacheado, com TTL
 *  menor, pra não prender obras recém-adicionadas ao catálogo. */
export class ComixResolveCache {
  private map = new Map<string, CacheEntry>()
  constructor(private max = CACHE_MAX) {}

  get(key: string, now: number): CacheEntry | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= now) {
      this.map.delete(key)
      return undefined
    }
    // toca a entrada (LRU: move pro fim)
    this.map.delete(key)
    this.map.set(key, entry)
    return entry
  }

  set(key: string, value: ComixResolved | null, now: number): void {
    const ttl = value ? CACHE_TTL_HIT_MS : CACHE_TTL_MISS_MS
    this.map.delete(key)
    this.map.set(key, { value, expiresAt: now + ttl })
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  clear(): void {
    this.map.clear()
  }
}

/** Chave de cache: precedência por cross-ID (estável) → título normalizado. */
export function cacheKey(input: ComixResolveInput): string {
  if (input.anilistId) return `al:${input.anilistId}`
  if (input.malId) return `mal:${input.malId}`
  if (input.mangaUpdatesId) return `mu:${input.mangaUpdatesId.toLowerCase()}`
  return `t:${normalizeText(input.title)}`
}

// ---- Orquestrador ----------------------------------------------------------

const defaultCache = new ComixResolveCache()

/**
 * Entrada pública do `resolveComixUrl`. Estende o contrato do sidecar com
 * `allowTitleFallback` — decisão de MATCHING do app (o sidecar não a conhece).
 * Default false nesta peça: só resolve por cross-ID exato.
 */
export interface ResolveComixUrlInput extends ComixResolveInput {
  allowTitleFallback?: boolean
}

/**
 * Monta o input de resolução da Comix para o fluxo de CRIAÇÃO a partir dos
 * `work_external_ids` aceitos (chaves do ExternalSourceId: anilist/myanimelist/
 * mangaupdates/comix). Encoda o gate "injeta-antes-de-buscar":
 *  - já há `comix` → null (nada a resolver);
 *  - nenhum cross-ID → null (não arrisca resolução por título no create);
 *  - senão → input com os cross-IDs presentes e `allowTitleFallback:false`.
 * Pura (testável): a chamada de rede/cache fica no caller (`resolveComixUrl`).
 */
export function comixCreateResolveInput(
  title: string,
  externalIds: Partial<Record<string, string | undefined>>,
): ResolveComixUrlInput | null {
  if (externalIds.comix) return null
  const posInt = (v: string | undefined): number | undefined => {
    const n = Number(v)
    return Number.isInteger(n) && n > 0 ? n : undefined
  }
  const anilistId = posInt(externalIds.anilist)
  const malId = posInt(externalIds.myanimelist)
  const mangaUpdatesId = externalIds.mangaupdates || undefined
  if (!anilistId && !malId && !mangaUpdatesId) return null
  return { title, anilistId, malId, mangaUpdatesId, allowTitleFallback: false }
}

/** Desfecho da resolução — pra observabilidade (logs/métricas na camada de cima). */
export type ComixResolveOutcome = "cache_hit" | "resolved" | "no_match" | "sidecar_error"

export interface ResolveComixUrlOptions {
  client?: ComixRenderClient
  cache?: ComixResolveCache
  now?: () => number
  limit?: number
  /** Instrumentação opcional (métricas/logs). `error` só vem em `sidecar_error`. */
  onResult?: (r: {
    method: ComixMatchMethod
    cache: "hit" | "miss"
    resolved: boolean
    outcome: ComixResolveOutcome
    error?: string
  }) => void
}

/**
 * Resolve `{ hid, url }` da obra no Comix a partir de `{ title, anilistId?, ... }`.
 * Cache-first (LRU+TTL, negativo incluído). Fail-soft: qualquer erro do sidecar
 * (ou ausência dele) → `null`, e o Comix degrada como fonte opcional.
 */
export async function resolveComixUrl(
  input: ResolveComixUrlInput,
  opts: ResolveComixUrlOptions = {},
): Promise<ComixResolved | null> {
  const { allowTitleFallback = false, ...contract } = input
  const title = (contract.title ?? "").trim()
  if (!title) return null

  const client = opts.client ?? httpComixRenderClient
  const cache = opts.cache ?? defaultCache
  const now = (opts.now ?? Date.now)()
  const limit = opts.limit ?? RESULT_LIMIT
  const request = { ...contract, title }

  // O modo de matching afeta o resultado só no caso título-só → entra na chave
  // pra não colidir uma resolução com fallback com outra sem.
  const key = cacheKey(request) + (allowTitleFallback ? "#tf" : "")
  const cached = cache.get(key, now)
  if (cached) {
    opts.onResult?.({
      method: cached.value ? "title" : "none",
      cache: "hit",
      resolved: Boolean(cached.value),
      outcome: "cache_hit",
    })
    return cached.value
  }

  const resp = await client.resolve(request, limit)
  if (!resp.ok) {
    // Erro do sidecar NÃO é cacheado (indisponibilidade transiente ≠ "não existe").
    opts.onResult?.({ method: "none", cache: "miss", resolved: false, outcome: "sidecar_error", error: resp.error })
    return null
  }

  const match = matchComixCandidate(resp.items, request, allowTitleFallback)
  cache.set(key, match?.resolved ?? null, now)
  opts.onResult?.({
    method: match?.method ?? "none",
    cache: "miss",
    resolved: Boolean(match),
    outcome: match ? "resolved" : "no_match",
  })
  return match?.resolved ?? null
}

/** Reset do cache singleton (uso em testes / troca de estratégia). */
export function __resetComixResolveCache(): void {
  defaultCache.clear()
}

import { normalizeText } from "./title-match"
import type { MangagoResolveInput } from "./mangago-variants"
import type { MangagoResolved } from "./mangago-resolve"

/**
 * E8 — Cache in-memory (nível 2 do DESIGN §6) do resolvedor do Mangago. Evita
 * re-buscar (FlareSolverr/searchMangago) a mesma obra. Guarda apenas o resultado
 * mínimo (`MangagoResolved | null`), NUNCA HTML/lista de candidatos. Injetado por
 * DI (`opts.cache`) — não há instância global default nesta etapa.
 *
 * Contrato do `get`: `undefined` = miss · `null` = negative hit · objeto = hit.
 * TTL separado para positivo (24h) e negativo (6h); LRU com refresh no get/set.
 */

// --- Cache key -------------------------------------------------------------

/**
 * Chave determinística por IDENTIDADE do input (não pelas variantes). Precedência
 * `al: → mal: → mu: → t:<título normalizado>`. Sem identidade útil → null (não
 * cacheável). O título usa o MESMO `normalizeText` do matching (mesma chave para
 * variações de caixa/espaço/pontuação).
 */
export function buildMangagoResolveCacheKey(input: MangagoResolveInput): string | null {
  if (input.anilistId != null) return `al:${input.anilistId}`
  if (input.malId != null) return `mal:${input.malId}`
  if (input.mangaUpdatesId != null) return `mu:${input.mangaUpdatesId}`
  const title = normalizeText(input.title)
  return title ? `t:${title}` : null
}

// --- Config (env, parsing seguro — mesmo padrão de mangago-band.ts) ----------

export interface MangagoCacheConfig {
  hitTtlMs: number
  missTtlMs: number
  maxEntries: number
}

export const DEFAULT_CACHE_CONFIG: MangagoCacheConfig = {
  hitTtlMs: 24 * 60 * 60 * 1000,
  missTtlMs: 6 * 60 * 60 * 1000,
  maxEntries: 1000,
}

/** Número finito e POSITIVO; vazio/ausente/inválido/≤0/Infinity → fallback. */
function posNumEnv(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Inteiro positivo; qualquer outra coisa → fallback. */
function posIntEnv(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export function readCacheConfigFromEnv(env: Record<string, string | undefined> = process.env): MangagoCacheConfig {
  return {
    hitTtlMs: posNumEnv(env.MANGAGO_RESOLVE_TTL_HIT_MS, DEFAULT_CACHE_CONFIG.hitTtlMs),
    missTtlMs: posNumEnv(env.MANGAGO_RESOLVE_TTL_MISS_MS, DEFAULT_CACHE_CONFIG.missTtlMs),
    maxEntries: posIntEnv(env.MANGAGO_RESOLVE_CACHE_MAX, DEFAULT_CACHE_CONFIG.maxEntries),
  }
}

// --- Interface + implementação ----------------------------------------------

export interface MangagoResolveCache {
  /** undefined = miss · null = negative hit · objeto = positive hit. */
  get(key: string, now?: number): MangagoResolved | null | undefined
  set(key: string, value: MangagoResolved | null, now?: number): void
  delete?(key: string): void
  clear?(): void
}

interface CacheEntry {
  value: MangagoResolved | null
  expiresAt: number
}

/**
 * LRU sobre `Map` (que preserva ordem de inserção): get/set reinserem a chave no
 * fim (mais recente); a eviction remove a 1ª (menos recente). TTL positivo/negativo
 * separados. Relógio via `now` (default Date.now) → testável sem tempo real.
 */
export class MangagoMemoryResolveCache implements MangagoResolveCache {
  private readonly map = new Map<string, CacheEntry>()
  private readonly config: MangagoCacheConfig

  constructor(config: MangagoCacheConfig = DEFAULT_CACHE_CONFIG) {
    this.config = config
  }

  get(key: string, now: number = Date.now()): MangagoResolved | null | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (now >= entry.expiresAt) {
      this.map.delete(key)
      return undefined
    }
    // Refresh LRU: reinsere no fim.
    this.map.delete(key)
    this.map.set(key, entry)
    return entry.value
  }

  set(key: string, value: MangagoResolved | null, now: number = Date.now()): void {
    const ttl = value === null ? this.config.missTtlMs : this.config.hitTtlMs
    this.map.delete(key)
    this.map.set(key, { value, expiresAt: now + ttl })
    while (this.map.size > this.config.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  delete(key: string): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }

  /** Tamanho atual (utilitário p/ testes/telemetria). */
  get size(): number {
    return this.map.size
  }
}

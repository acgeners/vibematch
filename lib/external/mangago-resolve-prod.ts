import { searchMangago } from "./mangago"
import { extractMangagoSlug } from "./mangago-slug"
import { resolveMangagoUrl } from "./mangago-resolve"
import { buildResolveVariants } from "./mangago-variants"
import { defaultVariantDeps } from "./mangago-variants-deps"
import { MangagoMemoryResolveCache, readCacheConfigFromEnv } from "./mangago-cache"
import { readBandConfigFromEnv, boolEnv } from "./mangago-band"
import { defaultFetchMangagoYear } from "./mangago-year-deps"
import type {
  MangagoResolved,
  MangagoResolveEvent,
  MangagoSearch,
  MangagoSearchCandidate,
  ResolveMangagoOptions,
} from "./mangago-resolve"
import type { MangagoResolveInput } from "./mangago-variants"
import type { ExternalSearchResult } from "./types"

/**
 * E10B.2 — Adapter de PRODUÇÃO que amarra os módulos isolados do resolvedor
 * (`searchMangago` + `resolveMangagoUrl` + variantes + cache + banding + ano).
 * NÃO está plugado no fluxo principal ainda — só quem importar/chamar
 * `resolveMangagoUrlProd` o exercita. Estado global (cache singleton) fica aqui;
 * os testes usam `toMangagoCandidates` (puro) e `buildMangagoResolveProdOpts`
 * (com override de cache/search) para não depender do singleton.
 */

/**
 * Converte resultados do `searchMangago` (`ExternalSearchResult[]`) nos candidatos
 * que o resolvedor consome. PURO: extrai o slug de `id` ("mangago:{slug}") ou de
 * uma URL do Mangago; mapeia `alternativeTitles → otherTitles`; descarta linhas
 * sem slug válido ou sem título. Não faz matching nem normalização.
 */
export function toMangagoCandidates(rows: ExternalSearchResult[]): MangagoSearchCandidate[] {
  const out: MangagoSearchCandidate[] = []
  for (const r of rows ?? []) {
    const rawId = typeof r.id === "string" && r.id.startsWith("mangago:") ? r.id.slice("mangago:".length) : r.id
    const slug = extractMangagoSlug(typeof rawId === "string" ? rawId : "")
    const title = r.title?.trim()
    if (!slug || !title) continue
    out.push({ slug, title, otherTitles: r.alternativeTitles ?? [] })
  }
  return out
}

/** Busca do Mangago adaptada ao contrato do resolvedor. */
export const mangagoSearchAdapter: MangagoSearch = async (query) => toMangagoCandidates(await searchMangago(query))

/** Lê `MANGAGO_RESOLVE_CONFIRM_YEAR` (true/1/yes) com fallback false. */
export function readConfirmYearFromEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return boolEnv(env.MANGAGO_RESOLVE_CONFIRM_YEAR, false)
}

// Cache singleton de módulo — reaproveita entre chamadas no MESMO processo.
const prodCache = new MangagoMemoryResolveCache(readCacheConfigFromEnv())

function logEvent(event: MangagoResolveEvent): void {
  console.info(JSON.stringify({ scope: "mangago-resolve", ...event }))
}

/**
 * Monta as opções de produção do resolvedor. `overrides` permite os testes
 * injetarem `cache`/`search`/etc. sem tocar o singleton global.
 */
export function buildMangagoResolveProdOpts(overrides: Partial<ResolveMangagoOptions> = {}): ResolveMangagoOptions {
  return {
    search: mangagoSearchAdapter,
    buildVariants: (input) => buildResolveVariants(input, defaultVariantDeps),
    bandConfig: readBandConfigFromEnv(),
    cache: prodCache,
    fetchYear: defaultFetchMangagoYear,
    confirmYear: readConfirmYearFromEnv(),
    onResult: logEvent,
    ...overrides,
  }
}

/** Resolve a URL do Mangago em produção (cache de processo, envs reais). */
export function resolveMangagoUrlProd(input: MangagoResolveInput): Promise<MangagoResolved | null> {
  return resolveMangagoUrl(input, buildMangagoResolveProdOpts())
}

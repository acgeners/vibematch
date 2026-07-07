import { extractMangagoSlug } from "./mangago-slug"
import { scoreMangagoCandidate } from "./mangago-match"
import type { MangagoMatchKind } from "./mangago-match"
import { buildResolveVariants, expandAlias } from "./mangago-variants"
import type { MangagoResolveInput, ResolveVariants } from "./mangago-variants"
import { decideMangagoResolveBand, readBandConfigFromEnv } from "./mangago-band"
import type { MangagoBand, MangagoBandConfig } from "./mangago-band"
import { buildMangagoResolveCacheKey } from "./mangago-cache"
import type { MangagoResolveCache } from "./mangago-cache"

export type { MangagoBand } from "./mangago-band"

/**
 * E4 — Resolvedor de URL do Mangago (in-process, fail-soft). Descobre a obra a
 * partir de título/IDs SEM o usuário colar a URL. NÃO faz cache/persistência
 * ainda (E6/E8) nem confirmação por ano (E5). Tudo por DI → testável sem rede.
 *
 * Decisões-chave provadas na investigação (ver DESIGN-MANGAGO-RESOLVE):
 *  - o ranking do backend do Mangago é ruim → sempre **argmax client-side** sobre
 *    TODOS os candidatos, nunca o resultado #1.
 *  - sem cross-ID, matching é title-only fuzzy → banding conservador + margem.
 *  - reverse-substring (candidato curto ⊂ input, ex.: "Stone" p/ "Dr. Stone")
 *    nunca vira AUTO sozinho.
 */

/** Candidato como o `searchMangago` (a ser estendido no wire-in) deve entregar. */
export interface MangagoSearchCandidate {
  slug: string
  title: string
  otherTitles?: string[]
}

export type MangagoSearch = (query: string) => Promise<MangagoSearchCandidate[]>

export interface MangagoResolved {
  slug: string
  url: string
  score: number
  margin: number
  method: string
  band: MangagoBand
  matchedKind: MangagoMatchKind
  matchedTarget: string
  matchedCandidateTitle: string
  queryUsed?: string
}

export type MangagoResolveResult =
  | "auto"
  | "review"
  | "reject"
  | "no_variants"
  | "no_candidates"
  | "search_failed"
  | "year_confirmed"
  | "error"

export interface MangagoYearConfirmation {
  attempted: boolean
  promoted: boolean
  candidatesChecked: number
}

/**
 * E7 — Evento estruturado de observabilidade. EXATAMENTE 1 por chamada de
 * `resolveMangagoUrl`, em todos os caminhos de saída. Pronto para métricas
 * futuras sem infra nova (sem Prometheus/logger global/agregador).
 */
export interface MangagoResolveEvent {
  event: "result" | "skipped"
  result: MangagoResolveResult
  band?: MangagoBand
  /** Motivo do banding (`decideMangagoResolveBand`): "auto" | "below_accept" | "margin_below_auto+…". */
  bandReason?: string
  method?: string
  slug?: string
  url?: string
  topScore?: number
  margin?: number
  matchedKind?: MangagoMatchKind
  matchedTarget?: string
  matchedCandidateTitle?: string
  queryUsed?: string
  queriesRun: number
  candidates: number
  elapsedMs: number
  yearConfirmation?: MangagoYearConfirmation
  errorKind?: string
  /** hit = servido do cache · miss = consultou e não achou · skip = cache ausente/sem chave. */
  cache?: "hit" | "miss" | "skip"
}

export interface ResolveMangagoOptions {
  search: MangagoSearch
  /** Default: variantes só do título direto (wire-in de produção injeta os fetchers). */
  buildVariants?: (input: MangagoResolveInput) => Promise<ResolveVariants>
  /** Config de banding; default = lida de env (MANGAGO_RESOLVE_*) no carregamento. */
  bandConfig?: MangagoBandConfig
  /** E6 — liga a corroboração por ano para desempatar reviews com margem baixa. Default: desligado. */
  confirmYear?: boolean
  /** E6 — busca o ano de um candidato (injetável; produção reusa o detalhe). fail-soft. */
  fetchYear?: (slug: string) => Promise<number | null>
  /** E8 — cache LRU do resolvedor (DI explícito). Sem ele, comportamento = E7. */
  cache?: MangagoResolveCache
  now?: () => number
  onResult?: (event: MangagoResolveEvent) => void
}

// E6 — tolerância na comparação de ano (variants.year vs ano do candidato).
const YEAR_TOLERANCE = 1

// Config de banding lida de env 1x (defaults = comportamento anterior). Injetável
// por `opts.bandConfig` nos testes/callers.
const envBandConfig = readBandConfigFromEnv()

export function mangagoWorkUrl(slug: string): string {
  return `https://www.mangago.me/read-manga/${slug}/`
}

function kindRank(kind: MangagoMatchKind | null): number {
  if (kind === "title") return 0
  if (kind === "otherTitle") return 1
  return 2
}

/** Reconstrói o evento a partir do valor cacheado (sem re-buscar). */
function buildCacheHitEvent(cached: MangagoResolved | null): Omit<MangagoResolveEvent, "elapsedMs"> {
  if (cached === null) {
    // Negative hit: a distinção original reject/no_candidates NÃO é preservada
    // (guardamos só o mínimo) — reportamos como "reject", o negativo canônico.
    return { event: "result", result: "reject", band: "reject", queriesRun: 0, candidates: 0, cache: "hit" }
  }
  return {
    event: "result",
    result: cached.method === "year_confirmed" ? "year_confirmed" : cached.band,
    band: cached.band,
    method: cached.method,
    slug: cached.slug,
    url: cached.url,
    topScore: cached.score,
    margin: cached.margin,
    matchedKind: cached.matchedKind,
    matchedTarget: cached.matchedTarget,
    matchedCandidateTitle: cached.matchedCandidateTitle,
    queryUsed: cached.queryUsed,
    queriesRun: 0,
    candidates: 0,
    cache: "hit",
  }
}

export async function resolveMangagoUrl(
  input: MangagoResolveInput,
  opts: ResolveMangagoOptions
): Promise<MangagoResolved | null> {
  const now = opts.now ?? Date.now
  const started = now()
  const emitRaw = (e: Omit<MangagoResolveEvent, "elapsedMs">) =>
    opts.onResult?.({ ...e, elapsedMs: now() - started })

  // E8 — cache por identidade do input (não pelas variantes). `started` é o relógio
  // do TTL (evita chamadas extras de now() → elapsedMs segue determinístico).
  const cacheKey = buildMangagoResolveCacheKey(input)
  const cacheEnabled = !!opts.cache && !!cacheKey
  const cacheStatus: "hit" | "miss" | "skip" = cacheEnabled ? "miss" : "skip"
  const putCache = (value: MangagoResolved | null) => {
    if (opts.cache && cacheKey) opts.cache.set(cacheKey, value, started)
  }
  const emit = (e: Omit<MangagoResolveEvent, "elapsedMs" | "cache">) => emitRaw({ ...e, cache: cacheStatus })

  try {
    if (opts.cache && cacheKey) {
      const cached = opts.cache.get(cacheKey, started)
      if (cached !== undefined) {
        emitRaw(buildCacheHitEvent(cached))
        return cached
      }
    }

    const build = opts.buildVariants ?? ((i: MangagoResolveInput) => buildResolveVariants(i))
    const variants = await build(input)
    const queriesRun = variants.queries.length

    if (queriesRun === 0 || variants.targets.length === 0) {
      emit({ event: "skipped", result: "no_variants", queriesRun: 0, candidates: 0 })
      return null
    }

    // 1 fetch por query; falha de uma query NÃO derruba as outras. Dedupe por slug,
    // unindo otherTitles entre queries. Guarda a 1ª query que trouxe cada slug.
    const bySlug = new Map<string, MangagoSearchCandidate & { queryUsed: string }>()
    let searchErrors = 0
    for (const query of variants.queries) {
      let results: MangagoSearchCandidate[] = []
      try {
        results = await opts.search(query)
      } catch {
        searchErrors++
        results = []
      }
      for (const raw of results ?? []) {
        const slug = extractMangagoSlug(raw.slug)
        if (!slug || !raw.title) continue
        const existing = bySlug.get(slug)
        if (!existing) {
          bySlug.set(slug, { slug, title: raw.title, otherTitles: raw.otherTitles ?? [], queryUsed: query })
        } else {
          existing.otherTitles = Array.from(new Set([...(existing.otherTitles ?? []), ...(raw.otherTitles ?? [])]))
        }
      }
    }

    if (bySlug.size === 0) {
      // Distingue "todas as queries falharam" de "buscas OK mas sem resultado".
      const allFailed = queriesRun > 0 && searchErrors === queriesRun
      if (!allFailed) putCache(null) // cacheia no_candidates; NÃO cacheia search_failed
      emit({
        event: "result",
        result: allFailed ? "search_failed" : "no_candidates",
        queriesRun,
        candidates: 0,
      })
      return null
    }

    // Pontua cada candidato (argmax global). Expande otherTitles por subtítulo/alias
    // para não sub-pontuar obras com subtítulo grudado ("~Tensai-tachi~").
    const scored = [...bySlug.values()].map((c) => {
      const otherTitles = Array.from(new Set((c.otherTitles ?? []).flatMap(expandAlias)))
      // slug entra p/ o derivative-risk (E10B.6) — nunca influencia o score.
      const s = scoreMangagoCandidate(variants.targets, { title: c.title, otherTitles, slug: c.slug })
      return { candidate: c, score: s }
    })
    scored.sort((a, b) => b.score.score - a.score.score || kindRank(a.score.matchedKind) - kindRank(b.score.matchedKind))

    const top = scored[0]
    const second = scored[1]
    const margin = top.score.score - (second?.score.score ?? 0)
    const bandCfg = opts.bandConfig ?? envBandConfig
    const decision = decideMangagoResolveBand({
      score: top.score.score,
      margin,
      isReverseSubstringRisk: top.score.isReverseSubstringRisk,
      isDerivativeRisk: top.score.isDerivativeRisk,
      config: bandCfg,
    })
    let band: MangagoBand = decision.band

    if (band === "reject" || top.score.matchedKind === null) {
      putCache(null)
      emit({
        event: "result",
        result: "reject",
        band: "reject",
        bandReason: decision.reason,
        slug: top.candidate.slug,
        topScore: top.score.score,
        margin,
        queriesRun,
        candidates: bySlug.size,
      })
      return null
    }

    // E6 — Corroboração por ano: só na faixa REVIEW por margem baixa/empate, com a
    // flag ligada, fetchYear disponível e variants.year presente. Consulta o ano de
    // no MÁX 2 candidatos (top 1 + top 2) e promove a AUTO se EXATAMENTE UM tiver ano
    // compatível (±1). fail-soft: qualquer falha mantém REVIEW.
    let chosen = top
    let method: string = top.score.reason
    const yearConfirmation: MangagoYearConfirmation = { attempted: false, promoted: false, candidatesChecked: 0 }
    if (
      band === "review" &&
      opts.confirmYear === true &&
      opts.fetchYear &&
      variants.year != null &&
      margin < bandCfg.autoMinMargin
    ) {
      const fetchYear = opts.fetchYear
      const targetYear = variants.year
      const consulted = [top, second].filter((c): c is typeof top => !!c) // no máx 2
      const years = await Promise.all(
        consulted.map(async (c) => {
          try {
            return await fetchYear(c.candidate.slug)
          } catch {
            return null
          }
        })
      )
      yearConfirmation.attempted = true
      yearConfirmation.candidatesChecked = consulted.length
      // Só candidatos que seriam AUTO se não fosse a margem, com ano compatível.
      const promotable = consulted.filter(
        (c, i) =>
          c.score.matchedKind !== null &&
          c.score.score >= bandCfg.autoMinScore &&
          !c.score.isReverseSubstringRisk &&
          !c.score.isDerivativeRisk &&
          years[i] != null &&
          Math.abs(years[i]! - targetYear) <= YEAR_TOLERANCE
      )
      if (promotable.length === 1) {
        chosen = promotable[0]
        band = "auto"
        method = "year_confirmed"
        yearConfirmation.promoted = true
      }
    }

    const matchedKind = chosen.score.matchedKind
    if (matchedKind === null) {
      // Inalcançável (top guardado acima; promotable exige matchedKind != null), mas fecha o tipo.
      putCache(null)
      emit({
        event: "result",
        result: "reject",
        band: "reject",
        bandReason: "below_accept",
        slug: chosen.candidate.slug,
        topScore: chosen.score.score,
        margin,
        queriesRun,
        candidates: bySlug.size,
      })
      return null
    }

    const resolved: MangagoResolved = {
      slug: chosen.candidate.slug,
      url: mangagoWorkUrl(chosen.candidate.slug),
      score: chosen.score.score,
      margin,
      method,
      band,
      matchedKind,
      matchedTarget: chosen.score.matchedTarget ?? "",
      matchedCandidateTitle: chosen.score.matchedCandidateTitle ?? "",
      queryUsed: chosen.candidate.queryUsed,
    }
    putCache(resolved)
    emit({
      event: "result",
      result: yearConfirmation.promoted ? "year_confirmed" : band,
      band,
      bandReason: decision.reason,
      method,
      slug: resolved.slug,
      url: resolved.url,
      topScore: resolved.score,
      margin,
      matchedKind,
      matchedTarget: resolved.matchedTarget,
      matchedCandidateTitle: resolved.matchedCandidateTitle,
      queryUsed: resolved.queryUsed,
      queriesRun,
      candidates: bySlug.size,
      yearConfirmation,
    })
    return resolved
  } catch (err) {
    // Fail-soft total: erro inesperado (ex.: buildVariants lançou) não propaga.
    emit({
      event: "result",
      result: "error",
      queriesRun: 0,
      candidates: 0,
      errorKind: err instanceof Error ? err.name : "unknown",
    })
    return null
  }
}

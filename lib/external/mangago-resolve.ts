import { extractMangagoSlug } from "./mangago-slug"
import { scoreMangagoCandidate } from "./mangago-match"
import type { MangagoMatchKind } from "./mangago-match"
import { buildResolveVariants, expandAlias } from "./mangago-variants"
import type { MangagoResolveInput, ResolveVariants } from "./mangago-variants"
import type { TitleSimReason } from "./title-match"

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

export type MangagoBand = "auto" | "review" | "reject"

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

export interface MangagoResolveEvent {
  band: MangagoBand
  result: "resolved" | "review" | "no_match" | "no_variants"
  slug: string | null
  score: number
  margin: number
  candidates: number
  elapsedMs: number
  reason: TitleSimReason | null
}

export interface ResolveMangagoOptions {
  search: MangagoSearch
  /** Default: variantes só do título direto (wire-in de produção injeta os fetchers). */
  buildVariants?: (input: MangagoResolveInput) => Promise<ResolveVariants>
  now?: () => number
  onResult?: (event: MangagoResolveEvent) => void
}

// Regras FIXAS desta etapa (E5 tornará configurável por env).
const AUTO_MIN_SCORE = 0.9
const AUTO_MIN_MARGIN = 0.08
const ACCEPT_MIN_SCORE = 0.72

export function mangagoWorkUrl(slug: string): string {
  return `https://www.mangago.me/read-manga/${slug}/`
}

function decideBand(score: number, margin: number, isReverseSubstringRisk: boolean): MangagoBand {
  if (score < ACCEPT_MIN_SCORE) return "reject"
  if (score >= AUTO_MIN_SCORE && margin >= AUTO_MIN_MARGIN && !isReverseSubstringRisk) return "auto"
  return "review"
}

function kindRank(kind: MangagoMatchKind | null): number {
  if (kind === "title") return 0
  if (kind === "otherTitle") return 1
  return 2
}

export async function resolveMangagoUrl(
  input: MangagoResolveInput,
  opts: ResolveMangagoOptions
): Promise<MangagoResolved | null> {
  const now = opts.now ?? Date.now
  const started = now()
  const build = opts.buildVariants ?? ((i: MangagoResolveInput) => buildResolveVariants(i))
  const emit = (e: Omit<MangagoResolveEvent, "elapsedMs">) =>
    opts.onResult?.({ ...e, elapsedMs: now() - started })

  const variants = await build(input)
  if (variants.queries.length === 0 || variants.targets.length === 0) {
    emit({ band: "reject", result: "no_variants", slug: null, score: 0, margin: 0, candidates: 0, reason: null })
    return null
  }

  // 1 fetch por query; falha de uma query NÃO derruba as outras. Dedupe por slug,
  // unindo otherTitles entre queries. Guarda a 1ª query que trouxe cada slug.
  const bySlug = new Map<string, MangagoSearchCandidate & { queryUsed: string }>()
  for (const query of variants.queries) {
    let results: MangagoSearchCandidate[] = []
    try {
      results = await opts.search(query)
    } catch {
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
    emit({ band: "reject", result: "no_match", slug: null, score: 0, margin: 0, candidates: 0, reason: null })
    return null
  }

  // Pontua cada candidato (argmax global). Expande otherTitles por subtítulo/alias
  // para não sub-pontuar obras com subtítulo grudado ("~Tensai-tachi~").
  const scored = [...bySlug.values()].map((c) => {
    const otherTitles = Array.from(new Set((c.otherTitles ?? []).flatMap(expandAlias)))
    const s = scoreMangagoCandidate(variants.targets, { title: c.title, otherTitles })
    return { candidate: c, score: s }
  })
  scored.sort((a, b) => b.score.score - a.score.score || kindRank(a.score.matchedKind) - kindRank(b.score.matchedKind))

  const top = scored[0]
  const second = scored[1]
  const margin = top.score.score - (second?.score.score ?? 0)
  const band = decideBand(top.score.score, margin, top.score.isReverseSubstringRisk)

  if (band === "reject" || top.score.matchedKind === null) {
    emit({ band: "reject", result: "no_match", slug: top.candidate.slug, score: top.score.score, margin, candidates: bySlug.size, reason: top.score.reason })
    return null
  }

  const resolved: MangagoResolved = {
    slug: top.candidate.slug,
    url: mangagoWorkUrl(top.candidate.slug),
    score: top.score.score,
    margin,
    method: top.score.reason,
    band,
    matchedKind: top.score.matchedKind,
    matchedTarget: top.score.matchedTarget ?? "",
    matchedCandidateTitle: top.score.matchedCandidateTitle ?? "",
    queryUsed: top.candidate.queryUsed,
  }
  emit({
    band,
    result: band === "auto" ? "resolved" : "review",
    slug: resolved.slug,
    score: resolved.score,
    margin,
    candidates: bySlug.size,
    reason: top.score.reason,
  })
  return resolved
}

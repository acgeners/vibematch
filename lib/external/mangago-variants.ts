import { normalizeText } from "./title-match"

/**
 * E3 — Constrói as variantes de busca/pontuação para resolver uma obra no
 * Mangago a partir do que o usuário tem (título direto e/ou IDs externos).
 *
 * PURO dado `deps`: a única fonte de I/O são os fetchers injetados (AniList /
 * MAL / MangaUpdates). Nos testes eles são mockados — nenhuma chamada live.
 * O wiring dos fetchers reais fica em `mangago-variants-deps.ts` (preparado,
 * NÃO integrado ao fluxo ainda).
 *
 * Divisão queries × targets (achado da investigação, ver DESIGN-MANGAGO-RESOLVE):
 *  - `queries`: o que mandar ao `searchMangago`. Poucas (2–3), priorizadas,
 *    SEM brackets/pontuação decorativa (`【】` derruba o recall do backend).
 *  - `targets`: o que usar para PONTUAR os candidatos. Mais amplas — todas as
 *    variantes conhecidas + partes principais extraídas de aliases/subtítulos.
 */

/** Forma normalizada de uma fonte externa (colapsa o que os fetchers já entregam). */
export interface SourceTitles {
  /** Melhor título de exibição (english/romaji). */
  primary?: string
  /** Título no script de origem (native). */
  native?: string
  /** Demais títulos (romaji/synonyms/associated). */
  aliases?: string[]
  year?: number
}

export interface MangagoVariantDeps {
  anilist?: (id: number) => Promise<SourceTitles | null>
  mal?: (id: number) => Promise<SourceTitles | null>
  mangaUpdates?: (id: string | number) => Promise<SourceTitles | null>
}

export interface MangagoResolveInput {
  title?: string
  anilistId?: number
  malId?: number
  mangaUpdatesId?: string | number
}

export interface ResolveVariants {
  queries: string[]
  targets: string[]
  year?: number
}

// Brackets/decorações que atrapalham o backend ou não agregam à busca.
const DECORATIVE = /[【】『』「」〔〕［］〈〉《》\[\]]/g
// Subtítulo no fim entre til (ASCII ~, fullwidth ～, wave 〜): "Título ~Subtítulo~".
const TRAILING_SUBTITLE = /^(.{2,}?)\s*[~～〜][^~～〜]+[~～〜]\s*$/

/**
 * Divide uma variante vinda de alias/otherTitle em partes aproveitáveis.
 * Além de `;` e `/`, extrai a PARTE PRINCIPAL de um subtítulo entre til
 * ("Kaguya-sama wa Kokurasetai ~Tensai-tachi…~" → também "Kaguya-sama wa
 * Kokurasetai"). Mantém sempre a string original para não perder títulos onde
 * o til seja parte real do nome.
 */
export function expandAlias(raw: string): string[] {
  const out: string[] = []
  for (const part of (raw ?? "").split(/[;/｜|]/)) {
    const p = part.trim()
    if (!p) continue
    out.push(p)
    const m = p.match(TRAILING_SUBTITLE)
    if (m && m[1].trim().length >= 2) out.push(m[1].trim())
  }
  return out
}

/** Limpa uma string para uso como QUERY: tira brackets decorativos, colapsa espaço. */
export function normalizeQuery(value: string): string {
  return (value ?? "").replace(DECORATIVE, " ").replace(/\s+/g, " ").trim()
}

/** Dedupe preservando ordem e casing, tratando variações de caixa/pontuação como iguais. */
function dedupeByNormalized(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const key = normalizeText(v)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

async function safe<T>(p: Promise<T | null> | null): Promise<T | null> {
  if (!p) return null
  try {
    return await p
  } catch {
    return null
  }
}

const MAX_QUERIES = 3

export async function buildResolveVariants(
  input: MangagoResolveInput,
  deps: MangagoVariantDeps = {}
): Promise<ResolveVariants> {
  const direct = input.title?.trim() || undefined

  const [al, mal, mu] = await Promise.all([
    input.anilistId != null && deps.anilist ? safe(deps.anilist(input.anilistId)) : null,
    input.malId != null && deps.mal ? safe(deps.mal(input.malId)) : null,
    input.mangaUpdatesId != null && deps.mangaUpdates ? safe(deps.mangaUpdates(input.mangaUpdatesId)) : null,
  ])

  const year = al?.year ?? mal?.year ?? mu?.year

  // TARGETS — tudo, expandido por alias/subtítulo, deduplicado.
  const rawTargets: string[] = []
  if (direct) rawTargets.push(direct)
  for (const s of [al, mal, mu]) {
    if (!s) continue
    if (s.primary) rawTargets.push(s.primary)
    if (s.native) rawTargets.push(s.native)
    for (const a of s.aliases ?? []) rawTargets.push(a)
  }
  const targets = dedupeByNormalized(rawTargets.flatMap(expandAlias).map((t) => t.trim()).filter(Boolean))

  // QUERIES — subconjunto priorizado: english/romaji → native → direto →
  // MAL/MU primary → 1 sinônimo. Normalizadas, deduplicadas, no máx 3.
  const firstAlias = [al, mal, mu].flatMap((s) => s?.aliases ?? [])[0]
  const queryCandidates = [al?.primary, al?.native, direct, mal?.primary, mu?.primary, firstAlias]
    .filter((v): v is string => !!v && !!v.trim())
    .map(normalizeQuery)
    .filter(Boolean)
  const queries = dedupeByNormalized(queryCandidates).slice(0, MAX_QUERIES)

  return { queries, targets, year }
}

/**
 * Núcleo PURO da aba "Sem reviews" (Plano 3 Fase B2.1D). Sem banco, sem
 * `server-only` — testável diretamente. O loader server-only (server/queries)
 * monta os mapas e chama `classifyWorksWithoutReviews`.
 */

/** Chaves de ordenação da lista. `expected` = nota prevista, `reviews` = nº de reviews úteis. */
export type NoReviewSortKey = "title" | "expected" | "reviews"
export interface NoReviewSort {
  key: NoReviewSortKey
  dir: "asc" | "desc"
}

export interface NoReviewWork {
  id: string
  title: string
  coverUrl: string | null
  publicationStatus: string
  publicationStatusId?: number | null
  personalStatus: string
  personalStatusId?: number | null
  aiEvalStatus: string | null
  canonicalPresent: boolean
  usefulReviewCount: number
  acceptedExternalSources: string[]
  lastFetchedAt: string | null
  inGolden: boolean
  /** Nota prevista (calculated_scores.expected_score). */
  expectedScore: number | null
  /** Interesse efetivo (manual `synopsis_quality`, senão o previsto), ♥–♥♥♥♥ ou null. */
  interest: string | null
}

export interface NoReviewFilters {
  q?: string
  pubStatusIds?: number[]
  /** Status de leitura (personal_status). Aplicado no loader (SQL), não aqui. */
  personalStatusIds?: number[]
  hasExternal?: "yes" | "no" | null
  goldenOnly?: boolean
  /** Inclui obras com até esta quantidade de reviews úteis (default 0 = só sem review). */
  maxReviews?: number
  /** Inclui obras com pelo menos esta quantidade de reviews úteis (default 0). Aplicado no loader. */
  minReviews?: number
  /** Interesse na obra (♥–♥♥♥♥ e/ou "none" = sem interesse manual nem previsto). */
  interest?: string[]
  /** Ordenação da lista. Default `{ key: "title", dir: "asc" }`. */
  sort?: NoReviewSort
}

export interface WorkMetaRow {
  id: string
  title: string
  coverUrl: string | null
  publicationStatus: string
  publicationStatusId?: number | null
  personalStatus: string
  personalStatusId?: number | null
  aiEvalStatus: string | null
  canonicalPresent: boolean
  usefulReviewCount: number
  /** Nota prevista (calculated_scores.expected_score). */
  expectedScore: number | null
  /** Interesse efetivo já resolvido (manual ?? previsto) pelo loader, ♥–♥♥♥♥ ou null. */
  interest: string | null
}

/** Ordena `out` in-place pela chave/direção pedidas, com desempate por título (asc). */
export function sortNoReviewWorks(out: NoReviewWork[], sort: NoReviewSort | undefined): void {
  const { key, dir } = sort ?? { key: "title", dir: "asc" }
  const sign = dir === "desc" ? -1 : 1
  // null em expected → -Infinity: vai pro fim em desc (maior primeiro) e pro topo em asc.
  const num = (v: number | null) => (v == null ? -Infinity : v)
  out.sort((a, b) => {
    let primary = 0
    if (key === "expected") primary = num(a.expectedScore) - num(b.expectedScore)
    else if (key === "reviews") primary = a.usefulReviewCount - b.usefulReviewCount
    else primary = a.title.localeCompare(b.title)
    if (primary !== 0) return primary * sign
    return a.title.localeCompare(b.title)
  })
}

/**
 * Monta a lista de obras com poucas reviews úteis e aplica os filtros de busca/fonte/golden/interesse.
 * Recebe SÓ obras já filtradas para a faixa de reviews (o loader filtra por contagem
 * min/max + `is_archived=false` + publication/personal_status no SQL). Ordena conforme `filters.sort`.
 */
export function classifyWorksWithoutReviews(args: {
  works: WorkMetaRow[]
  lastFetchedByWork: Map<string, string | null>
  acceptedSourcesByWork: Map<string, string[]>
  goldenWorkIds: Set<string>
  filters: NoReviewFilters
}): NoReviewWork[] {
  const { filters } = args
  const q = (filters.q ?? "").trim().toLowerCase()
  const interestWanted = filters.interest && filters.interest.length > 0 ? new Set(filters.interest) : null

  const out: NoReviewWork[] = []
  for (const w of args.works) {
    const acceptedExternalSources = [...new Set(args.acceptedSourcesByWork.get(w.id) ?? [])].sort()
    const inGolden = args.goldenWorkIds.has(w.id)
    if (q && !w.title.toLowerCase().includes(q)) continue
    if (filters.hasExternal === "yes" && acceptedExternalSources.length === 0) continue
    if (filters.hasExternal === "no" && acceptedExternalSources.length > 0) continue
    if (filters.goldenOnly && !inGolden) continue
    if (interestWanted) {
      const matches = w.interest != null ? interestWanted.has(w.interest) : interestWanted.has("none")
      if (!matches) continue
    }
    out.push({
      id: w.id,
      title: w.title,
      coverUrl: w.coverUrl,
      publicationStatus: w.publicationStatus,
      publicationStatusId: w.publicationStatusId,
      personalStatus: w.personalStatus,
      personalStatusId: w.personalStatusId,
      aiEvalStatus: w.aiEvalStatus,
      canonicalPresent: w.canonicalPresent,
      usefulReviewCount: w.usefulReviewCount,
      acceptedExternalSources,
      lastFetchedAt: args.lastFetchedByWork.get(w.id) ?? null,
      inGolden,
      expectedScore: w.expectedScore,
      interest: w.interest,
    })
  }
  sortNoReviewWorks(out, filters.sort)
  return out
}

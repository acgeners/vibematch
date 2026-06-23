/**
 * Núcleo PURO da aba "Sem reviews" (Plano 3 Fase B2.1D). Sem banco, sem
 * `server-only` — testável diretamente. O loader server-only (server/queries)
 * monta os mapas e chama `classifyWorksWithoutReviews`.
 */

export interface NoReviewWork {
  id: string
  title: string
  coverUrl: string | null
  publicationStatus: string
  personalStatus: string
  aiEvalStatus: string | null
  canonicalPresent: boolean
  usefulReviewCount: number
  acceptedExternalSources: string[]
  lastFetchedAt: string | null
  inGolden: boolean
}

export interface NoReviewFilters {
  q?: string
  pubStatusIds?: number[]
  hasExternal?: "yes" | "no" | null
  goldenOnly?: boolean
  /** Inclui obras com até esta quantidade de reviews úteis (default 0 = só sem review). */
  maxReviews?: number
}

export interface WorkMetaRow {
  id: string
  title: string
  coverUrl: string | null
  publicationStatus: string
  personalStatus: string
  aiEvalStatus: string | null
  canonicalPresent: boolean
  usefulReviewCount: number
}

/**
 * Monta a lista de obras com poucas reviews úteis e aplica os filtros de busca/fonte/golden.
 * Recebe SÓ obras já filtradas para `usefulReviewCount <= maxReviews` (o loader filtra por
 * contagem + `is_archived=false` + publication_status no SQL). Ordena por título.
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

  const out: NoReviewWork[] = []
  for (const w of args.works) {
    const acceptedExternalSources = [...new Set(args.acceptedSourcesByWork.get(w.id) ?? [])].sort()
    const inGolden = args.goldenWorkIds.has(w.id)
    if (q && !w.title.toLowerCase().includes(q)) continue
    if (filters.hasExternal === "yes" && acceptedExternalSources.length === 0) continue
    if (filters.hasExternal === "no" && acceptedExternalSources.length > 0) continue
    if (filters.goldenOnly && !inGolden) continue
    out.push({
      id: w.id,
      title: w.title,
      coverUrl: w.coverUrl,
      publicationStatus: w.publicationStatus,
      personalStatus: w.personalStatus,
      aiEvalStatus: w.aiEvalStatus,
      canonicalPresent: w.canonicalPresent,
      usefulReviewCount: w.usefulReviewCount,
      acceptedExternalSources,
      lastFetchedAt: args.lastFetchedByWork.get(w.id) ?? null,
      inGolden,
    })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

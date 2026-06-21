/**
 * Núcleo PURO da aba "Sem tags" — espelha `lib/reviews/no-review-classify.ts`.
 * Sem banco, sem `server-only` — testável diretamente. O loader server-only
 * (server/queries) monta os mapas e chama `classifyWorksWithoutTags`.
 */

export interface NoTagsWork {
  id: string
  title: string
  coverUrl: string | null
  publicationStatus: string
  personalStatus: string
  aiEvalStatus: string | null
  canonicalPresent: boolean
  tagCount: number
  acceptedExternalSources: string[]
  inGolden: boolean
}

export interface NoTagsFilters {
  q?: string
  pubStatusIds?: number[]
  hasExternal?: "yes" | "no" | null
  goldenOnly?: boolean
  /** Inclui obras com até esta quantidade de tags (default 0 = só sem tag). */
  maxTags?: number
}

export interface TagWorkMetaRow {
  id: string
  title: string
  coverUrl: string | null
  publicationStatus: string
  personalStatus: string
  aiEvalStatus: string | null
  canonicalPresent: boolean
  tagCount: number
}

/**
 * Monta a lista de obras com poucas tags e aplica os filtros de busca/fonte/golden.
 * Recebe SÓ obras já filtradas para `tagCount <= maxTags` (o loader filtra por
 * contagem + `is_archived=false` + publication_status no SQL). Ordena por título.
 */
export function classifyWorksWithoutTags(args: {
  works: TagWorkMetaRow[]
  acceptedSourcesByWork: Map<string, string[]>
  goldenWorkIds: Set<string>
  filters: NoTagsFilters
}): NoTagsWork[] {
  const { filters } = args
  const q = (filters.q ?? "").trim().toLowerCase()

  const out: NoTagsWork[] = []
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
      tagCount: w.tagCount,
      acceptedExternalSources,
      inGolden,
    })
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

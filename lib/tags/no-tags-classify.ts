/**
 * Núcleo PURO da aba "Sem tags" — espelha `lib/reviews/no-review-classify.ts`.
 * Sem banco, sem `server-only` — testável diretamente. O loader server-only
 * (server/queries) monta os mapas e chama `classifyWorksWithoutTags`.
 */

import type { UiReadiness } from "@/lib/orchestration/ui-readiness"

/** Chaves de ordenação da lista. `expected` = nota prevista, `tags` = nº de tags. */
export type NoTagsSortKey = "title" | "expected" | "tags"
export interface NoTagsSort {
  key: NoTagsSortKey
  dir: "asc" | "desc"
}

export interface NoTagsWork {
  id: string
  title: string
  coverUrls: string[]
  publicationStatus: string
  publicationStatusId?: number | null
  personalStatus: string
  personalStatusId?: number | null
  aiEvalStatus: string | null
  canonicalPresent: boolean
  tagCount: number
  acceptedExternalSources: string[]
  inGolden: boolean
  /** Nota prevista (calculated_scores.expected_score). */
  expectedScore: number | null
  /** Interesse efetivo (manual `synopsis_quality`, senão o previsto), ♥–♥♥♥♥ ou null. */
  interest: string | null
  /** Prontidão da inferência de tags (checkInferTags → UI). null se não computada. */
  readiness?: UiReadiness | null
}

export interface NoTagsFilters {
  q?: string
  pubStatusIds?: number[]
  /** Status de leitura (personal_status). Aplicado no loader (SQL), não aqui. */
  personalStatusIds?: number[]
  hasExternal?: "yes" | "no" | null
  goldenOnly?: boolean
  /** Inclui obras com até esta quantidade de tags (default 0 = só sem tag). */
  maxTags?: number
  /** Inclui obras com pelo menos esta quantidade de tags (default 0). Aplicado no loader. */
  minTags?: number
  /** Interesse na obra (♥–♥♥♥♥ e/ou "none" = sem interesse manual nem previsto). */
  interest?: string[]
  /** Ordenação da lista. Default `{ key: "title", dir: "asc" }`. */
  sort?: NoTagsSort
}

export interface TagWorkMetaRow {
  id: string
  title: string
  coverUrls: string[]
  publicationStatus: string
  publicationStatusId?: number | null
  personalStatus: string
  personalStatusId?: number | null
  aiEvalStatus: string | null
  canonicalPresent: boolean
  tagCount: number
  /** Nota prevista (calculated_scores.expected_score). */
  expectedScore: number | null
  /** Interesse efetivo já resolvido (manual ?? previsto) pelo loader, ♥–♥♥♥♥ ou null. */
  interest: string | null
  /** Prontidão da inferência de tags (checkInferTags → UI). Computada no loader. */
  readiness?: UiReadiness | null
}

/** Ordena `out` in-place pela chave/direção pedidas, com desempate por título (asc). */
export function sortNoTagsWorks(out: NoTagsWork[], sort: NoTagsSort | undefined): void {
  const { key, dir } = sort ?? { key: "title", dir: "asc" }
  const sign = dir === "desc" ? -1 : 1
  const num = (v: number | null) => (v == null ? -Infinity : v)
  out.sort((a, b) => {
    let primary = 0
    if (key === "expected") primary = num(a.expectedScore) - num(b.expectedScore)
    else if (key === "tags") primary = a.tagCount - b.tagCount
    else primary = a.title.localeCompare(b.title)
    if (primary !== 0) return primary * sign
    return a.title.localeCompare(b.title)
  })
}

/**
 * Monta a lista de obras com poucas tags e aplica os filtros de busca/fonte/golden/interesse.
 * Recebe SÓ obras já filtradas para a faixa de tags (o loader filtra por contagem
 * min/max + `is_archived=false` + publication/personal_status no SQL). Ordena conforme `filters.sort`.
 */
export function classifyWorksWithoutTags(args: {
  works: TagWorkMetaRow[]
  acceptedSourcesByWork: Map<string, string[]>
  goldenWorkIds: Set<string>
  filters: NoTagsFilters
}): NoTagsWork[] {
  const { filters } = args
  const q = (filters.q ?? "").trim().toLowerCase()
  const interestWanted = filters.interest && filters.interest.length > 0 ? new Set(filters.interest) : null

  const out: NoTagsWork[] = []
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
      coverUrls: w.coverUrls,
      publicationStatus: w.publicationStatus,
      publicationStatusId: w.publicationStatusId,
      personalStatus: w.personalStatus,
      personalStatusId: w.personalStatusId,
      aiEvalStatus: w.aiEvalStatus,
      canonicalPresent: w.canonicalPresent,
      tagCount: w.tagCount,
      acceptedExternalSources,
      inGolden,
      expectedScore: w.expectedScore,
      interest: w.interest,
      readiness: w.readiness ?? null,
    })
  }
  sortNoTagsWorks(out, filters.sort)
  return out
}

import type { PublicationStatus, CriterionSlug } from "@/types/domain"

export interface TagSuggestion {
  id: string
  name: string
  slug: string
}

export type ExternalSourceId =
  | "mangaupdates"
  | "comick"
  | "anilist"
  | "animeplanet"
  | "comix"
  | "mangadex"
  | "kitsu"
  | "myanimelist"

export interface ExternalSearchResult {
  id: string           // "anilist:123" | "mu:456" | "kitsu:abc" | "mangadex:uuid" | "mal:789"
  source: ExternalSourceId
  title: string
  originalTitle?: string
  alternativeTitles?: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  yearEnd?: number
  publicationStatus?: PublicationStatus
  chapters?: number
  score?: number
  votes?: number
  genres?: string[]
  /** Cross-platform IDs the source itself surfaces (e.g. MangaDex `attributes.links`, AniList `idMal`). Used by the search pipeline to populate sibling-source IDs on the merged candidate so we can hydrate sources whose title search failed. */
  crossIds?: Partial<Record<ExternalSourceId, string>>
}

export interface ExternalSourceCandidateOption {
  source: ExternalSourceId
  externalId: string
  title: string
  coverUrl: string | null
  matchScore: number
  synopsis: string | null
  year: number | null
  chapters: number | null
  trusted?: boolean
}

/** One title deduplicated across sources — what the UI shows */
export interface MergedCandidate {
  title: string
  originalTitle?: string
  alternativeTitles?: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  yearEnd?: number
  publicationStatus?: PublicationStatus
  chapters?: number
  score?: number
  genres?: string[]
  anilistId?: number
  muId?: number
  animePlanetSlug?: string
  kitsuId?: string
  mangadexId?: string
  malId?: number
  sources: ExternalSourceId[]
  matchScore?: number
  comickHid?: string
  comixHid?: string
  sourceResults?: ExternalSearchResult[]
  sourceCandidates?: ExternalSourceCandidateOption[]
  /** Sources whose IDs came from another source's canonical cross-link (e.g. MangaDex `attributes.links`). At hydrate time we skip the title/synopsis acceptance filter for these — the cross-link is the trust signal. */
  trustedSources?: ExternalSourceId[]
}

export interface MultiSourceResult {
  data: ExternalWorkData
  conflicts: ConflictField[]
  debug?: ExternalMergeDebug
}

export interface ConflictOption {
  source: string
  displayValue: string
  value: unknown
}

export interface ConflictField {
  field: keyof ExternalWorkData
  label: string
  options: ConflictOption[]
}

export interface ExternalWorkData {
  title: string
  originalTitle?: string
  alternativeTitles?: string[]
  synopsis?: string
  coverUrl?: string
  year?: number
  yearEnd?: number
  publicationStatus?: PublicationStatus
  totalChapters?: number
  genres: string[]
  tags: string[]
  muRating?: number
  muVotes?: number
  cmxRating?: number
  cmxVotes?: number
  apRating?: number
  apVotes?: number
  externalPlatformRatings?: Array<{
    platform: string
    rating?: number | null
    votes?: number | null
  }>
  /** Indicates that synopsis was concatenated from multiple sources (used by UI for hint) */
  synopsisIsMerged?: boolean
  /** Per-source cover URLs collected during fetch (post-acceptance). Empty when only one accepted source. */
  multiCovers?: Array<{ url: string; source: ExternalSourceId }>
  /** Per-source synopsis blocks collected during fetch (cleaned + deduped). Empty when only one accepted source. */
  multiSynopses?: Array<{ source: ExternalSourceId; text: string }>
  /** Per-source external IDs from accepted sources, persisted to `work_external_ids` so future refreshes skip title search. */
  externalIds?: Partial<Record<ExternalSourceId, string>>
  criteriaScores?: Partial<Record<CriterionSlug, number>>
  criteriaJustifications?: Partial<Record<CriterionSlug, string>>
  /**
   * Metadata da avaliação IA usada pra popular criteriaScores/Justifications.
   * Plumbada até works.ts pra preencher ai_evaluations.input_hash, permitindo
   * cache hit no Path A (página /ai-evaluation) do mesmo título.
   */
  aiMeta?: { inputHash: string; modelName: string; promptVersion: string }
  debug?: ExternalMergeDebug
}

export interface SourcedReview {
  source: ExternalSourceId
  sourceTitle: string
  matchScore: number
  text: string
  /** Nota 0-10 extraída do prefixo "Nota do usuário: X/10" (quando a fonte expõe). */
  userRating?: number
  /** Comprimento do texto antes de qualquer truncamento — usado pelo sampler. */
  textLength?: number
}

export interface ExternalSourceDebug {
  source: string
  sourceId: string
  title?: string
  originalTitle?: string
  alternativeTitles: string[]
  matchScore: number
  accepted: boolean
  rejectionReason?: string
  synopsis?: string
  coverUrl?: string
  year?: number
  yearEnd?: number
  publicationStatus?: string
  chapters?: number
  score?: number
  votes?: number
  genres: string[]
  tags: string[]
  reviews: string[]
}

export interface ExternalMergeDebug {
  queryTitle?: string
  acceptedSources: ExternalSourceDebug[]
  rejectedSources: ExternalSourceDebug[]
  mergedSynopses: Array<{ source: ExternalSourceId; text: string }>
}

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
  sourceResults?: ExternalSearchResult[]
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
  criteriaScores?: Partial<Record<CriterionSlug, number>>
  criteriaJustifications?: Partial<Record<CriterionSlug, string>>
  debug?: ExternalMergeDebug
}

export interface SourcedReview {
  source: ExternalSourceId
  sourceTitle: string
  matchScore: number
  text: string
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

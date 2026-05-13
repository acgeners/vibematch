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

export interface MultiSourceResult {
  data: ExternalWorkData
  conflicts: ConflictField[]
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
  criteriaScores?: Partial<Record<CriterionSlug, number>>
  criteriaJustifications?: Partial<Record<CriterionSlug, string>>
}

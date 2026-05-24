import type { CriterionSlug } from "@/types/domain"

export type RecommendationMode = "next_read" | "full_analysis" | "ranking"

export interface CandidateReview {
  source: string
  rating: number | null
  text: string
}

export interface ProfileTag {
  name: string
  group: string | null
  strength: number
}

export interface ProfileCriterionPreference {
  ideal_min: number
  ideal_max: number
  weight: number
  note?: string | null
}

export interface TasteProfilePayload {
  loved_tags: ProfileTag[]
  avoided_tags: ProfileTag[]
  loved_themes: string[]
  avoided_themes: string[]
  criterion_preferences: Partial<Record<CriterionSlug, ProfileCriterionPreference>>
  narrative_patterns: string[]
  summary: string
}

export interface TasteProfileRow {
  id: string
  version: number
  is_current: boolean
  is_stub: boolean
  n_works_used: number
  input_hash: string
  model_name: string
  prompt_version: string
  profile: TasteProfilePayload
  raw_response: unknown
  created_at: string
}

export interface RankedWork {
  work_id: string
  alignment_score: number
  justification: string
  top_match_factors: string[]
}

export interface RecommendationResult {
  mode_summary: string
  rankings: RankedWork[]
}

export interface RecommendationRunRow {
  id: string
  mode: RecommendationMode
  taste_profile_id: string | null
  user_context: string | null
  n_candidates: number
  candidate_work_ids: string[]
  results: RankedWork[]
  mode_summary: string | null
  model_name: string
  prompt_version: string
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  created_at: string
}

export interface RatedWorkInput {
  id: string
  title: string
  manualScore: number | null
  postScores: Partial<Record<string, number>>
  personalStatus: string | null
  synopsis: string | null
  categoryScores: Partial<Record<CriterionSlug, number>>
  tags: Array<{ name: string; group: string | null }>
}

export interface CandidateWorkInput {
  id: string
  title: string
  synopsis: string | null
  categoryScores: Partial<Record<CriterionSlug, number>>
  tags: Array<{ name: string; group: string | null }>
  platformAvg: number | null
  totalVotes: number | null
  predictedScore: number | null
  reviews: CandidateReview[]
}

export interface RankedCandidate extends RankedWork {
  work: CandidateWorkInput
  coverUrl: string | null
}

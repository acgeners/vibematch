import type { CriterionSlug, ScoreSource } from "@/types/domain"

export type CalibrationMode = "audit" | "bias"

export type SuggestionStatus =
  | "pending"
  | "auto_applied"
  | "accepted"
  | "rejected"
  | "edited"
  | "reverted"
  // Pendente antiga substituída por uma run de audit mais recente do mesmo
  // (obra, atributo). Arquivada: não aparece em Pendentes nem no Histórico.
  | "superseded"

export interface AuditWorkInput {
  workId: string
  title: string
  userScore: number
  isFavorite: boolean
  synopsis: string | null
  observation: string | null
  tags: Array<{ name: string; group: string | null }>
  categoryScores: Partial<Record<CriterionSlug, { score: number; source: ScoreSource }>>
  postScores: Partial<Record<string, number>>
}

export interface AuditSuggestionFromModel {
  workId: string
  criterionSlug: CriterionSlug
  currentScore: number
  suggestedScore: number
  confidence: number
  justification: string
}

export interface BiasStatsByCriterion {
  slug: CriterionSlug
  n: number
  mean: number
  stdev: number
  p25: number
  p50: number
  p75: number
  meanWhenManualHigh: number | null
  meanWhenManualLow: number | null
}

export interface BiasResidualExample {
  workId: string
  title: string
  userScore: number
  calcScore: number | null
  scoresBySlug: Partial<Record<CriterionSlug, number>>
}

export interface BiasCorrelationEntry {
  criterion: CriterionSlug
  postField: string
  pearson: number
  n: number
}

export interface BiasReportEntry {
  criterion_slug: CriterionSlug
  bias_estimate: number
  dispersion: "low" | "medium" | "high"
  confidence: number
  recommendation: string
}

export interface BiasReport {
  summary: string
  entries: BiasReportEntry[]
}

export interface CalibrationRunRow {
  id: string
  mode: CalibrationMode
  status: "processing" | "completed" | "failed"
  n_works_scanned: number
  n_suggestions: number
  n_auto_applied: number
  bias_report: BiasReport | null
  taste_profile_id: string | null
  auto_apply_min_confidence: number
  auto_apply_max_delta: number
  model_name: string
  prompt_version: string
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  cache_creation_tokens: number | null
  error_message: string | null
  created_at: string
  completed_at: string | null
}

export interface SuggestionRow {
  id: string
  run_id: string
  work_id: string
  criterion_slug: CriterionSlug
  previous_score: number
  previous_source: ScoreSource
  suggested_score: number
  delta: number
  confidence: number
  justification: string | null
  status: SuggestionStatus
  applied_score: number | null
  applied_at: string | null
  reviewed_at: string | null
  created_at: string
}

export interface SuggestionWithWork extends SuggestionRow {
  work_title: string
  /**
   * Metadados leves da obra pra tooltip no hover do título — join escalar em
   * `loadSuggestions` (sem blobs de sinopse/scores, pra não inflar o payload).
   */
  /** URL da capa primária (colapsada no server a partir de `work_covers` — 1 string por linha, não o array). */
  work_cover_url?: string | null
  work_user_score?: number | null
  work_is_favorite?: boolean
  work_year?: number | null
  work_total_chapters?: number | null
  work_publication_status_id?: number | null
}

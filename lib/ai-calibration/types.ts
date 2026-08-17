import type { CriterionSlug } from "@/types/domain"

export type CalibrationMode = "audit" | "bias"

/** Só `getCalibrationProvenanceForWork` ainda lê isto — as 37 notas `ai_calibrated` que a
 *  auditoria aposentada deixou no banco precisam continuar mostrando de onde vieram. */
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




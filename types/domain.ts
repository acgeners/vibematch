// ============================================================
// Enums e constantes de domínio
// ============================================================

export const PUBLICATION_STATUSES = ["Completed", "Ongoing", "Hiatus", "Cancelled", "Unknown"] as const
export type PublicationStatus = (typeof PUBLICATION_STATUSES)[number]

export const PERSONAL_STATUSES = [
  "Want to Read",
  "Untracked",
  "Not Now",
  "Reading",
  "Started",
  "Stalled",
  "On-hold",
  "Completed",
  "Hiatus",
  "Dropped",
] as const
export type PersonalStatus = (typeof PERSONAL_STATUSES)[number]

export const SYNOPSIS_QUALITIES = ["♥", "♥♥", "♥♥♥", "♥♥♥♥"] as const
export type SynopsisQuality = (typeof SYNOPSIS_QUALITIES)[number]

export const AI_EVAL_STATUSES = ["pending", "review_pending", "done", "skipped"] as const
export type AiEvalStatus = (typeof AI_EVAL_STATUSES)[number]

export const PLATFORMS = ["mangaupdates", "comick", "comix", "animeplanet", "myanimelist", "mangadex", "kitsu", "anilist", "outros"] as const
export type Platform = (typeof PLATFORMS)[number]

export const CRITERION_SLUGS = [
  "romance",
  "couple_dynamics",
  "fantasy_nobility",
  "action_adventure",
  "adult_content",
  "protagonist",
  "humor",
  "drama",
  "tragedy",
] as const
export type CriterionSlug = (typeof CRITERION_SLUGS)[number]

export const SCORE_SOURCES = [
  "manual",
  "imported",
  "ai_accepted",
  "ai_edited",
  "ai_calibrated",
] as const
export type ScoreSource = (typeof SCORE_SOURCES)[number]

// ============================================================
// Entidades de domínio
// ============================================================

export interface ScoreWeight {
  id: string
  slug: string
  name: string
  weight: number
  threshold: number | null
  display_order: number
  is_active: boolean
}

export interface PlatformRating {
  id: string
  work_id: string
  platform: string
  rating: number | null
  vote_count: number
}

export interface CategoryScore {
  id: string
  work_id: string
  criterion_slug: string
  score: number
  source: ScoreSource
  ai_evaluation_id: string | null
}

export interface CalculatedScore {
  id: string
  work_id: string
  total_votes: number
  platform_avg: number | null
  ia_eval: number | null
  ia_eval_normalized: number | null
  chapters_normalized: number | null
  calc_score: number | null
  /** L1 novo (single Ridge + decomposição). Migration 066. */
  expected_score: number | null
  expected_is_stub: boolean | null
  /** Stage 1 da decomposição (perfil). Migration 068. */
  expected_baseline: number | null
  /** Stage 2 da decomposição (qualidade granular). Migration 068. */
  expected_quality_adj: number | null
  mae_calc: number | null
  rmse_calc: number | null
  /** Alinhamento determinístico (0–1) com o TasteProfile atual. NULL quando perfil é stub. */
  personal_fit: number | null
  /**
   * Percentil (0–100) do personal_fit dentro da biblioteca. 95 = está nos
   * 5% mais alinhados. UI mostra esse valor pra comunicar relativo, já que
   * o personal_fit cru tem teto matemático baixo (~0.55). Migration 071.
   */
  personal_fit_percentile: number | null
  /** Score 0–100 do LLM re-ranker (Passo 8). Atualizado sob demanda. */
  alignment_score: number | null
  alignment_run_id: string | null
  alignment_justification: string | null
  alignment_at: string | null
  /**
   * Payload enriquecido do consultor (sub-fase 2.3.A, prompt v2+). Campos
   * opcionais — runs antigas (v1) ficam NULL.
   */
  alignment_payload: {
    confidence?: number
    risks?: string[]
    similar_loved?: string[]
    similar_avoided?: string[]
    review_quotes?: string[]
    mood_fit?: number
  } | null
  formula_version: string
  calculated_at: string
}

export interface Tag {
  id: string
  slug: string
  name: string
  tag_group_id?: string | null
}

export interface Work {
  id: string
  title: string
  original_title: string | null
  alternative_titles: string[]
  synopsis: string | null
  genres: string[]
  year: number | null
  year_end: number | null
  publication_status_id: number | null
  personal_status_id: number | null
  total_chapters: number | null
  chapters_read: number | null
  synopsis_quality: SynopsisQuality | null
  observation_adjustment: number
  user_score: number | null
  post_story_score: number | null
  post_fl_score: number | null
  post_ml_score: number | null
  post_character_development_score: number | null
  post_pacing_score: number | null
  post_art_visual_score: number | null
  post_impact_immersion_score: number | null
  post_originality_score: number | null
  observations: string | null
  cover_url: string | null
  ai_eval_status: AiEvalStatus
  is_archived: boolean
  is_favorite: boolean
  last_read_at: string | null
  created_at: string
  updated_at: string
  /** Última vez que a inferência de tags por IA rodou (mesmo achando 0). NULL = nunca. */
  tags_inferred_at: string | null
}

export interface WorkCover {
  id: string
  url: string
  source: string
  is_primary: boolean
  position: number
}

export interface WorkSynopsis {
  id: string
  source: string
  text: string
  is_primary: boolean
  position: number
}

/** Review escrita manualmente pelo usuário para alimentar a avaliação IA (tabela `work_manual_reviews`). */
export interface ManualReview {
  id: string
  text: string
  /** Nota 0-10 opcional atribuída pelo usuário. */
  user_rating: number | null
  /** Contexto opcional do usuário — NÃO vai pro prompt. */
  note: string | null
  position: number
}

export interface WorkWithRelations extends Work {
  category_scores: CategoryScore[]
  platform_ratings: PlatformRating[]
  calculated_scores: CalculatedScore | null
  tags: Tag[]
  work_covers?: WorkCover[]
  work_synopses?: WorkSynopsis[]
  /**
   * Previsão de interesse na sinopse (♥–♥♥♥♥) feita pela IA. Não vem do
   * `getWorksByIds`; é mesclada na /favorites a partir dos entries do
   * `getRanking` (irmã da `synopsis_quality`, que é o valor informado pelo
   * usuário). Ausente nas demais telas.
   */
  predicted_synopsis_quality?: SynopsisQuality | null
  predicted_synopsis_stale?: boolean
  predicted_synopsis_confidence?: number | null
}

export interface AiEvaluationScore {
  id: string
  ai_evaluation_id: string
  criterion_slug: string
  suggested_score: number | null
  justification: string | null
  accepted_score: number | null
  was_accepted: boolean | null
  was_edited: boolean
}

export interface AiEvaluation {
  id: string
  work_id: string
  status: "pending" | "processing" | "completed" | "failed"
  model_name: string | null
  prompt_version: string | null
  summary: string | null
  confidence: number | null
  raw_response: unknown
  created_at: string
  updated_at: string
  ai_evaluation_scores?: AiEvaluationScore[]
}

export interface Import {
  id: string
  filename: string
  file_type: string
  sheet_name: string | null
  status: "pending" | "processing" | "completed" | "failed"
  total_rows: number
  imported_count: number
  updated_count: number
  skipped_count: number
  error_count: number
  raw_metadata: unknown
  created_at: string
  completed_at: string | null
}

export interface FormulaConfig {
  id: string
  formula_version: string
  mae_calc: number | null
  mae_predicted: number | null
  /** RMSE dos resíduos — usado em 1/RMSE² no peso de Nota.Final. */
  rmse_calc: number | null
  rmse_predicted: number | null
  /**
   * @deprecated Resíduo do experimento de z-score em normalizeGPT.
   * normalizeGPT foi revertido pra `5 + (gpt-5)*1.25` (single-arg).
   * Colunas mantidas no DB pra não dropar dado; valores nunca atualizados.
   */
  gpt_mean: number | null
  gpt_std: number | null
  /** Diagnósticos persistidos do último recálculo. */
  gpt_clamp_hit_rate: number | null
  negative_activation_rate: Record<string, number> | null
  last_recalculated_at: string | null
  /**
   * Fila de recálculo (migration 096). `recalc_pending` = há edições de nota não
   * recalculadas desde o último recalculateAll; `recalc_last_edit_at` = última
   * edição (o debounce de 1h do auto-recalc conta daqui). Opcionais p/ compat com
   * leituras antes da migration. */
  recalc_pending?: boolean | null
  recalc_last_edit_at?: string | null
  /** P95 das distâncias do treino — threshold de outlier em distanceFactor. */
  distance_p95: number | null
  /** Quantas versões pra trás do prompt são aceitas sem marcar como outdated. */
  prompt_version_tolerance: number
  /** Threshold (0-1) do filtro "Confiança < X%" em /ai-evaluation. */
  low_confidence_threshold: number
  pseudo_votes_nota_m: number
  pseudo_votes_blend: number
  /** Quantos itens exibir no ranking (null = todos). */
  top_n: number | null
  /** Nota.IA mínima exibida no ranking (null = sem filtro). */
  min_calc_score: number | null
  /** Nota.Pr mínima exibida no ranking. */
  min_predicted_score: number | null
  /** Nota.Final mínima exibida no ranking. */
  min_final_score: number | null
  /** Percentil (0-100) acima do qual a nota agregada usa a cor de topo. Default 80. */
  score_color_pct_top: number
  /** Percentil (0-100) acima do qual a nota agregada usa a 2ª cor. Default 60. */
  score_color_pct_high: number
  /** Percentil (0-100) acima do qual a nota agregada usa a 3ª cor. Default 40. */
  score_color_pct_mid: number
  /** Percentil (0-100) acima do qual a nota agregada usa a 4ª cor; abaixo, a pior. Default 20. */
  score_color_pct_low: number
  /**
   * Override opcional de percentis de cor POR critério (slug → {top,high,mid,low}).
   * Slugs ausentes herdam os percentis globais acima. Default `{}`. Opcional no
   * tipo pra compat com leituras antes da migration 082. */
  criterion_color_pcts?: Record<string, { top: number; high: number; mid: number; low: number }> | null
  /**
   * Coeficientes do Ridge segundo-nível (stacker) que combina Calc + Pr (+ kNN futuramente).
   * NULL quando treino < 30 ou stacker desabilitado.
   */
  stacker_coefficients: {
    intercept: number
    calcWeight: number
    ridgeWeight: number
    knnWeight: number | null
    trainSize: number
    cvMAE: number
  } | null
  /** Quando true, Nota.Final usa stacker; quando false, inverse-variance legado. */
  stacker_enabled: boolean
  /**
   * Pesos do Ridge (Nota.Pr) com featureNames alinhados. NULL quando treino < 20
   * (predictor é stub). Usado pra surfacing de feature importance na UI.
   */
  ridge_coefficients: {
    featureNames: string[]
    coefficients: number[]
  } | null
  /**
   * Quando TRUE, recalculateAll usa pesos inferidos via weight-inference no GPT
   * (em vez dos pesos manuais em score_weights). Pesos manuais ficam como
   * fallback. Default TRUE. Migration 069.
   */
  score_weights_auto: boolean
  /**
   * Última inferência (snapshot). NULL quando treino insuficiente (< 20 obras
   * com user_score). Migration 069.
   */
  score_weights_inferred: {
    suggestions: Array<{
      slug: string
      currentWeight: number
      suggestedWeight: number
      delta: number
      confidence: "high" | "medium" | "low"
      coefficient: number
      stderr: number
    }>
    trainSize: number
    alpha: number
    cvMAE: number
  } | null
  /**
   * Fase 1 da re-arquitetura (shadow mode): MAE/RMSE do `expected_score` (L1
   * 2-stage). Convive com mae_calc/mae_predicted até validação MAE ≤
   * 1.05× MAE Nota.Final. Migration 066/067.
   */
  mae_expected: number | null
  rmse_expected: number | null
  /** MAE só do Stage 1 (baseline) — diferença pra mae_expected mostra ganho do Stage 2. */
  mae_expected_baseline: number | null
  cv_mae_expected_stage1: number | null
  cv_mae_expected_stage2: number | null
  expected_stage2_train_size: number | null
  expected_ridge_coefficients: {
    featureNames: string[]
    coefficients: number[]
    stage2FeatureNames?: string[]
    stage2Coefficients?: number[] | null
    /** Peso do blend expected⊕calc (1 = sem blend). */
    calcBlendWeight?: number
    /** Assinatura dos inputs da nested-CV honesta — pula o recompute quando idêntica. */
    cvSig?: string
  } | null
}

// ============================================================
// Tipos de cálculo intermediário
// ============================================================

export interface CategoryScoreMap {
  [slug: string]: number
}

// ============================================================
// Tipos de importação
// ============================================================

export interface RawImportRow {
  [key: string]: string | number | null | undefined
}

export interface MappedImportRow {
  title: string
  romance?: number
  couple_dynamics?: number
  fantasy_nobility?: number
  action_adventure?: number
  adult_content?: number
  protagonist?: number
  humor?: number
  drama?: number
  tragedy?: number
  mu_rating?: number
  mu_votes?: number
  ap_rating?: number
  ap_votes?: number
  cmx_rating?: number
  cmx_votes?: number
  publication_status?: PublicationStatus
  total_chapters?: number
  chapters_read?: number
  synopsis_quality?: SynopsisQuality
  personal_status?: PersonalStatus
  observation_adjustment?: number
  user_score?: number
  ia_eval?: number
  ia_eval_normalized?: number
  calc_score?: number
  predicted_score?: number
  final_score?: number
}

export interface ImportColumnMapping {
  sourceColumn: string
  targetField: keyof MappedImportRow | "ignore"
}

export interface ImportValidationError {
  rowIndex: number
  field: string
  message: string
}

export interface ImportResult {
  importedCount: number
  updatedCount: number
  skippedCount: number
  errorCount: number
  duplicateCount: number
  errors: ImportValidationError[]
  pendingAiCount: number
}

// ============================================================
// Tipos para listagem / filtros
// ============================================================

export interface WorkFilters {
  search?: string
  publicationStatus?: PublicationStatus[]
  personalStatus?: PersonalStatus[]
  aiEvalStatus?: AiEvalStatus[]
  /** Nota prevista (expected_score, 0–10) — filtro headline do novo pipeline. */
  minExpectedScore?: number
  maxExpectedScore?: number
  /** Alinhamento (personal_fit) pelo PERCENTIL 0–100 exibido na UI. */
  minPersonalFitPct?: number
  maxPersonalFitPct?: number
  minChapters?: number
  maxChapters?: number
  minTotalVotes?: number
  maxTotalVotes?: number
  genres?: string[]
  tagSlugs?: string[]
  year?: number
  isArchived?: boolean
  isFavorite?: boolean
}

export type WorkSortField =
  | "final_score"
  | "calc_score"
  | "predicted_score"
  | "expected_score"
  | "title"
  | "publication_status"
  | "personal_status"
  | "total_chapters"
  | "ai_eval_status"
  | "updated_at"
  | "created_at"
  | "is_favorite"
  | "last_read_at"

export interface WorkSort {
  field: WorkSortField
  direction: "asc" | "desc"
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  page: number
  pageSize: number
}

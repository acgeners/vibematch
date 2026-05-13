-- ============================================================
-- 002 - ÍNDICES
-- ============================================================

-- works
CREATE INDEX idx_works_publication_status ON works (publication_status);
CREATE INDEX idx_works_personal_status ON works (personal_status);
CREATE INDEX idx_works_ai_eval_status ON works (ai_eval_status);
CREATE INDEX idx_works_is_archived ON works (is_archived);
CREATE INDEX idx_works_created_at ON works (created_at DESC);

-- calculated_scores (ranking)
CREATE INDEX idx_calculated_scores_final_score ON calculated_scores (final_score DESC NULLS LAST);
CREATE INDEX idx_calculated_scores_calc_score ON calculated_scores (calc_score DESC NULLS LAST);

-- category_scores
CREATE INDEX idx_category_scores_work_id ON category_scores (work_id);
CREATE INDEX idx_category_scores_criterion ON category_scores (criterion_slug);

-- platform_ratings
CREATE INDEX idx_platform_ratings_work_id ON platform_ratings (work_id);

-- ai_evaluations
CREATE INDEX idx_ai_evaluations_work_id ON ai_evaluations (work_id);
CREATE INDEX idx_ai_evaluations_status ON ai_evaluations (status);

-- ai_evaluation_scores
CREATE INDEX idx_ai_evaluation_scores_eval_id ON ai_evaluation_scores (ai_evaluation_id);

-- import_rows
CREATE INDEX idx_import_rows_import_id ON import_rows (import_id);
CREATE INDEX idx_import_rows_work_id ON import_rows (work_id);

-- work_tags
CREATE INDEX idx_work_tags_tag_id ON work_tags (tag_id);

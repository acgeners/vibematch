-- ============================================================
-- 051 - calculated_scores.final_score_confidence: confiança
--       individual (0–1) na Nota.Final de cada obra.
-- ============================================================
-- Combina:
--   base = clamp(1 - rmse_final / 5, 0.2, 1)  (qualidade do modelo)
--   outlier_factor = exp(-(d - p95) / p95)    (se distance > p95)
--   stub_penalty   = 0.3                      (se predicted_is_stub)
--
-- Persistido em recalculateAll() pra ficar queryable/sortable e não
-- recomputar a cada render. Quando rmse_final é null (calibração
-- insuficiente), fica NULL.
-- ============================================================

ALTER TABLE calculated_scores
  ADD COLUMN IF NOT EXISTS final_score_confidence NUMERIC(3,2);

COMMENT ON COLUMN calculated_scores.final_score_confidence IS
  'Confiança (0–1) na Nota.Final desta obra. Combina RMSE global, distância ao centróide de treino e flag de stub. NULL quando calibração é insuficiente.';

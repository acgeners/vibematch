-- ============================================================
-- 033 — Distância ao centróide do treino em calculated_scores
-- ============================================================
-- Distância Euclidiana no espaço de features padronizadas. Quanto maior,
-- mais "fora da distribuição" o título está em relação aos títulos com
-- M.Nota — Nota.Pr fica menos confiável e pesa menos em Nota.Final.
-- ============================================================

ALTER TABLE calculated_scores
  ADD COLUMN IF NOT EXISTS prediction_distance NUMERIC(8, 4);

COMMENT ON COLUMN calculated_scores.prediction_distance IS
  'Distância Euclidiana ao centróide do treino (features padronizadas). NULL quando predictor é stub.';

-- ============================================================
-- 067 - formula_config.mae_expected_baseline + cv_mae:
--       métricas da decomposição 2-stage do expected_score.
-- ============================================================
-- Após o refactor pra 2-stage (Stage 1 baseline + Stage 2 quality adj),
-- precisamos ver no painel o quanto cada stage contribui pra precisão final.
-- Sem isso, ratio total não revela se Stage 2 está fazendo trabalho útil
-- ou se baseline sozinha já dá conta.
--
-- mae_expected_baseline: MAE do Stage 1 puro (sem ajuste de qualidade).
--   Diferença pra mae_expected mostra "ganho do Stage 2".
-- cv_mae_expected_stage1 / stage2: cvMAE honesto de cada stage (do RidgeCV).
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS mae_expected_baseline NUMERIC,
  ADD COLUMN IF NOT EXISTS cv_mae_expected_stage1 NUMERIC,
  ADD COLUMN IF NOT EXISTS cv_mae_expected_stage2 NUMERIC,
  ADD COLUMN IF NOT EXISTS expected_stage2_train_size INTEGER;

COMMENT ON COLUMN formula_config.mae_expected_baseline IS
  'MAE in-sample do Stage 1 (baseline) sozinho — quanto o modelo de perfil acerta sem usar qualidade. Diferença pra mae_expected revela o ganho do Stage 2.';

COMMENT ON COLUMN formula_config.cv_mae_expected_stage1 IS
  'cvMAE honesto do Stage 1 (RidgeCV interno).';

COMMENT ON COLUMN formula_config.cv_mae_expected_stage2 IS
  'cvMAE do Stage 2 — predição de RESÍDUOS Stage 1 a partir das post-scores. NULL quando Stage 2 não foi treinado (poucas obras com post-scores).';

COMMENT ON COLUMN formula_config.expected_stage2_train_size IS
  'Quantas obras de treino tinham ≥ 1 post-score (treino real do Stage 2).';

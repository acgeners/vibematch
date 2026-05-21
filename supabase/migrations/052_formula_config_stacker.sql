-- ============================================================
-- 052 - formula_config.stacker: Ridge segundo-nível como
--       substituto opcional do inverse-variance em Nota.Final.
-- ============================================================
-- O stacker aprende pesos pra Nota.Calc e Nota.Pr (e futuramente
-- kNN) via Ridge segundo-nível ajustado em out-of-fold predictions
-- contra manual_score. Lida com a correlação de erros que o
-- inverse-variance assume não existir.
--
-- stacker_coefficients exemplo:
-- {
--   "intercept": 0.42,
--   "calc_weight": 0.18,
--   "ridge_weight": 0.81,
--   "knn_weight": null,
--   "train_size": 127,
--   "cv_mae": 0.42
-- }
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS stacker_coefficients JSONB,
  ADD COLUMN IF NOT EXISTS stacker_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN formula_config.stacker_coefficients IS
  'Pesos do Ridge segundo-nível (intercept + calc_weight + ridge_weight + knn_weight). NULL quando treino < 30.';
COMMENT ON COLUMN formula_config.stacker_enabled IS
  'Quando true, Nota.Final usa o stacker. Quando false, mantém inverse-variance legado — permite rollback instantâneo.';

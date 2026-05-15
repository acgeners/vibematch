-- ============================================================
-- 030 — RMSE em formula_config
-- ============================================================
-- Nota.Final usa peso de variância inversa entre Nota.Calc e Nota.Pr.
-- Antes usava 1/MAE², que é heurística (MAE não é variância).
-- Agora usa 1/RMSE², que é matematicamente a variância dos resíduos
-- de média zero.
--
-- Colunas nullable: quando não houve calibração suficiente, o consumer
-- detecta null e cai pra Nota.Calc puro (sem blend com Nota.Pr).
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS rmse_calc      NUMERIC(6, 4),
  ADD COLUMN IF NOT EXISTS rmse_predicted NUMERIC(6, 4);

ALTER TABLE formula_config
  ALTER COLUMN mae_calc      DROP NOT NULL,
  ALTER COLUMN mae_predicted DROP NOT NULL;

COMMENT ON COLUMN formula_config.rmse_calc IS
  'RMSE de Nota.Calc vs M.Nota — usado no peso 1/RMSE² em Nota.Final.';
COMMENT ON COLUMN formula_config.rmse_predicted IS
  'RMSE de Nota.Pr vs M.Nota — usado no peso 1/RMSE² em Nota.Final.';

-- Snapshot por título também ganha RMSE e os MAEs viram nullable
-- (pra refletir o caso de calibração insuficiente).
ALTER TABLE calculated_scores
  ADD COLUMN IF NOT EXISTS rmse_calc      NUMERIC(6, 4),
  ADD COLUMN IF NOT EXISTS rmse_predicted NUMERIC(6, 4);

ALTER TABLE calculated_scores
  ALTER COLUMN mae_calc      DROP NOT NULL,
  ALTER COLUMN mae_predicted DROP NOT NULL;

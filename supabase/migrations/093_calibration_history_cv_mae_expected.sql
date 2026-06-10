-- ============================================================
-- calibration_history: snapshot do MAE CV honesto pra trendline
-- ============================================================
-- O histórico gravava só o mae_expected (in-sample, otimista). A headline
-- usa o MAE CV honesto (cv_mae_expected_stage1 em formula_config), que já é
-- calculado todo recálculo. Persistimos esse valor no snapshot pra que o
-- gráfico de tendência mostre o número honesto — o mesmo da headline — em vez
-- do otimista. Snapshots anteriores ficam NULL (a linha começa daqui).

ALTER TABLE calibration_history
  ADD COLUMN IF NOT EXISTS cv_mae_expected NUMERIC;

COMMENT ON COLUMN calibration_history.cv_mae_expected IS
  'Snapshot do MAE CV honesto da Nota Prevista (mesmo valor da headline / formula_config.cv_mae_expected_stage1) no momento do recálculo. NULL em snapshots anteriores à migration 093.';

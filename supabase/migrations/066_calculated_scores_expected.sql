-- ============================================================
-- 066 - calculated_scores.expected_score + expected_is_stub:
--       L1 do novo pipeline (Ridge cleaned), persistido em shadow
--       mode ao lado de calc_score/predicted_score/final_score.
-- ============================================================
-- Decisão arquitetural: re-arquitetura em 4 camadas substituindo
-- Nota.IA/Pr/Final por expected_score + fit_score + match_score.
-- Fase 1 (shadow mode): computa o novo expected_score em paralelo
-- e compara MAE com Nota.Final atual. Critério de avanço pra Fase 2:
-- MAE(expected) ≤ 1.05× MAE(final).
--
-- expected_score: predição do Ridge cleaned (lib/calculations/expected.ts),
--                 sem IA(n) redundante e sem features de personal-fit
--                 (que viram L2 fit_score). Range [0, 10].
-- expected_is_stub: true quando treino < 20 (predictor devolve média
--                   constante). Permite filtrar/destacar no UI.
-- ============================================================

ALTER TABLE calculated_scores
  ADD COLUMN IF NOT EXISTS expected_score NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS expected_is_stub BOOLEAN;

COMMENT ON COLUMN calculated_scores.expected_score IS
  'L1 do pipeline novo (Ridge cleaned). Shadow mode: convive com calc/predicted/final_score até validação MAE ≤ 1.05× Nota.Final.';

COMMENT ON COLUMN calculated_scores.expected_is_stub IS
  'True quando o predictor L1 caiu no fallback de média constante (treino < 20 amostras com manual_score).';

CREATE INDEX IF NOT EXISTS idx_calculated_scores_expected_score
  ON calculated_scores (expected_score DESC NULLS LAST);

-- ============================================================
-- formula_config: métricas e coeficientes do novo Ridge cleaned
-- ============================================================
-- mae_expected / rmse_expected: in-sample contra manual_score, mesma
--   metodologia de mae_calc/mae_predicted pra comparação direta.
-- expected_ridge_coefficients: featureNames + coefficients alinhados,
--   pra surfacing de feature importance no painel.
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS mae_expected NUMERIC,
  ADD COLUMN IF NOT EXISTS rmse_expected NUMERIC,
  ADD COLUMN IF NOT EXISTS expected_ridge_coefficients JSONB;

COMMENT ON COLUMN formula_config.mae_expected IS
  'MAE in-sample do expected_score (L1 novo) contra manual_score. NULL quando treino < 20.';

COMMENT ON COLUMN formula_config.rmse_expected IS
  'RMSE in-sample do expected_score. Pode alimentar peso variância-inversa futuro se o blend voltar.';

COMMENT ON COLUMN formula_config.expected_ridge_coefficients IS
  'Pesos do Ridge cleaned (L1) com featureNames + coefficients alinhados. NULL no stub.';

-- ============================================================
-- calibration_history: snapshot do mae_expected pra trendline
-- ============================================================

ALTER TABLE calibration_history
  ADD COLUMN IF NOT EXISTS mae_expected NUMERIC;

COMMENT ON COLUMN calibration_history.mae_expected IS
  'Snapshot do MAE do expected_score (L1) no momento do recálculo. Permite trendline shadow vs Nota.Final no painel.';

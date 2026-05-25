-- ============================================================
-- 061 - calibration_history: snapshots periódicos das métricas
--       de calibração pra acompanhar tendência ao longo do tempo.
-- ============================================================
-- Cada execução de `recalculateAll` insere uma linha. Permite
-- responder "as previsões estão melhorando/piorando?" com
-- sparkline e diff vs último snapshot.
--
-- Não há limpeza automática — a expectativa é volume baixo
-- (algumas dezenas por mês). Se crescer demais, adicionar
-- truncate dos snapshots > 365d via job.
-- ============================================================

CREATE TABLE IF NOT EXISTS calibration_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  formula_version TEXT,
  stacker_enabled BOOLEAN,
  -- KPI principal: LOOCV do stacker (precisão honesta).
  mae_loocv_stacker NUMERIC,
  -- MAEs in-sample (informativos, podem estar otimistas).
  mae_final NUMERIC,
  mae_calc NUMERIC,
  mae_predicted NUMERIC,
  -- Contexto da base.
  train_size INTEGER,
  total_works INTEGER,
  -- Coeficientes do stacker no momento do snapshot.
  stacker_coefficients JSONB
);

CREATE INDEX IF NOT EXISTS calibration_history_recorded_at_idx
  ON calibration_history (recorded_at DESC);

ALTER TABLE calibration_history ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE calibration_history IS
  'Snapshot append-only das métricas de calibração após cada recalculateAll. Usado pra sparkline e detecção de regressão no painel /settings.';

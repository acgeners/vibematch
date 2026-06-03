-- ============================================================
-- 086 - synopsis_quality_predictions: uma previsão por (obra, prompt_version)
-- ============================================================
-- Permite manter previsões de VERSÕES DE PROMPT diferentes lado a lado (ex.:
-- v1 e v2) pra comparação pareada — saber se a recalibração do prompt realmente
-- baixou o erro nas MESMAS obras. Antes, UNIQUE(work_id) deixava só 1 previsão
-- por obra (reprever sobrescrevia). Agora a chave é (work_id, prompt_version).
-- ============================================================

ALTER TABLE synopsis_quality_predictions
  DROP CONSTRAINT IF EXISTS synopsis_quality_predictions_work_id_key;

ALTER TABLE synopsis_quality_predictions
  ADD CONSTRAINT synopsis_quality_predictions_work_prompt_key UNIQUE (work_id, prompt_version);

CREATE INDEX IF NOT EXISTS idx_synopsis_quality_pred_version
  ON synopsis_quality_predictions (prompt_version);

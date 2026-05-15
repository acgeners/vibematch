-- ============================================================
-- 022 - Adiciona calculated_scores.confidence como pass-through
-- da ai_evaluations.confidence mais recente da obra. Atualizado
-- pelo recalculate via RPC refresh_calculated_scores_confidence().
-- ============================================================

ALTER TABLE calculated_scores
  ADD COLUMN IF NOT EXISTS confidence numeric;

-- Função que popula calculated_scores.confidence a partir da
-- ai_evaluations.confidence mais recente (status='completed') de cada obra.
-- Chamada pelo recalculate após o upsert principal.
CREATE OR REPLACE FUNCTION refresh_calculated_scores_confidence()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE calculated_scores cs
  SET confidence = latest.confidence
  FROM (
    SELECT DISTINCT ON (work_id) work_id, confidence
    FROM ai_evaluations
    WHERE status = 'completed' AND confidence IS NOT NULL
    ORDER BY work_id, created_at DESC
  ) AS latest
  WHERE cs.work_id = latest.work_id
    AND (cs.confidence IS DISTINCT FROM latest.confidence);

  -- Limpa confidence em rows cuja avaliação foi apagada.
  UPDATE calculated_scores cs
  SET confidence = NULL
  WHERE cs.confidence IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM ai_evaluations ae
      WHERE ae.work_id = cs.work_id
        AND ae.status = 'completed'
        AND ae.confidence IS NOT NULL
    );
END $$;

-- Backfill inicial.
SELECT refresh_calculated_scores_confidence();

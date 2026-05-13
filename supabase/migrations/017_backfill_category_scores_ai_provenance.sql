-- ============================================================
-- 017 - Backfill category_scores.source and ai_evaluation_id for
-- rows that were created by the "✨ Buscar dados" / external AI flow
-- but ended up stamped as source='manual' with NULL ai_evaluation_id
-- because the legacy createWork() inserted category_scores BEFORE
-- creating the ai_evaluations row. The code path was fixed in
-- server/actions/works.ts (Fase 1.1); this migration reclassifies
-- existing rows so reporting and audit queries see the real origin.
-- ============================================================

WITH ai_origin AS (
  SELECT
    aes.criterion_slug,
    ae.work_id,
    ae.id AS ai_evaluation_id,
    aes.accepted_score
  FROM ai_evaluation_scores aes
  JOIN ai_evaluations ae ON ae.id = aes.ai_evaluation_id
  WHERE ae.model_name = 'external-ai-criteria'
)
UPDATE category_scores cs
SET
  source = 'ai_accepted',
  ai_evaluation_id = ai_origin.ai_evaluation_id
FROM ai_origin
WHERE cs.work_id = ai_origin.work_id
  AND cs.criterion_slug = ai_origin.criterion_slug
  AND cs.source = 'manual'
  AND cs.ai_evaluation_id IS NULL;

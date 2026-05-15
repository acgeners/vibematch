-- ============================================================
-- 020 - Backfill restante de category_scores marcadas como
-- source='manual' mas com ai_evaluation_id populado. Estas vieram
-- do fluxo /ai-evaluation (path A) onde submitAiReview deveria ter
-- gravado 'ai_accepted'/'ai_edited' mas em algum ponto histórico
-- gravou 'manual'. A migration 017 só cobriu o path B (busca externa,
-- model_name='external-ai-criteria').
--
-- Decisão por linha:
--   - score == ai_evaluation_scores.accepted_score → 'ai_accepted'
--   - score != accepted_score                      → 'ai_edited'
--   - accepted_score IS NULL                       → 'ai_accepted' (assume aceite)
-- ============================================================

UPDATE category_scores cs
SET source = CASE
  WHEN aes.accepted_score IS NULL THEN 'ai_accepted'
  WHEN cs.score = aes.accepted_score THEN 'ai_accepted'
  ELSE 'ai_edited'
END
FROM ai_evaluation_scores aes
WHERE cs.ai_evaluation_id = aes.ai_evaluation_id
  AND cs.criterion_slug   = aes.criterion_slug
  AND cs.source           = 'manual'
  AND cs.ai_evaluation_id IS NOT NULL;

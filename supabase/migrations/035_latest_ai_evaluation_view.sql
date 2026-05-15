-- ============================================================
-- 035 — View latest_ai_evaluation_per_work
-- ============================================================
-- Source-of-truth pra "última avaliação por obra". Usado por /ai-evaluation
-- ao filtrar obras por confiança ou modelo desatualizado.
--
-- DISTINCT ON requer ORDER BY (work_id, key DESC). Pega o registro mais
-- recente (created_at) por work_id, ignorando o resto.
-- ============================================================

CREATE OR REPLACE VIEW latest_ai_evaluation_per_work AS
SELECT DISTINCT ON (work_id)
  work_id,
  id           AS evaluation_id,
  status,
  model_name,
  prompt_version,
  confidence,
  input_hash,
  created_at,
  updated_at
FROM ai_evaluations
WHERE status = 'completed'
ORDER BY work_id, created_at DESC;

COMMENT ON VIEW latest_ai_evaluation_per_work IS
  'Última ai_evaluations.status="completed" por work_id. Atualiza automaticamente — não precisa de refresh.';

-- ============================================================
-- 124 - Atrela recomendações/desempate IA a um grupo de favoritos
-- ============================================================
-- Quando o usuário roda "Recomendar com IA" de dentro de um grupo
-- (/favorites/<id>), o run gerado (que já fica registrado em
-- /recommendations) recebe o list_id do grupo. Assim o grupo consegue
-- listar "recomendações deste grupo" sem duplicar nada — o run continua
-- sendo o mesmo recurso navegável de sempre.
--
-- ON DELETE SET NULL: apagar o grupo não apaga o histórico da recomendação.
-- ============================================================

ALTER TABLE recommendation_runs
  ADD COLUMN IF NOT EXISTS list_id UUID REFERENCES work_lists(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_recommendation_runs_list_id
  ON recommendation_runs (list_id, created_at DESC)
  WHERE list_id IS NOT NULL;

COMMENT ON COLUMN recommendation_runs.list_id IS
  'Grupo de favoritos (work_lists) de onde a recomendação foi disparada; NULL = recomendação global.';

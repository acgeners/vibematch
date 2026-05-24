-- Acelera a view `latest_ai_evaluation_per_work` (definida em 035).
--
-- A view faz `DISTINCT ON (work_id) ... WHERE status = 'completed'
-- ORDER BY work_id, created_at DESC`. Sem este índice, Postgres escaneia a
-- tabela inteira e ordena. Conforme `ai_evaluations` cresce (cada avaliação
-- IA adiciona uma linha), a query passa do statement timeout do PostgREST
-- (8-10s) e a página /ai-evaluation começa a falhar com "fetch failed".
--
-- O índice serve EXATAMENTE o padrão do DISTINCT ON: agrupar por work_id,
-- pegar o mais recente, filtrando completed. Predicate parcial pra ficar
-- pequeno (a maioria das avaliações termina como completed).
CREATE INDEX IF NOT EXISTS idx_ai_evaluations_latest_completed
  ON ai_evaluations (work_id, created_at DESC)
  WHERE status = 'completed';

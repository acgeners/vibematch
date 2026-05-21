-- ============================================================
-- 056 - LLM re-ranker: alignment_score persistido por obra.
-- ============================================================
-- Persistir o último alignment_score de cada obra (resultado do LLM
-- re-ranker generalizado, Passo 8) permite que essa coluna apareça
-- como sort option em /ranking mesmo dias depois do re-rank.
--
-- A coluna NÃO é recalculada em recalculateAll(). Só é atualizada
-- quando rerankTopN() roda explicitamente — ranking sob demanda.
-- ============================================================

ALTER TABLE calculated_scores
  ADD COLUMN IF NOT EXISTS alignment_score NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS alignment_run_id UUID REFERENCES recommendation_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS alignment_justification TEXT,
  ADD COLUMN IF NOT EXISTS alignment_at TIMESTAMPTZ;

COMMENT ON COLUMN calculated_scores.alignment_score IS
  'Score 0–100 produzido pelo LLM re-ranker (Passo 8). Atualizado sob demanda via rerankTopN().';
COMMENT ON COLUMN calculated_scores.alignment_run_id IS
  'Run que produziu este alignment_score. NULL se a run foi deletada.';
COMMENT ON COLUMN calculated_scores.alignment_justification IS
  'Justificativa textual do LLM pra o alignment_score (1-2 frases).';
COMMENT ON COLUMN calculated_scores.alignment_at IS
  'Timestamp do último re-rank. Útil pra UI mostrar "rankeado há X tempo".';

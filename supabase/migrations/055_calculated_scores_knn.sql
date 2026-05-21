-- ============================================================
-- 055 - kNN sobre embeddings:
--       * colunas knn_score, knn_neighbors em calculated_scores
--       * RPC find_knn_with_manual_score: top-k vizinhos rotulados
-- ============================================================
-- knn_score: predição derivada via kernel Gaussiano sobre os k
--            vizinhos mais próximos que TÊM manual_score.
-- knn_neighbors: jsonb com [{work_id, similarity, manual_score, weight}]
--                pra debug/explicabilidade.
-- ============================================================

ALTER TABLE calculated_scores
  ADD COLUMN IF NOT EXISTS knn_score NUMERIC(4,2),
  ADD COLUMN IF NOT EXISTS knn_neighbors JSONB;

COMMENT ON COLUMN calculated_scores.knn_score IS
  'Predição via kNN (kernel Gaussiano) sobre os k vizinhos mais próximos no espaço de embeddings que têm manual_score. NULL quando a obra não tem embedding ou há poucos rotulados.';
COMMENT ON COLUMN calculated_scores.knn_neighbors IS
  'Top-k vizinhos usados na predição: [{work_id, similarity, manual_score, weight}]. Útil pra explicabilidade.';

-- RPC: pra cada chamada, retorna os k vizinhos rotulados mais próximos.
-- Exclui a própria obra (importante pra leave-one-out implícito quando a
-- obra-alvo também é rotulada). HNSW garante busca rápida.
CREATE OR REPLACE FUNCTION find_knn_with_manual_score(
  target_work_id UUID,
  match_limit INT DEFAULT 15
)
RETURNS TABLE (
  work_id UUID,
  similarity FLOAT,
  manual_score NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH target AS (
    SELECT embedding FROM work_embeddings WHERE work_id = target_work_id
  )
  SELECT
    we.work_id,
    1 - (we.embedding <=> (SELECT embedding FROM target)) AS similarity,
    w.manual_score
  FROM work_embeddings we
  JOIN works w ON w.id = we.work_id
  WHERE we.work_id != target_work_id
    AND w.manual_score IS NOT NULL
    AND w.is_archived = false
    AND EXISTS (SELECT 1 FROM target)
  ORDER BY we.embedding <=> (SELECT embedding FROM target)
  LIMIT match_limit;
$$;

COMMENT ON FUNCTION find_knn_with_manual_score(UUID, INT) IS
  'Top-K vizinhos no espaço de embeddings que possuem manual_score. Exclui a própria obra (leave-one-out implícito).';

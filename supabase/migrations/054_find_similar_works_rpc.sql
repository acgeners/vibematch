-- ============================================================
-- 054 - RPC find_similar_works: top-K obras mais similares à
--       obra-alvo via cosine distance no pgvector.
-- ============================================================
-- Implementada como function SQL pra que o operador `<=>` rode
-- direto no Postgres usando o índice HNSW, sem trafegar o vetor
-- de 1536 floats pelo cliente Supabase.
--
-- Retorna similaridade (1 - cosine_distance) ordenada desc.
-- Exclui a própria obra-alvo e obras arquivadas.
-- ============================================================

CREATE OR REPLACE FUNCTION find_similar_works(
  target_work_id UUID,
  match_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  similarity FLOAT,
  manual_score NUMERIC,
  final_score NUMERIC,
  personal_fit NUMERIC,
  cover_url TEXT,
  synopsis TEXT
)
LANGUAGE sql STABLE
AS $$
  WITH target AS (
    SELECT embedding FROM work_embeddings WHERE work_id = target_work_id
  ),
  ranked AS (
    SELECT
      we.work_id,
      1 - (we.embedding <=> (SELECT embedding FROM target)) AS similarity
    FROM work_embeddings we
    WHERE we.work_id != target_work_id
      AND EXISTS (SELECT 1 FROM target)
    ORDER BY we.embedding <=> (SELECT embedding FROM target)
    LIMIT match_limit
  )
  SELECT
    w.id,
    w.title,
    r.similarity,
    w.manual_score,
    cs.final_score,
    cs.personal_fit,
    (
      SELECT wc.url FROM work_covers wc
      WHERE wc.work_id = w.id
      ORDER BY wc.is_primary DESC NULLS LAST, wc.position ASC NULLS LAST
      LIMIT 1
    ) AS cover_url,
    (
      SELECT ws.text FROM work_synopses ws
      WHERE ws.work_id = w.id
      ORDER BY ws.is_primary DESC NULLS LAST, ws.position ASC NULLS LAST
      LIMIT 1
    ) AS synopsis
  FROM ranked r
  JOIN works w ON w.id = r.work_id
  LEFT JOIN calculated_scores cs ON cs.work_id = w.id
  WHERE w.is_archived = false
  ORDER BY r.similarity DESC;
$$;

COMMENT ON FUNCTION find_similar_works(UUID, INT) IS
  'Retorna as match_limit obras mais similares à target_work_id via cosine distance no espaço de embeddings.';

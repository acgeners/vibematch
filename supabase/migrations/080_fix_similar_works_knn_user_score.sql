-- ============================================================
-- 080 - Conserta RPCs após o rename manual_score → user_score (073)
-- ============================================================
-- A 073 renomeou works.manual_score → works.user_score, mas find_similar_works
-- (054) e find_knn_with_manual_score (055) não foram recriadas: continuavam
-- selecionando w.manual_score (coluna inexistente) e a knn mantinha o nome
-- antigo, enquanto o código já chama find_knn_with_user_score / lê user_score.
-- ============================================================

-- find_similar_works: coluna de retorno manual_score → user_score.
-- (mudar RETURNS TABLE = mudar assinatura → DROP antes do CREATE)
DROP FUNCTION IF EXISTS find_similar_works(UUID, INT);

CREATE FUNCTION find_similar_works(
  target_work_id UUID,
  match_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  similarity FLOAT,
  user_score NUMERIC,
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
    w.user_score,
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
  'Top match_limit obras similares via cosine distance. Retorna user_score (renomeado de manual_score na 073).';

-- find_knn: renomeia para find_knn_with_user_score + usa user_score.
DROP FUNCTION IF EXISTS find_knn_with_manual_score(UUID, INT);
DROP FUNCTION IF EXISTS find_knn_with_user_score(UUID, INT);

CREATE FUNCTION find_knn_with_user_score(
  target_work_id UUID,
  match_limit INT DEFAULT 15
)
RETURNS TABLE (
  work_id UUID,
  similarity FLOAT,
  user_score NUMERIC
)
LANGUAGE sql STABLE
AS $$
  WITH target AS (
    SELECT embedding FROM work_embeddings WHERE work_id = target_work_id
  )
  SELECT
    we.work_id,
    1 - (we.embedding <=> (SELECT embedding FROM target)) AS similarity,
    w.user_score
  FROM work_embeddings we
  JOIN works w ON w.id = we.work_id
  WHERE we.work_id != target_work_id
    AND w.user_score IS NOT NULL
    AND w.is_archived = false
    AND EXISTS (SELECT 1 FROM target)
  ORDER BY we.embedding <=> (SELECT embedding FROM target)
  LIMIT match_limit;
$$;

COMMENT ON FUNCTION find_knn_with_user_score(UUID, INT) IS
  'Top-K vizinhos com user_score (renomeado de find_knn_with_manual_score na 073).';

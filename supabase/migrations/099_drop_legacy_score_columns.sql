-- ============================================================
-- 099 - Drop do pipeline de notas legado (Nota.Pr / Nota.Final / kNN)
-- ============================================================
-- O cutover de 30/05 elegeu `expected_score` ("Nota Prevista") como a previsão
-- de referência. As colunas do ramo antigo já estavam mortas no nível de dados
-- (o recalc gravava NULL desde a faxina do U1) e o display/sort já foi removido.
-- Esta migration remove de vez as colunas órfãs de `calculated_scores`, aposenta
-- a RPC do kNN (preditor desligado, zero callers — item H3) e repõe
-- `find_similar_works` retornando `expected_score` no lugar de `final_score`.
--
-- ESCOPO: só `calculated_scores` + as 2 RPCs. NÃO toca `formula_config`
-- (mae_predicted/rmse_predicted/min_predicted_score/min_final_score/stacker_*/
-- gpt_*) nem `calibration_history` — esses são um cleanup cosmético à parte, e
-- `min_predicted_score`/`min_final_score` foram REPURPOSADOS como preferências
-- vivas do ranking (IA Rk / Nota Prevista mínima).
--
-- O índice idx_calculated_scores_final_score (002) é dropado automaticamente
-- junto com a coluna final_score.
-- ============================================================

-- ---------- 1) Colunas legadas de calculated_scores ----------
ALTER TABLE calculated_scores
  DROP COLUMN IF EXISTS predicted_score,
  DROP COLUMN IF EXISTS predicted_is_stub,
  DROP COLUMN IF EXISTS final_score,
  DROP COLUMN IF EXISTS final_score_confidence,
  DROP COLUMN IF EXISTS mae_predicted,
  DROP COLUMN IF EXISTS rmse_predicted,
  DROP COLUMN IF EXISTS prediction_distance,
  DROP COLUMN IF EXISTS knn_score,
  DROP COLUMN IF EXISTS knn_neighbors;

-- ---------- 2) RPC do kNN-preditor (H3 — preditor desligado) ----------
DROP FUNCTION IF EXISTS find_knn_with_user_score(UUID, INT);

-- ---------- 3) find_similar_works: final_score → expected_score ----------
-- Mudar o RETURNS TABLE = mudar assinatura → DROP antes do CREATE.
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
  expected_score NUMERIC,
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
    cs.expected_score,
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
  'Top match_limit obras similares via cosine distance. Retorna expected_score (Nota Prevista; era final_score legado, aposentado na 099).';

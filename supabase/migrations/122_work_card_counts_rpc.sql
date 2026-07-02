-- 122 — RPC agregada de contagens por obra (tags + reviews úteis)
--
-- MOTIVO (perf /ai-evaluation): hoje as contagens de tags/reviews por obra são
-- feitas contando LINHAS em JS após varrer as tabelas inteiras — work_tags (~30k),
-- work_reviews (~10k). Isso trafega dezenas de milhares de linhas pro Node e faz
-- muitos round-trips paginados (caro contra o DB remoto). Esta RPC agrega em SQL
-- (GROUP BY) e devolve UMA linha por obra, colapsando os scans numa única chamada.
--
-- Regra de "review útil" = espelha lib/reviews/useful-review.ts (≥ 40 chars):
--   • work_reviews:                 text_length >= 40      (comprimento bruto persistido)
--   • work_external_reviews_manual: char_length(btrim(text)) >= 40
--
-- Uso:
--   • work_card_counts(ARRAY[...]::uuid[])  → contagens só das obras dadas (cards exibidos)
--   • work_card_counts(NULL)                → contagens de TODAS as obras (universo tags-reviews)
--
-- Padrão já existente no repo: get_sidebar_badge_counts (agrega server-side + fallback TS).

CREATE OR REPLACE FUNCTION work_card_counts(work_ids uuid[] DEFAULT NULL)
RETURNS TABLE (work_id uuid, tag_count integer, review_count integer)
LANGUAGE sql
STABLE
AS $$
  WITH base AS (
    SELECT id FROM works
    WHERE (work_ids IS NULL OR id = ANY (work_ids))
  ),
  t AS (
    SELECT wt.work_id, count(*) AS cnt
    FROM work_tags wt
    WHERE (work_ids IS NULL OR wt.work_id = ANY (work_ids))
    GROUP BY wt.work_id
  ),
  r AS (
    SELECT wr.work_id, count(*) AS cnt
    FROM work_reviews wr
    WHERE wr.text_length >= 40
      AND (work_ids IS NULL OR wr.work_id = ANY (work_ids))
    GROUP BY wr.work_id
  ),
  m AS (
    SELECT wm.work_id, count(*) AS cnt
    FROM work_external_reviews_manual wm
    WHERE char_length(btrim(wm.text)) >= 40
      AND (work_ids IS NULL OR wm.work_id = ANY (work_ids))
    GROUP BY wm.work_id
  )
  SELECT
    b.id AS work_id,
    COALESCE(t.cnt, 0)::int AS tag_count,
    (COALESCE(r.cnt, 0) + COALESCE(m.cnt, 0))::int AS review_count
  FROM base b
  LEFT JOIN t ON t.work_id = b.id
  LEFT JOIN r ON r.work_id = b.id
  LEFT JOIN m ON m.work_id = b.id;
$$;

-- Índices que sustentam os GROUP BY / filtros por work_id (idempotentes).
CREATE INDEX IF NOT EXISTS idx_work_tags_work_id ON work_tags (work_id);
CREATE INDEX IF NOT EXISTS idx_work_reviews_work_id ON work_reviews (work_id);
CREATE INDEX IF NOT EXISTS idx_work_external_reviews_manual_work_id ON work_external_reviews_manual (work_id);

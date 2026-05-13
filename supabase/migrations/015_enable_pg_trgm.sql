-- 015 - Enable pg_trgm + duplicate-detection helper used by the "✨ Buscar dados"
-- flow to avoid re-importing a work that already lives in the catalog.
--
-- Idempotent: rerunnable without side effects.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram GIN index so similarity() / % queries on lower(title) stay fast.
CREATE INDEX IF NOT EXISTS idx_works_title_trgm
  ON works USING GIN (lower(title) gin_trgm_ops);

-- Given a list of candidate titles (canonical, original, alternativos), returns
-- works that could be the same one. First exact matches (title, original_title,
-- alternative_titles array), then fuzzy by trigram similarity ≥ 0.70.
CREATE OR REPLACE FUNCTION find_works_matching_titles(query_titles TEXT[])
RETURNS TABLE (
  id UUID,
  title TEXT,
  original_title TEXT,
  alternative_titles TEXT[],
  match_type TEXT,
  similarity REAL
)
LANGUAGE sql
STABLE
AS $$
  WITH inputs AS (
    SELECT DISTINCT lower(trim(unnest(query_titles))) AS q
  ),
  filtered_inputs AS (
    SELECT q FROM inputs WHERE length(q) >= 2
  ),
  exact_matches AS (
    SELECT
      w.id,
      w.title,
      w.original_title,
      w.alternative_titles,
      CASE
        WHEN lower(w.title) = i.q THEN 'exact_title'
        WHEN lower(coalesce(w.original_title, '')) = i.q THEN 'original_title'
        ELSE 'exact_alt'
      END AS match_type,
      1.0::real AS similarity
    FROM works w
    CROSS JOIN filtered_inputs i
    WHERE w.is_archived = false
      AND (
        lower(w.title) = i.q
        OR lower(coalesce(w.original_title, '')) = i.q
        OR EXISTS (
          SELECT 1 FROM unnest(w.alternative_titles) AS at
          WHERE lower(at) = i.q
        )
      )
  ),
  fuzzy_matches AS (
    SELECT
      w.id,
      w.title,
      w.original_title,
      w.alternative_titles,
      'fuzzy'::text AS match_type,
      similarity(lower(w.title), i.q) AS similarity
    FROM works w
    CROSS JOIN filtered_inputs i
    WHERE w.is_archived = false
      AND similarity(lower(w.title), i.q) >= 0.70
      AND w.id NOT IN (SELECT id FROM exact_matches)
  )
  SELECT DISTINCT ON (id) id, title, original_title, alternative_titles, match_type, similarity
  FROM (
    SELECT * FROM exact_matches
    UNION ALL
    SELECT * FROM fuzzy_matches
  ) all_matches
  ORDER BY id, similarity DESC, match_type
  LIMIT 10;
$$;

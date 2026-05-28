-- ============================================================
-- 062 - recommendation_runs.slug: URLs amigáveis para /recommendations
-- ============================================================
-- Substitui o UUID na URL por um slug curto baseado em data + sequência
-- diária (ex. "2026-05-25-3"). Mantém ordem cronológica natural e cabe em
-- URLs/QR codes. Backfill determinístico: row_number sobre data de criação.

ALTER TABLE recommendation_runs
  ADD COLUMN IF NOT EXISTS slug TEXT;

-- Backfill: para cada dia, numera as runs em ordem de criação (1, 2, 3...).
WITH numbered AS (
  SELECT
    id,
    to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')
      || '-' ||
      ROW_NUMBER() OVER (
        PARTITION BY (created_at AT TIME ZONE 'UTC')::date
        ORDER BY created_at
      ) AS computed_slug
  FROM recommendation_runs
)
UPDATE recommendation_runs r
SET slug = n.computed_slug
FROM numbered n
WHERE r.id = n.id
  AND r.slug IS NULL;

ALTER TABLE recommendation_runs
  ALTER COLUMN slug SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS recommendation_runs_slug_idx
  ON recommendation_runs (slug);

COMMENT ON COLUMN recommendation_runs.slug IS
  'URL slug no formato YYYY-MM-DD-N onde N é a sequência diária. Gerado app-side com retry em colisão.';

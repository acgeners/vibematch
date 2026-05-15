-- ============================================================
-- 025 - Drop das colunas legadas works.synopsis e works.cover_url.
-- work_synopses + work_covers passam a ser a única fonte de verdade.
--
-- Backfill defensivo só roda se as colunas ainda existirem (idempotente).
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'works' AND column_name = 'synopsis'
  ) THEN
    INSERT INTO work_synopses (work_id, source, text, is_primary, position)
    SELECT
      w.id, 'manual', w.synopsis, true, 0
    FROM works w
    WHERE w.synopsis IS NOT NULL
      AND length(trim(w.synopsis)) > 0
      AND NOT EXISTS (SELECT 1 FROM work_synopses ws WHERE ws.work_id = w.id);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'works' AND column_name = 'cover_url'
  ) THEN
    INSERT INTO work_covers (work_id, url, source, is_primary, position)
    SELECT
      w.id, w.cover_url, 'manual', true, 0
    FROM works w
    WHERE w.cover_url IS NOT NULL
      AND length(trim(w.cover_url)) > 0
      AND NOT EXISTS (SELECT 1 FROM work_covers wc WHERE wc.work_id = w.id);
  END IF;
END $$;

ALTER TABLE works DROP COLUMN IF EXISTS synopsis;
ALTER TABLE works DROP COLUMN IF EXISTS cover_url;

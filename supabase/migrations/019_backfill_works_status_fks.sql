-- ============================================================
-- 019 - Backfill works.publication_status_id and works.personal_status_id
-- from the legacy text columns using publication_status.previous /
-- personal_status.previous as the lookup. After this migration is
-- applied, the code switches to reading the FK columns (Fase 3.2) and
-- the legacy text columns can be dropped in Fase 4.1, followed by the
-- "previous" columns themselves.
-- ============================================================

UPDATE works w
SET publication_status_id = ps.id
FROM publication_status ps
WHERE w.publication_status_id IS NULL
  AND w.publication_status IS NOT NULL
  AND w.publication_status = ps.previous;

UPDATE works w
SET personal_status_id = ps.id
FROM personal_status ps
WHERE w.personal_status_id IS NULL
  AND w.personal_status IS NOT NULL
  AND w.personal_status = ps.previous;

-- Sanity report: rows that still have a non-null text status but no FK
-- after the backfill. These need manual review (likely a value that
-- doesn't match any `previous` entry in the reference tables).
DO $$
DECLARE
  pub_orphans INTEGER;
  pers_orphans INTEGER;
BEGIN
  SELECT COUNT(*) INTO pub_orphans
  FROM works
  WHERE publication_status IS NOT NULL AND publication_status_id IS NULL;
  SELECT COUNT(*) INTO pers_orphans
  FROM works
  WHERE personal_status IS NOT NULL AND personal_status_id IS NULL;

  RAISE NOTICE 'works sem publication_status_id apos backfill: %', pub_orphans;
  RAISE NOTICE 'works sem personal_status_id apos backfill: %', pers_orphans;
END $$;

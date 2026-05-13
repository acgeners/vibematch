-- ============================================================
-- 005 - Novos campos em works: year_end, observations
-- ============================================================

ALTER TABLE works
  ADD COLUMN year_end     INTEGER,
  ADD COLUMN observations TEXT;

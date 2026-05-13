ALTER TABLE works
  ADD COLUMN IF NOT EXISTS alternative_titles TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_works_alternative_titles_gin
  ON works USING GIN (alternative_titles);

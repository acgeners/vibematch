-- ============================================================
-- 004 - Novos campos em works: synopsis, genres, year, original_title
-- ============================================================

ALTER TABLE works
  ADD COLUMN synopsis       TEXT,
  ADD COLUMN genres         TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN year           INTEGER,
  ADD COLUMN original_title TEXT;

-- Índice GIN para busca em array de gêneros
CREATE INDEX idx_works_genres ON works USING GIN (genres);

-- Índice para filtro por ano
CREATE INDEX idx_works_year ON works (year);

-- Keep external sources in the user-defined display order and allow dynamic sources
-- from the source table to be saved in platform_ratings.

ALTER TABLE source
  ADD COLUMN IF NOT EXISTS "order" INTEGER;

UPDATE source
SET "order" = seed.display_order
FROM (VALUES
  ('Manga Updates', 1),
  ('ComicK', 2),
  ('AniList', 3),
  ('Anime Planet', 4),
  ('Comix', 5)
) AS seed(name, display_order)
WHERE lower(source.name) = lower(seed.name)
  AND source."order" IS NULL;

ALTER TABLE platform_ratings
  DROP CONSTRAINT IF EXISTS platform_valid;

ALTER TABLE platform_ratings
  ADD CONSTRAINT platform_valid
  CHECK (platform ~ '^[a-z0-9][a-z0-9-]{0,79}$');

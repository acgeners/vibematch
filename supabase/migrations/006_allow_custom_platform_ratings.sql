-- Allow manually added external rating sources while keeping platform names URL-safe.
ALTER TABLE platform_ratings
  DROP CONSTRAINT IF EXISTS platform_valid;

ALTER TABLE platform_ratings
  ADD CONSTRAINT platform_valid
  CHECK (platform ~ '^[a-z0-9][a-z0-9-]{0,79}$');

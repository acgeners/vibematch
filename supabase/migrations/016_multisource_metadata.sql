-- ============================================================
-- 016 - Multi-source metadata: store every cover and synopsis the
-- "✨ Buscar dados" flow returns, with attribution to the originating
-- source. The legacy works.cover_url and works.synopsis remain populated
-- as a "primary" cache so existing list/detail pages keep rendering
-- without changes.
-- ============================================================

-- ---- COVERS ----
CREATE TABLE IF NOT EXISTS work_covers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id     UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  source      TEXT NOT NULL,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_covers_url_per_work UNIQUE (work_id, url),
  CONSTRAINT work_covers_source_format
    CHECK (source ~ '^[a-z0-9][a-z0-9-]{0,79}$')
);

-- At most one primary cover per work.
CREATE UNIQUE INDEX IF NOT EXISTS work_covers_one_primary
  ON work_covers (work_id) WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_work_covers_work
  ON work_covers (work_id, position);

-- ---- SYNOPSES ----
CREATE TABLE IF NOT EXISTS work_synopses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id     UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  text        TEXT NOT NULL,
  is_primary  BOOLEAN NOT NULL DEFAULT false,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_synopses_source_format
    CHECK (source ~ '^[a-z0-9][a-z0-9-]{0,79}$')
);

-- At most one primary synopsis per work.
CREATE UNIQUE INDEX IF NOT EXISTS work_synopses_one_primary
  ON work_synopses (work_id) WHERE is_primary = true;

CREATE INDEX IF NOT EXISTS idx_work_synopses_work
  ON work_synopses (work_id, position);

-- ---- RLS ----
ALTER TABLE work_covers ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_synopses ENABLE ROW LEVEL SECURITY;
-- No permissive policies: only the service role (used by createAdminClient) can access.

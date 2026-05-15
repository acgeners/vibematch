-- ============================================================
-- 027 - Persist external source IDs (anilist, mangaupdates, mal,
-- kitsu, mangadex, comick, comix, animeplanet) per work so the
-- "Atualizar dados" flow on the work detail page can rehydrate
-- external metadata without re-running a title search or invoking
-- the AI evaluation pipeline. Mirrors work_covers / work_synopses:
-- one row per (work_id, source).
-- ============================================================

CREATE TABLE IF NOT EXISTS work_external_ids (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id     UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_external_ids_source_format
    CHECK (source ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  CONSTRAINT work_external_ids_unique
    UNIQUE (work_id, source)
);

CREATE INDEX IF NOT EXISTS idx_work_external_ids_lookup
  ON work_external_ids (source, external_id);

ALTER TABLE work_external_ids ENABLE ROW LEVEL SECURITY;
-- No permissive policies: only the service role (used by createAdminClient) can access.

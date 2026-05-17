-- Tag alias table for canonical tag resolution.
-- Lets ingestion paths map historical/external slug variants
-- (e.g. snake_case `abandoned_protagonist`) to the canonical
-- kebab-case tag in `tags`. The consolidation script (Phase 1)
-- populates this table when collapsing format duplicates;
-- ingestion code (upsertTagsBatch / upsertExternalTags) consults
-- it before creating new rows in `tags`.

CREATE TABLE IF NOT EXISTS tag_alias (
  alias_slug       TEXT PRIMARY KEY,
  canonical_tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tag_alias_canonical_idx
  ON tag_alias (canonical_tag_id);

-- Service role only (no RLS policies). Same pattern as other tables.
ALTER TABLE tag_alias ENABLE ROW LEVEL SECURITY;

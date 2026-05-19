-- ============================================================
-- 043 — Tag group move proposals (Phase 2 extension: group audit)
-- ============================================================
-- AI-generated proposals to move a tag from its current group
-- (e.g. "cast") to a better-fitting one (e.g. "characters").
-- Distinct from `tag_cluster_proposal` (Phase 2) which groups
-- multiple tag synonyms into one canonical; here each proposal
-- is per-tag and only changes `tag_group_id`.
--
-- Lifecycle: pending → approved | rejected
--            approved → applied (after moveTagToGroup runs)
-- ============================================================

CREATE TABLE IF NOT EXISTS tag_group_move_proposal (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id               UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  current_group_slug   TEXT NOT NULL,
  suggested_group_slug TEXT NOT NULL,
  confidence           NUMERIC(3, 2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  rationale            TEXT,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','approved','rejected','applied')),
  reviewed_at          TIMESTAMPTZ,
  applied_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tag_id, status)
);

CREATE INDEX IF NOT EXISTS tag_group_move_status_idx
  ON tag_group_move_proposal (status);
CREATE INDEX IF NOT EXISTS tag_group_move_tag_idx
  ON tag_group_move_proposal (tag_id);

COMMENT ON TABLE tag_group_move_proposal IS
  'AI-suggested tag-group reclassifications awaiting human review.';

ALTER TABLE tag_group_move_proposal ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 041 — Tag cluster proposals (Phase 2: semantic consolidation)
-- ============================================================
-- Stores AI-proposed semantic clusters of tag names within a
-- single tag_group. Each cluster groups ≥2 existing tags that
-- describe the same concept (e.g. "abused-female-lead" +
-- "abused-protagonist") so a human reviewer can approve/edit
-- before the merge is applied via the tag_alias infrastructure
-- (migration 040).
--
-- Lifecycle: pending → approved | rejected
--            approved → applied (after destructive merge runs)
-- ============================================================

CREATE TABLE IF NOT EXISTS tag_cluster_proposal (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_slug      TEXT NOT NULL,
  canonical_name  TEXT NOT NULL,
  canonical_slug  TEXT NOT NULL,
  member_tag_ids  UUID[] NOT NULL,
  confidence      NUMERIC(3, 2) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  rationale       TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','approved','rejected','applied')),
  reviewed_at     TIMESTAMPTZ,
  applied_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tag_cluster_proposal_status_idx
  ON tag_cluster_proposal (status);

CREATE INDEX IF NOT EXISTS tag_cluster_proposal_group_idx
  ON tag_cluster_proposal (group_slug);

COMMENT ON TABLE tag_cluster_proposal IS
  'AI-generated semantic clusters of tags, awaiting human review before merge.';

ALTER TABLE tag_cluster_proposal ENABLE ROW LEVEL SECURITY;

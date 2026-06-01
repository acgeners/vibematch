-- ============================================================
-- 044 — Tag sub-groups (organizational layer: Group → Sub-group → tags)
-- ============================================================
-- Adds an intermediate, purely organizational/visual layer between
-- `tag_group` and the individual tags. Within a group like
-- "female_lead", tags are bucketed into a handful of collapsible
-- sub-groups (e.g. Looks / Traits / Context) so long flat tag lists
-- become navigable. Independent from `tag_cluster_proposal` /
-- `tag_alias` (synonym merging) — a tag can be in a cluster AND a
-- sub-group; the two layers don't interact.
--
-- Two-phase, human-reviewed flow:
--   Phase 1 (tag_subgroup): AI proposes sub-groups per group.
--            Lifecycle: pending → approved | rejected.
--            (No "applied" — an approved sub-group is already a real
--             bucket ready to receive tags.)
--   Phase 2 (tag_subgroup_assignment): AI assigns each tag to one
--            approved sub-group. Lifecycle: pending → approved |
--            rejected; approved → applied (writes tags.tag_subgroup_id).
-- ============================================================

-- 1. Sub-group definitions (+ Phase-1 review lifecycle).
CREATE TABLE IF NOT EXISTS tag_subgroup (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_group_id  UUID NOT NULL REFERENCES tag_group(id) ON DELETE CASCADE,
  group_slug    TEXT NOT NULL,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  description   TEXT,
  rationale     TEXT,
  confidence    NUMERIC(3, 2) CHECK (confidence BETWEEN 0 AND 1),
  sort_order    INT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected')),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tag_group_id, slug)
);

CREATE INDEX IF NOT EXISTS tag_subgroup_status_idx ON tag_subgroup (status);
CREATE INDEX IF NOT EXISTS tag_subgroup_group_idx  ON tag_subgroup (group_slug);

COMMENT ON TABLE tag_subgroup IS
  'AI-proposed organizational sub-groups within a tag_group, awaiting human review.';

ALTER TABLE tag_subgroup ENABLE ROW LEVEL SECURITY;

-- 2. Final assignment of a tag to a sub-group (result of Phase 2).
ALTER TABLE tags ADD COLUMN IF NOT EXISTS tag_subgroup_id UUID NULL
  REFERENCES tag_subgroup(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tags_subgroup_idx ON tags (tag_subgroup_id);

-- 3. Phase-2 assignment proposals (staging before writing tags.tag_subgroup_id).
CREATE TABLE IF NOT EXISTS tag_subgroup_assignment (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id        UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  subgroup_id   UUID NOT NULL REFERENCES tag_subgroup(id) ON DELETE CASCADE,
  group_slug    TEXT NOT NULL,
  confidence    NUMERIC(3, 2) CHECK (confidence BETWEEN 0 AND 1),
  status        TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','applied')),
  reviewed_at   TIMESTAMPTZ,
  applied_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tag_id)
);

CREATE INDEX IF NOT EXISTS tag_subgroup_assignment_status_idx
  ON tag_subgroup_assignment (status);
CREATE INDEX IF NOT EXISTS tag_subgroup_assignment_subgroup_idx
  ON tag_subgroup_assignment (subgroup_id);
CREATE INDEX IF NOT EXISTS tag_subgroup_assignment_group_idx
  ON tag_subgroup_assignment (group_slug);

COMMENT ON TABLE tag_subgroup_assignment IS
  'AI-proposed assignments of a tag to an approved sub-group, awaiting human review before tags.tag_subgroup_id is set.';

ALTER TABLE tag_subgroup_assignment ENABLE ROW LEVEL SECURITY;

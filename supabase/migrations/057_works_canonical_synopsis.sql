-- Canonical synopsis: AI-consolidated single-source synopsis for use in
-- recommendation prompts (replaces the legacy multi-source concatenated text).
-- Persisted so consolidation only runs when the input synopses change.
ALTER TABLE works ADD COLUMN canonical_synopsis TEXT;
ALTER TABLE works ADD COLUMN canonical_synopsis_at TIMESTAMPTZ;
-- sha256 of the sorted+joined input blocks; lets the worker skip re-consolidating
-- when the work_synopses rows didn't actually change.
ALTER TABLE works ADD COLUMN canonical_synopsis_inputs_hash TEXT;

-- Allow `ranking` mode (candidates from /ranking respecting the page filters)
-- in addition to the existing favorites-only modes.
ALTER TABLE recommendation_runs DROP CONSTRAINT IF EXISTS recommendation_runs_mode_check;
ALTER TABLE recommendation_runs
  ADD CONSTRAINT recommendation_runs_mode_check
  CHECK (mode IN ('next_read', 'full_analysis', 'ranking'));

-- Track truncation: how many candidates were available before we sliced to n.
-- NULL means legacy run (pre-migration) — UI shows nothing in that case.
ALTER TABLE recommendation_runs ADD COLUMN n_available INTEGER;

-- For the new `ranking` mode, persist the filter set used so the run is
-- reproducible/debuggable. Free-form JSON keyed by `RankingFilters` field.
ALTER TABLE recommendation_runs ADD COLUMN source_meta JSONB;

-- AI-consolidated summary of a work's external reviews, shown in the
-- "Notas & Avaliações" tab (mirrors canonical_synopsis). Generated via Haiku
-- whenever the persisted work_reviews change.
ALTER TABLE works ADD COLUMN review_summary TEXT;
ALTER TABLE works ADD COLUMN review_summary_at TIMESTAMPTZ;
-- sha256 of the sorted+joined review texts; lets the writer skip re-summarizing
-- when work_reviews didn't actually change.
ALTER TABLE works ADD COLUMN review_summary_inputs_hash TEXT;

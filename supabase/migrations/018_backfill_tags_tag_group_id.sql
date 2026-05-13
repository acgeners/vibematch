-- ============================================================
-- 018 - Backfill tag_group_id for orphan tags created by the
-- legacy upsertExternalTags() (which inserted without classifying).
-- All NULL tag_group_id rows are routed to the "Other" group so
-- the UI stops showing empty group columns. New tags created from
-- this point on get classified at insert time via the AI tag
-- classifier (see lib/ai-evaluation/tag-classifier.ts).
-- ============================================================

UPDATE tags
SET tag_group_id = '606e6239-515b-46c5-b985-9f41f948cdc9'
WHERE tag_group_id IS NULL;

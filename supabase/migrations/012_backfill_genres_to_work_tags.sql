-- Backfill legacy works.genres into work_tags using tags from the Genre group.
-- The work_tags primary key prevents duplicate work/tag pairs.
INSERT INTO work_tags (work_id, tag_id)
SELECT DISTINCT expanded.work_id, tags.id
FROM (
  SELECT works.id AS work_id, trim(genre_name) AS genre_name
  FROM works
  CROSS JOIN LATERAL unnest(works.genres) AS genre_name
  WHERE trim(genre_name) <> ''
) AS expanded
JOIN tags
  ON tags.tag_group_id = '04eadb9a-5cc8-42ec-bbb3-1408fd7a1b7e'
 AND lower(trim(tags.name)) = lower(expanded.genre_name)
ON CONFLICT (work_id, tag_id) DO NOTHING;

-- ============================================================
-- 042 — Add separate tag groups for Male Lead and Female Lead
-- ============================================================
-- The "characters" group accumulated ~600 tags mixing gender/role
-- archetypes ("cold-female-lead", "abused-male-mc"...) with truly
-- generic ones ("naive-protagonist", "assassin"). Splitting into
-- three groups (`male_lead`, `female_lead`, `characters`) lets
-- the semantic clustering work within each role independently
-- and improves filter UX.
--
-- This migration only creates the groups. A follow-up script
-- (`scripts/reclassify-character-tags.js`) moves existing tags
-- into the appropriate group using AI classification.
-- ============================================================

-- tag_group.slug didn't have a UNIQUE constraint yet (legacy schema).
-- Add it so ON CONFLICT works, and so future ingestion can rely on it.
ALTER TABLE tag_group
  ADD CONSTRAINT tag_group_slug_unique UNIQUE (slug);

INSERT INTO tag_group (slug, "group", description, example)
VALUES
  (
    'male_lead',
    'Male Lead',
    'A tag descreve atributos, papel, personalidade ou trajetória especificamente do protagonista masculino (male lead / ML).',
    'Cold Male Lead, Possessive ML, Abused Male Protagonist, Tsundere ML.'
  ),
  (
    'female_lead',
    'Female Lead',
    'A tag descreve atributos, papel, personalidade ou trajetória especificamente da protagonista feminina (female lead / FL).',
    'Cold Female Lead, Abused FL, Reincarnated Female Lead, Naive Heroine.'
  )
ON CONFLICT (slug) DO NOTHING;

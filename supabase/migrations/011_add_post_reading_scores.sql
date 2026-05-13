-- ============================================================
-- 011 - Campos de avaliação pós-leitura em works
-- ============================================================

ALTER TABLE works
  ADD COLUMN IF NOT EXISTS post_story_score NUMERIC(3, 1),
  ADD COLUMN IF NOT EXISTS post_fl_score NUMERIC(3, 1),
  ADD COLUMN IF NOT EXISTS post_ml_score NUMERIC(3, 1),
  ADD COLUMN IF NOT EXISTS post_character_development_score NUMERIC(3, 1),
  ADD COLUMN IF NOT EXISTS post_pacing_score NUMERIC(3, 1),
  ADD COLUMN IF NOT EXISTS post_art_visual_score NUMERIC(3, 1),
  ADD COLUMN IF NOT EXISTS post_impact_immersion_score NUMERIC(3, 1),
  ADD COLUMN IF NOT EXISTS post_originality_score NUMERIC(3, 1);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'works_post_story_score_range') THEN
    ALTER TABLE works ADD CONSTRAINT works_post_story_score_range
      CHECK (post_story_score IS NULL OR post_story_score IN (2, 4, 6.5, 8, 10));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'works_post_fl_score_range') THEN
    ALTER TABLE works ADD CONSTRAINT works_post_fl_score_range
      CHECK (post_fl_score IS NULL OR post_fl_score IN (2, 4, 6.5, 8, 10));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'works_post_ml_score_range') THEN
    ALTER TABLE works ADD CONSTRAINT works_post_ml_score_range
      CHECK (post_ml_score IS NULL OR post_ml_score IN (2, 4, 6.5, 8, 10));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'works_post_character_development_score_range') THEN
    ALTER TABLE works ADD CONSTRAINT works_post_character_development_score_range
      CHECK (post_character_development_score IS NULL OR post_character_development_score IN (2, 4, 6.5, 8, 10));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'works_post_pacing_score_range') THEN
    ALTER TABLE works ADD CONSTRAINT works_post_pacing_score_range
      CHECK (post_pacing_score IS NULL OR post_pacing_score IN (2, 4, 6.5, 8, 10));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'works_post_art_visual_score_range') THEN
    ALTER TABLE works ADD CONSTRAINT works_post_art_visual_score_range
      CHECK (post_art_visual_score IS NULL OR post_art_visual_score IN (2, 4, 6.5, 8, 10));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'works_post_impact_immersion_score_range') THEN
    ALTER TABLE works ADD CONSTRAINT works_post_impact_immersion_score_range
      CHECK (post_impact_immersion_score IS NULL OR post_impact_immersion_score IN (2, 4, 6.5, 8, 10));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'works_post_originality_score_range') THEN
    ALTER TABLE works ADD CONSTRAINT works_post_originality_score_range
      CHECK (post_originality_score IS NULL OR post_originality_score IN (2, 4, 6.5, 8, 10));
  END IF;
END $$;

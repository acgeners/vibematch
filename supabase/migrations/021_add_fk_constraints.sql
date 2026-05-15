-- ============================================================
-- 021 - Foreign keys para criterion_slug (em category_scores e
-- ai_evaluation_scores) e platform (em platform_ratings).
--
-- Pré-requisitos:
--   - criteria.slug deve ser UNIQUE (ou PRIMARY KEY)
--   - source.slug deve ser UNIQUE
--
-- A migration faz, nesta ordem para cada FK:
--   1. Garante UNIQUE no destino (idempotente via ALTER ... IF NOT EXISTS)
--   2. Audita orfãos — RAISE NOTICE com a contagem; se > 0, ABORTA
--      para você corrigir antes de re-rodar (não silenciamos divergência).
--   3. Dropa CHECK constraint antigo (se existir) que enumerava valores fixos.
--   4. Cria a FK com ON UPDATE CASCADE / ON DELETE RESTRICT.
-- ============================================================

-- ------------------------------------------------------------
-- Seed de sources que existem em platform_ratings mas faltam em
-- source — caso conhecido: 'myanimelist' (connector em código mas
-- nunca inserido na tabela). Idempotente.
-- ------------------------------------------------------------
INSERT INTO source (slug, name)
SELECT 'myanimelist', 'MyAnimeList'
WHERE NOT EXISTS (SELECT 1 FROM source WHERE slug = 'myanimelist');

-- ------------------------------------------------------------
-- criteria.slug — garantir UNIQUE
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'criteria'::regclass
      AND contype IN ('p','u')
      AND pg_get_constraintdef(oid) ILIKE '%slug%'
  ) THEN
    ALTER TABLE criteria ADD CONSTRAINT criteria_slug_unique UNIQUE (slug);
  END IF;
END $$;

-- ------------------------------------------------------------
-- source.slug — garantir UNIQUE
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'source'::regclass
      AND contype IN ('p','u')
      AND pg_get_constraintdef(oid) ILIKE '%slug%'
  ) THEN
    ALTER TABLE source ADD CONSTRAINT source_slug_unique UNIQUE (slug);
  END IF;
END $$;

-- ------------------------------------------------------------
-- Audita orfãos. Se houver alguma divergência, aborta com erro
-- claro pra você decidir como tratar (UPDATE manual ou DELETE)
-- antes de re-rodar a migration.
-- ------------------------------------------------------------
DO $$
DECLARE
  cs_orphans INTEGER;
  aes_orphans INTEGER;
  pr_orphans INTEGER;
BEGIN
  SELECT COUNT(*) INTO cs_orphans
  FROM category_scores cs
  WHERE NOT EXISTS (SELECT 1 FROM criteria c WHERE c.slug = cs.criterion_slug);

  SELECT COUNT(*) INTO aes_orphans
  FROM ai_evaluation_scores aes
  WHERE NOT EXISTS (SELECT 1 FROM criteria c WHERE c.slug = aes.criterion_slug);

  SELECT COUNT(*) INTO pr_orphans
  FROM platform_ratings pr
  WHERE NOT EXISTS (SELECT 1 FROM source s WHERE s.slug = pr.platform);

  RAISE NOTICE 'category_scores com criterion_slug orfão: %', cs_orphans;
  RAISE NOTICE 'ai_evaluation_scores com criterion_slug orfão: %', aes_orphans;
  RAISE NOTICE 'platform_ratings com platform orfão: %', pr_orphans;

  IF cs_orphans + aes_orphans + pr_orphans > 0 THEN
    RAISE EXCEPTION 'Há linhas com slug/platform que não existem nas tabelas de referência. Corrija (UPDATE ou DELETE) antes de re-rodar.';
  END IF;
END $$;

-- ------------------------------------------------------------
-- Dropa CHECK constraint antigo de platform_ratings.platform
-- (definido em migration 001/009 como enumeração estática).
-- ------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'platform_ratings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%platform%'
  LOOP
    EXECUTE format('ALTER TABLE platform_ratings DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- FKs
-- ------------------------------------------------------------
ALTER TABLE category_scores
  ADD CONSTRAINT category_scores_criterion_slug_fkey
  FOREIGN KEY (criterion_slug) REFERENCES criteria(slug)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE ai_evaluation_scores
  ADD CONSTRAINT ai_evaluation_scores_criterion_slug_fkey
  FOREIGN KEY (criterion_slug) REFERENCES criteria(slug)
  ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE platform_ratings
  ADD CONSTRAINT platform_ratings_platform_fkey
  FOREIGN KEY (platform) REFERENCES source(slug)
  ON UPDATE CASCADE ON DELETE RESTRICT;

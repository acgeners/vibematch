-- ============================================================
-- 001 - SCHEMA INICIAL
-- ============================================================

-- Extensões (uuid-ossp não necessário — gen_random_uuid() é nativo do PG 13+)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- SCORE_WEIGHTS — pesos dos critérios de avaliação
-- ============================================================
CREATE TABLE score_weights (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    TEXT UNIQUE NOT NULL,
  name                    TEXT NOT NULL,
  weight                  NUMERIC(6, 2) NOT NULL,
  max_negative_threshold  NUMERIC(4, 1),   -- só para Drama e Tragédia
  display_order           INTEGER NOT NULL DEFAULT 0,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- WORKS — tabela principal de obras
-- ============================================================
CREATE TABLE works (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title               TEXT NOT NULL,
  -- publication status: C=completed H=hiatus O=ongoing D=dropped
  publication_status  TEXT NOT NULL DEFAULT 'O',
  -- personal reading status
  personal_status     TEXT NOT NULL DEFAULT 'Ler',
  total_chapters      INTEGER,
  chapters_read       INTEGER,
  synopsis_quality    TEXT,   -- ♥ ♥♥ ♥♥♥ ♥♥♥♥
  observation_penalty NUMERIC(4, 2) NOT NULL DEFAULT 0,
  manual_score        NUMERIC(3, 1),   -- M.Nota: nota pessoal, target do ML
  cover_url           TEXT,
  ai_eval_status      TEXT NOT NULL DEFAULT 'pending',  -- pending done skipped
  is_archived         BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT works_manual_score_range CHECK (manual_score IS NULL OR (manual_score >= 0 AND manual_score <= 10)),
  CONSTRAINT works_obs_penalty_range CHECK (observation_penalty >= 0 AND observation_penalty <= 1),
  CONSTRAINT works_publication_status_valid CHECK (publication_status IN ('C','H','O','D','Unknown')),
  CONSTRAINT works_ai_eval_status_valid CHECK (ai_eval_status IN ('pending','done','skipped'))
);

CREATE UNIQUE INDEX works_title_lower_idx ON works (lower(title));

-- ============================================================
-- PLATFORM_RATINGS — notas em plataformas externas
-- ============================================================
CREATE TABLE platform_ratings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id     UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  platform    TEXT NOT NULL,  -- mangaupdates animeplanet comick
  rating      NUMERIC(5, 3),
  vote_count  INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_id, platform),
  CONSTRAINT platform_valid CHECK (platform IN ('mangaupdates','animeplanet','comick')),
  CONSTRAINT platform_rating_range CHECK (rating IS NULL OR (rating >= 0 AND rating <= 10))
);

-- ============================================================
-- CATEGORY_SCORES — notas por critério de cada obra
-- ============================================================
CREATE TABLE category_scores (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id           UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  criterion_slug    TEXT NOT NULL,
  score             NUMERIC(3, 1) NOT NULL,
  source            TEXT NOT NULL DEFAULT 'manual',  -- manual imported ai_accepted ai_edited
  ai_evaluation_id  UUID,  -- FK adicionada depois (ai_evaluations ainda não existe)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_id, criterion_slug),
  CONSTRAINT category_scores_range CHECK (score >= 0 AND score <= 10),
  CONSTRAINT category_scores_source_valid CHECK (source IN ('manual','imported','ai_accepted','ai_edited'))
);

-- ============================================================
-- CALCULATED_SCORES — resultado do último cálculo (1 por obra)
-- ============================================================
CREATE TABLE calculated_scores (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id              UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  total_votes          INTEGER NOT NULL DEFAULT 0,
  platform_avg         NUMERIC(6, 4),   -- Nota.M
  gpt_raw              NUMERIC(6, 4),   -- GPT
  gpt_normalized       NUMERIC(6, 4),   -- GPT.N
  chapters_normalized  NUMERIC(6, 4),   -- Cps.N
  calc_score           NUMERIC(6, 4),   -- Nota.Calc
  predicted_score      NUMERIC(3, 1),   -- Nota.Pr
  predicted_is_stub    BOOLEAN NOT NULL DEFAULT true,
  final_score          NUMERIC(6, 4),   -- NotaFinal
  mae_calc             NUMERIC(6, 4) NOT NULL DEFAULT 1.2657,
  mae_predicted        NUMERIC(6, 4) NOT NULL DEFAULT 0.9246,
  formula_version      TEXT NOT NULL DEFAULT 'v1',
  calculated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_id)
);

-- ============================================================
-- AI_EVALUATIONS — rodadas de avaliação por IA
-- ============================================================
CREATE TABLE ai_evaluations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id         UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending processing completed failed
  model_name      TEXT,
  prompt_version  TEXT,
  summary         TEXT,
  confidence      NUMERIC(3, 2),
  raw_response    JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_eval_status_valid CHECK (status IN ('pending','processing','completed','failed'))
);

-- ============================================================
-- AI_EVALUATION_SCORES — notas sugeridas por rodada de IA
-- ============================================================
CREATE TABLE ai_evaluation_scores (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ai_evaluation_id    UUID NOT NULL REFERENCES ai_evaluations(id) ON DELETE CASCADE,
  criterion_slug      TEXT NOT NULL,
  suggested_score     NUMERIC(3, 1),
  justification       TEXT,
  accepted_score      NUMERIC(3, 1),
  was_accepted        BOOLEAN,
  was_edited          BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ai_eval_score_suggested_range CHECK (suggested_score IS NULL OR (suggested_score >= 0 AND suggested_score <= 10)),
  CONSTRAINT ai_eval_score_accepted_range CHECK (accepted_score IS NULL OR (accepted_score >= 0 AND accepted_score <= 10))
);

-- FK tardia: category_scores → ai_evaluations
ALTER TABLE category_scores
  ADD CONSTRAINT category_scores_ai_evaluation_fk
  FOREIGN KEY (ai_evaluation_id) REFERENCES ai_evaluations(id);

-- ============================================================
-- TAGS
-- ============================================================
CREATE TABLE tags (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug       TEXT UNIQUE NOT NULL,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE work_tags (
  work_id  UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  tag_id   UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (work_id, tag_id)
);

-- ============================================================
-- IMPORTS — histórico de importações
-- ============================================================
CREATE TABLE imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename        TEXT NOT NULL,
  file_type       TEXT NOT NULL,   -- csv xlsx
  sheet_name      TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending processing completed failed
  total_rows      INTEGER NOT NULL DEFAULT 0,
  imported_count  INTEGER NOT NULL DEFAULT 0,
  updated_count   INTEGER NOT NULL DEFAULT 0,
  skipped_count   INTEGER NOT NULL DEFAULT 0,
  error_count     INTEGER NOT NULL DEFAULT 0,
  raw_metadata    JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  CONSTRAINT imports_status_valid CHECK (status IN ('pending','processing','completed','failed'))
);

CREATE TABLE import_rows (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id      UUID NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_index      INTEGER NOT NULL,
  raw_data       JSONB NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending imported updated skipped error duplicate
  work_id        UUID REFERENCES works(id),
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT import_rows_status_valid CHECK (status IN ('pending','imported','updated','skipped','error','duplicate'))
);

-- ============================================================
-- FORMULA_CONFIG — parâmetros globais de fórmula (1 linha)
-- ============================================================
CREATE TABLE formula_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formula_version       TEXT NOT NULL DEFAULT 'v1',
  mae_calc              NUMERIC(6, 4) NOT NULL DEFAULT 1.2657,
  mae_predicted         NUMERIC(6, 4) NOT NULL DEFAULT 0.9246,
  pseudo_votes_nota_m   NUMERIC(8, 1) NOT NULL DEFAULT 1767.0,
  pseudo_votes_blend    NUMERIC(8, 1) NOT NULL DEFAULT 1024.0,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- UPDATED_AT automático
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_works_updated_at
  BEFORE UPDATE ON works
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_score_weights_updated_at
  BEFORE UPDATE ON score_weights
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_category_scores_updated_at
  BEFORE UPDATE ON category_scores
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_ai_evaluations_updated_at
  BEFORE UPDATE ON ai_evaluations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

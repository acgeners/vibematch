-- ============================================================
-- 047 - AI taste profile + favorite ranking persistence
-- ============================================================
-- taste_profile        = perfil de gosto extraído pela IA das obras
--                        com manual_score; reaproveitável entre runs.
-- recommendation_runs  = cada execução de ranking de favoritos
--                        (mode = next_read | full_analysis).
-- ============================================================

CREATE TABLE IF NOT EXISTS taste_profile (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  is_stub BOOLEAN NOT NULL DEFAULT FALSE,
  n_works_used INTEGER NOT NULL,
  input_hash TEXT NOT NULL,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  profile JSONB NOT NULL,
  raw_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Apenas um perfil "current" por vez. Recompute marca o anterior como FALSE
-- e insere novo com TRUE.
CREATE UNIQUE INDEX IF NOT EXISTS taste_profile_current_unique
  ON taste_profile (is_current)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS taste_profile_input_hash_idx
  ON taste_profile (input_hash);

COMMENT ON COLUMN taste_profile.is_stub IS
  'TRUE quando o perfil é stub gerado sem chamada Claude (poucas obras avaliadas).';
COMMENT ON COLUMN taste_profile.input_hash IS
  'sha256 do snapshot canônico de obras com manual_score — detecta drift.';

CREATE TABLE IF NOT EXISTS recommendation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mode TEXT NOT NULL CHECK (mode IN ('next_read', 'full_analysis')),
  taste_profile_id UUID REFERENCES taste_profile(id) ON DELETE SET NULL,
  user_context TEXT,
  n_candidates INTEGER NOT NULL,
  candidate_work_ids UUID[] NOT NULL,
  results JSONB NOT NULL,
  mode_summary TEXT,
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recommendation_runs_mode_created_idx
  ON recommendation_runs (mode, created_at DESC);

CREATE INDEX IF NOT EXISTS recommendation_runs_profile_idx
  ON recommendation_runs (taste_profile_id);

ALTER TABLE taste_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendation_runs ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).

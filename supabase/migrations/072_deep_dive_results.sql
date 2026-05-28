-- ============================================================
-- 072 - Deep Dive results (Sub-fase 2.3.C)
-- ============================================================
-- Persiste o output do Consultor IA Deep Dive: análise profunda
-- por obra com extended thinking, comparação com biblioteca,
-- síntese de reviews e recomendação acionável.
--
-- Diferente de `recommendation_runs` (lista de N obras com
-- alignment_score por candidato), `deep_dive_results` guarda
-- UMA análise completa por linha — o payload é grande (~5-10KB)
-- e o histórico por obra é navegável.
-- ============================================================

CREATE TABLE IF NOT EXISTS deep_dive_results (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id                  UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  taste_profile_id         UUID REFERENCES taste_profile(id) ON DELETE SET NULL,
  user_context             TEXT,
  payload                  JSONB NOT NULL,
  -- Campos denormalizados pra index/listagem rápida (cópias do payload).
  match_score              NUMERIC(5,2),
  confidence               NUMERIC(3,2),
  read_when                TEXT CHECK (read_when IN ('agora','guardar','evitar')),
  one_liner                TEXT,
  -- Tracking IA (espelha recommendation_runs pra reuso de queries).
  model_name               TEXT NOT NULL,
  prompt_version           TEXT NOT NULL,
  input_tokens             INTEGER,
  output_tokens            INTEGER,
  cache_read_tokens        INTEGER,
  cache_creation_tokens    INTEGER,
  thinking_tokens          INTEGER,
  ai_api_call_id           UUID REFERENCES ai_api_calls(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Histórico por obra (drawer mostra últimos N por work_id).
CREATE INDEX IF NOT EXISTS idx_deep_dive_work_created
  ON deep_dive_results (work_id, created_at DESC);

-- Rate-limit diário (count rows desde now() - 24h).
CREATE INDEX IF NOT EXISTS idx_deep_dive_created
  ON deep_dive_results (created_at DESC);

COMMENT ON TABLE deep_dive_results IS
  'Consultor IA Deep Dive: análise profunda por obra com extended thinking. 1 linha = 1 análise.';
COMMENT ON COLUMN deep_dive_results.payload IS
  'JSONB completo do submit_deep_analysis (alignment_breakdown, similar_in_library, review_synthesis, read_recommendation, etc).';
COMMENT ON COLUMN deep_dive_results.thinking_tokens IS
  'Tokens gastos no extended thinking (subset de output_tokens). Útil pra estimar custo da feature.';

ALTER TABLE deep_dive_results ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).

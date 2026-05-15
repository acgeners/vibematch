-- ============================================================
-- 032 — Cache persistente de avaliações IA
-- ============================================================
-- Hash canônico do input (modelo + prompt + título + sinopse + tags +
-- gêneros + reviews) permite reuso entre chamadas e entre deploys.
-- O `requestAiEvaluation` agora faz lookup por (model_name, prompt_version,
-- input_hash) antes de chamar Anthropic.
-- ============================================================

ALTER TABLE ai_evaluations
  ADD COLUMN IF NOT EXISTS input_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_evaluations_cache_lookup
  ON ai_evaluations (model_name, prompt_version, input_hash, status)
  WHERE input_hash IS NOT NULL AND status = 'completed';

COMMENT ON COLUMN ai_evaluations.input_hash IS
  'SHA-256 do input canônico (modelo+prompt+título+sinopse+tags+gêneros+reviews). Usado como cache key.';

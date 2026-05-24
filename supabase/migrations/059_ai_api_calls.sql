-- ============================================================
-- 059 - Log centralizado de chamadas Anthropic
-- ============================================================
-- Toda chamada client.messages.create() do projeto registra uma
-- linha aqui. recommendation_runs / calibration_runs mantêm suas
-- colunas denormalizadas de tokens (dupla escrita) e ganham FK
-- pra entrada correspondente nesta tabela.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_api_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  operation TEXT NOT NULL,
  sub_operation TEXT,
  model_name TEXT NOT NULL,
  prompt_version TEXT,

  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,

  cost_input_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  cost_output_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  cost_cache_read_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  cost_cache_creation_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  cost_total_usd NUMERIC(12,6) GENERATED ALWAYS AS (
    cost_input_usd + cost_output_usd + cost_cache_read_usd + cost_cache_creation_usd
  ) STORED,
  pricing_source TEXT,

  latency_ms INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success','error')),
  error_message TEXT,
  stop_reason TEXT,
  request_id TEXT,

  user_id UUID,
  metadata JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_api_calls_created_idx
  ON ai_api_calls (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_api_calls_operation_created_idx
  ON ai_api_calls (operation, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_api_calls_model_created_idx
  ON ai_api_calls (model_name, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_api_calls_status_err_idx
  ON ai_api_calls (status) WHERE status = 'error';

-- FK columns nas tabelas existentes — só adiciona se a tabela já existir.
-- Em bancos onde 047/048 ainda não rodaram, essas próprias migrações já
-- criarão as colunas no esquema correto.
DO $$
BEGIN
  IF to_regclass('public.recommendation_runs') IS NOT NULL THEN
    ALTER TABLE recommendation_runs
      ADD COLUMN IF NOT EXISTS ai_api_call_id UUID
      REFERENCES ai_api_calls(id) ON DELETE SET NULL;
  END IF;

  IF to_regclass('public.calibration_runs') IS NOT NULL THEN
    ALTER TABLE calibration_runs
      ADD COLUMN IF NOT EXISTS ai_api_call_ids UUID[];

    COMMENT ON COLUMN calibration_runs.ai_api_call_ids IS
      'FKs para ai_api_calls; calibration audit pode emitir N chamadas (chunks paralelos).';
  END IF;
END$$;

COMMENT ON TABLE ai_api_calls IS
  'Log centralizado de chamadas Anthropic. Fonte única da verdade pra custo/uso.';
COMMENT ON COLUMN ai_api_calls.operation IS
  'Identificador estável da feature que originou a chamada (ai_evaluation, recommendation_rank, etc).';
COMMENT ON COLUMN ai_api_calls.pricing_source IS
  'Tag do snapshot da tabela de preços usada no cálculo (ex: static@2026-05-23).';

ALTER TABLE ai_api_calls ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).

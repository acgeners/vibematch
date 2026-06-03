-- ============================================================
-- 085 - synopsis_quality_predictions — previsão IA de "Interesse Sinopse"
-- ============================================================
-- Estima o "Interesse Sinopse" (♥/♥♥/♥♥♥/♥♥♥♥, hoje em works.synopsis_quality)
-- avaliando a sinopse canônica da obra contra o taste_profile do usuário.
--
-- IMPORTANTE — guard-rail anti-vazamento: esta é uma SUGESTÃO da IA, guardada
-- SEPARADA do campo manual. O pipeline de notas (lib/calculations/score.ts e
-- prediction.ts) continua lendo SÓ works.synopsis_quality. Nada em
-- lib/calculations/ pode ler esta tabela — senão a Nota.Pr treinaria sobre a
-- própria predição da IA (circularidade). "Aplicar" é uma ação explícita do
-- usuário que copia o valor previsto pro campo manual.
--
-- Tabela própria (não em works nem calculated_scores) pra separar fisicamente a
-- sugestão IA do sinal manual e carregar proveniência (modelo/prompt/perfil) +
-- staleness. Espelha o desenho de 079_ai_quality_predictions.
-- ============================================================

CREATE TABLE IF NOT EXISTS synopsis_quality_predictions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id               UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  predicted_quality     TEXT NOT NULL CHECK (predicted_quality IN ('♥','♥♥','♥♥♥','♥♥♥♥')),
  justification         TEXT,
  confidence            NUMERIC(3, 2) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  taste_profile_id      UUID REFERENCES taste_profile(id) ON DELETE SET NULL,
  taste_profile_version INTEGER,
  taste_profile_hash    TEXT NOT NULL,        -- input_hash do perfil usado (chave de staleness)
  model_name            TEXT NOT NULL,
  prompt_version        TEXT NOT NULL,
  ai_api_call_id        UUID REFERENCES ai_api_calls(id) ON DELETE SET NULL,
  stale                 BOOLEAN NOT NULL DEFAULT false,
  predicted_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_id)
);

CREATE INDEX IF NOT EXISTS idx_synopsis_quality_pred_work
  ON synopsis_quality_predictions (work_id);
CREATE INDEX IF NOT EXISTS idx_synopsis_quality_pred_stale
  ON synopsis_quality_predictions (stale) WHERE stale = true;

COMMENT ON TABLE synopsis_quality_predictions IS
  'Sugestão IA do "Interesse Sinopse" (♥..♥♥♥♥) por obra, avaliando a sinopse canônica vs taste_profile. SEPARADA de works.synopsis_quality — nunca alimenta o pipeline de notas (anti-vazamento). Aplicar = ação manual do usuário.';

ALTER TABLE synopsis_quality_predictions ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).

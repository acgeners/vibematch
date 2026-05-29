-- ============================================================
-- 079 - ai_quality_predictions — Bloco 2.1 (L0+, plano Pago)
-- ============================================================
-- Estimativa da IA dos 8 critérios de QUALIDADE pra obras NÃO-LIDAS.
-- Os 8 critérios (story, fl, ml, character_development, pacing, art_visual,
-- impact_immersion, originality) só existem pós-leitura (works.post_*_score).
-- Pra que o L1 (expected_score) do Pago afine a faixa antes de você ler, a IA
-- estima esses valores. Isolado em tabela própria (não polui category_scores
-- nem os post_*_score reais do usuário). Keyed pelo nome do campo post_*.
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_quality_predictions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id        UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  field          TEXT NOT NULL,            -- post_story_score, post_pacing_score, ...
  score          NUMERIC(3, 1) NOT NULL CHECK (score BETWEEN 0 AND 10),
  model_name     TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (work_id, field)
);

CREATE INDEX IF NOT EXISTS idx_ai_quality_pred_work ON ai_quality_predictions (work_id);

COMMENT ON TABLE ai_quality_predictions IS
  'L0+ (Pago): estimativa IA dos 8 critérios de qualidade pra obras não-lidas. Preenche o slot de quality features do L1 sem o usuário ter lido.';

ALTER TABLE ai_quality_predictions ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).

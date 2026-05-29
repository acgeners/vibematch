-- ============================================================
-- 075 - user_attribute_assessment — Fase 1.5.1
-- ============================================================
-- Avaliação pós-leitura do usuário sobre os 9 atributos da obra
-- (CRITERION_SLUGS / criteria.eval_type='IA'). Captura o que o user
-- "viu" depois de ler, junto com um snapshot do que a IA disse no
-- momento — incluindo modelo e versão de prompt, pra detectar drift
-- (Guard 1) caso a IA seja recalibrada depois.
--
-- O delta (user_value - ia_value_at_assessment) por atributo é o
-- sinal bruto que alimenta `attribute_bias`.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_attribute_assessment (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL,
  work_id                UUID NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  attribute_slug         TEXT NOT NULL REFERENCES criteria(slug),
  user_value             NUMERIC(3, 1) NOT NULL CHECK (user_value BETWEEN 0 AND 10),
  source                 TEXT NOT NULL
                           CHECK (source IN ('ai_accepted_post_read', 'user_edited_post_read')),
  ia_value_at_assessment NUMERIC(3, 1) NOT NULL CHECK (ia_value_at_assessment BETWEEN 0 AND 10),
  ia_model_at_assessment TEXT NOT NULL,
  ia_prompt_version      TEXT NOT NULL,
  ia_evaluation_id       UUID REFERENCES ai_evaluations(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_id, attribute_slug)
);

CREATE INDEX IF NOT EXISTS idx_user_attr_work
  ON user_attribute_assessment (work_id);
CREATE INDEX IF NOT EXISTS idx_user_attr_slug_user
  ON user_attribute_assessment (attribute_slug, user_id);

COMMENT ON TABLE user_attribute_assessment IS
  'Reavaliação pós-leitura dos 9 atributos pelo usuário, com snapshot do valor/modelo/prompt da IA.';
COMMENT ON COLUMN user_attribute_assessment.source IS
  'ai_accepted_post_read = manteve o valor da IA; user_edited_post_read = ajustou.';

ALTER TABLE user_attribute_assessment ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).

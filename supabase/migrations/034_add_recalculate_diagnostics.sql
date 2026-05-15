-- ============================================================
-- 034 — Diagnósticos do último recálculo em formula_config
-- ============================================================
-- recalculateAll já agrega estatísticas (gptClampHits, negativeActivations),
-- mas só retorna no result. Persistir aqui evita ter que reprocessar
-- tudo só pra exibir os números em /settings.
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS gpt_clamp_hit_rate     NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS negative_activation_rate JSONB,
  ADD COLUMN IF NOT EXISTS last_recalculated_at   TIMESTAMPTZ;

COMMENT ON COLUMN formula_config.gpt_clamp_hit_rate IS
  'Fração das obras cujo GPT pré-clamp saiu de [0,10] no último recálculo.';
COMMENT ON COLUMN formula_config.negative_activation_rate IS
  'Por slug: fração das obras com critério negativo ativado (score > threshold).';
COMMENT ON COLUMN formula_config.last_recalculated_at IS
  'Timestamp do último recalculateAll. Separado de updated_at pra não ser tocado em edições manuais.';

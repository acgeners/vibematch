-- ============================================================
-- 031 — Estatísticas de GPT em formula_config
-- ============================================================
-- normalizeGPT agora usa z-score calibrado em vez de "5 + (gpt-5)*1.25":
--   GPT.N = 5 + (gpt - gpt_mean) / gpt_std * 1.5  (clampeado 0-10)
--
-- Os defaults (mean=5, std=4) reproduzem aproximadamente o comportamento
-- antigo (slope ≈ 1.5/4 = 0.375 vs 1.25 do antigo no formato original
-- escalado a partir da diferença, calibração real toma sobre estes).
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS gpt_mean NUMERIC(6, 4) NOT NULL DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS gpt_std  NUMERIC(6, 4) NOT NULL DEFAULT 4.0;

COMMENT ON COLUMN formula_config.gpt_mean IS
  'Média de GPT (pré-normalização) na base calibrada — usado em z-score.';
COMMENT ON COLUMN formula_config.gpt_std IS
  'Desvio-padrão de GPT na base calibrada — usado em z-score.';

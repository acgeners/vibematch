-- ============================================================
-- 039 — Threshold configurável de "baixa confiança"
-- ============================================================
-- Antes: o filtro "Confiança < 80%" em /ai-evaluation usava 0.8
-- hardcoded no código.
--
-- Agora: usuário define o threshold em /settings.
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS low_confidence_threshold NUMERIC(3, 2) NOT NULL DEFAULT 0.80
  CHECK (low_confidence_threshold >= 0 AND low_confidence_threshold <= 1);

COMMENT ON COLUMN formula_config.low_confidence_threshold IS
  'Threshold (0-1) usado pelo filtro "Confiança < X%" em /ai-evaluation. Default 0.80.';

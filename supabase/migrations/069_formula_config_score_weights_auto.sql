-- ============================================================
-- 069 - formula_config.score_weights_auto + score_weights_inferred:
--       toggle e cache pra usar pesos sugeridos automaticamente no GPT.
-- ============================================================
-- Quando `score_weights_auto = true`, o `recalculateAll()` infere os 9 pesos
-- via Ridge (lib/ml/weight-inference) sobre os manual_scores existentes E
-- usa esses pesos na fórmula GPT (em vez dos manuais persistidos em
-- score_weights). Os pesos manuais ficam preservados na tabela como fallback
-- pra quando o usuário desativar o auto.
--
-- score_weights_inferred armazena o resultado da última inferência
-- (slug → weight) pra UI exibir "Pesos efetivos: auto (sugeridos)".
--
-- Por que default TRUE: o usuário pediu menos input manual. A inferência só
-- "acontece" quando há ≥ 20 obras com manual_score (MIN_TRAIN_FOR_INFERENCE);
-- abaixo disso o pipeline cai pros pesos manuais automaticamente.
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS score_weights_auto BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS score_weights_inferred JSONB;

COMMENT ON COLUMN formula_config.score_weights_auto IS
  'Quando TRUE, usa pesos inferidos via weight-inference no GPT calc. Quando FALSE, usa pesos manuais de score_weights. Default TRUE — pesos manuais ficam preservados como fallback.';

COMMENT ON COLUMN formula_config.score_weights_inferred IS
  'Última inferência de pesos pelo weight-inference. Formato: { suggestions: WeightSuggestion[], trainSize, alpha, cvMAE }. NULL quando treino insuficiente. Atualizado a cada recalculateAll quando auto=true.';

-- ============================================================
-- 068 - calculated_scores.expected_baseline + expected_quality_adj:
--       persiste a decomposição "baseline + qualidade" por obra
--       pra waterfall em /titles/[id] e análises mais ricas.
-- ============================================================
-- O L1 (expected_score) é Ridge único, mas a predição é decomposta via
-- atribuição linear em dois grupos:
--   baseline       = intercept + Σ (coef × x) para features de perfil/tipo
--   quality_adj    = Σ (coef × x) para features de qualidade (8 post-scores)
--   expected_score = clamp(baseline + quality_adj, 0, 10)
--
-- Persistir esses valores intermediários permite:
-- 1. Waterfall por obra mostrando "essa nota veio 7.5 do perfil + 0.8 da qualidade"
-- 2. Filtrar/ordenar por "obras com alto ganho de qualidade" (descobertas)
-- 3. Diagnosticar regressões (Stage 2 contribuindo pouco = post-scores fracos)
-- ============================================================

ALTER TABLE calculated_scores
  ADD COLUMN IF NOT EXISTS expected_baseline NUMERIC(5,3),
  ADD COLUMN IF NOT EXISTS expected_quality_adj NUMERIC(5,3);

COMMENT ON COLUMN calculated_scores.expected_baseline IS
  'Stage 1 da decomposição: intercept + contribuições das features de perfil/tipo. Pode ficar fora de [0,10] (clamp só é aplicado no expected_score final).';

COMMENT ON COLUMN calculated_scores.expected_quality_adj IS
  'Stage 2 da decomposição: contribuições das 8 post-reading scores granulares. Geralmente ±2; soma com baseline forma o expected_score pré-clamp.';

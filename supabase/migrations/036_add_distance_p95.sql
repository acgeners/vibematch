-- ============================================================
-- 036 — distance_p95 em formula_config
-- ============================================================
-- Substitui os thresholds absolutos de "outlier por distância" por um
-- valor calibrado: P95 das distâncias Euclidianas das obras do treino
-- ao centróide do treino. Robusto a qualquer dimensionalidade.
--
-- distanceFactor em Nota.Final agora cai suavemente só pra obras com
-- distância > P95 — 95% dos casos ficam intactos (factor = 1).
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS distance_p95 NUMERIC(8, 4);

COMMENT ON COLUMN formula_config.distance_p95 IS
  'P95 das distâncias do treino ao centróide. Usado como threshold de outlier em distanceFactor. NULL quando predictor é stub.';

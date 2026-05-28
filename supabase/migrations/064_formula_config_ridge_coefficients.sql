-- ============================================================
-- 064 - formula_config.ridge_coefficients: persiste os pesos
--       aprendidos pelo Ridge (Nota.Pr) pra surfacing de
--       importância de feature na calibração.
-- ============================================================
-- O Ridge é retreinado a cada recalculateAll() e seus pesos só
-- existem em memória. Persistindo aqui (junto com featureNames),
-- a UI consegue mostrar a fatia de cada grupo de feature no
-- Nota.Pr — ex.: quanto da previsão vem de notas IA vs. plataforma
-- vs. perfil pessoal.
--
-- ridge_coefficients exemplo:
-- {
--   "featureNames": ["romance", "drama", ..., "IA(n)", "Nota.M", ...],
--   "coefficients": [0.31, -0.12, ..., 0.45, 0.08, ...]
-- }
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS ridge_coefficients JSONB;

COMMENT ON COLUMN formula_config.ridge_coefficients IS
  'Pesos do Ridge (Nota.Pr) com featureNames + coefficients alinhados. NULL quando treino < 20 (stub).';

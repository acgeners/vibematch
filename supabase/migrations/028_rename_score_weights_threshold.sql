-- ============================================================
-- 028 - Generaliza threshold de score_weights
-- ============================================================
-- Renomeia max_negative_threshold → threshold para que o campo
-- passe a ser usado tanto pelos critérios negativos (piso abaixo
-- do qual não há penalidade) quanto pelos positivos (valor acima
-- do qual o impacto é amplificado).

ALTER TABLE score_weights
  RENAME COLUMN max_negative_threshold TO threshold;

COMMENT ON COLUMN score_weights.threshold IS
  'Critérios negativos: valor mínimo do score para que a penalidade comece a contar. Critérios positivos: valor acima do qual o peso é amplificado (bônus dobrado no excedente).';

-- ============================================================
-- 029 - observation_penalty → observation_adjustment
-- ============================================================
-- Antes: observation_penalty ∈ [0, 1], fator de cálculo = (1 − penalty).
-- Agora: observation_adjustment ∈ [−0.30, +0.30], fator = (1 + adjustment).
-- Convenção: positivo = bônus, negativo = penalidade.
-- Os valores existentes (penalidades positivas) são invertidos de sinal
-- para preservar o comportamento atual após a migração.

ALTER TABLE works DROP CONSTRAINT works_obs_penalty_range;

ALTER TABLE works RENAME COLUMN observation_penalty TO observation_adjustment;

UPDATE works
  SET observation_adjustment = -observation_adjustment
  WHERE observation_adjustment <> 0;

ALTER TABLE works
  ADD CONSTRAINT works_obs_adjustment_range
  CHECK (observation_adjustment >= -0.30 AND observation_adjustment <= 0.30);

ALTER TABLE works ALTER COLUMN observation_adjustment SET DEFAULT 0;

COMMENT ON COLUMN works.observation_adjustment IS
  'Ajuste manual aplicado ao Nota.Calc. Positivo = bônus, negativo = penalidade. Range [-0.30, +0.30]. Fator de cálculo = (1 + observation_adjustment).';

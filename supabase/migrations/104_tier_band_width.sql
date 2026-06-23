-- 104: largura PROVISÓRIA das bandas (tiers) do ranking.
-- Move o antigo TIE_DELTA=0.3 (hardcoded no client) para config ajustável, sem
-- redeploy. O valor 0.5 é ponto de partida (curva de acurácia pairwise × Δprevisto
-- da auditoria) e deve ser VALIDADO empiricamente (banda fixa × percentis × clusters).
-- NÃO é parte da fórmula de score — é regra de agrupamento/apresentação.

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS tier_band_width numeric NOT NULL DEFAULT 0.5;

ALTER TABLE formula_config
  DROP CONSTRAINT IF EXISTS formula_config_tier_band_width_valid;

ALTER TABLE formula_config
  ADD CONSTRAINT formula_config_tier_band_width_valid
  CHECK (tier_band_width >= 0.05 AND tier_band_width <= 2);

COMMENT ON COLUMN formula_config.tier_band_width IS
  'Largura PROVISÓRIA das bandas do ranking (agrupamento visual de tiers). Deve ser validada empiricamente; ajustável sem mudança de código.';

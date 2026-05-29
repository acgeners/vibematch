-- ============================================================
-- 076 - attribute_bias — Fase 1.5.1
-- ============================================================
-- Estado computado do offset (viés) da IA por (user, atributo).
-- Derivado de user_attribute_assessment via recomputeAttributeBias().
--
-- mean_bias_raw = média(ia_value - user_value) sobre as amostras.
--   > 0  → IA superestima o atributo (ex.: drama).
-- bias_applied = mean_bias_raw × n / (n + K), K=10 (shrinkage Bayesiano).
--   Encolhe a correção quando há poucas amostras, evitando overfit.
-- O pipeline aplica `valor_calibrado = valor_IA - bias_applied`.
-- ============================================================

CREATE TABLE IF NOT EXISTS attribute_bias (
  user_id         UUID NOT NULL,
  attribute_slug  TEXT NOT NULL REFERENCES criteria(slug),
  n_samples       INTEGER NOT NULL DEFAULT 0,
  mean_bias_raw   NUMERIC(4, 2) NOT NULL DEFAULT 0,
  bias_applied    NUMERIC(4, 2) NOT NULL DEFAULT 0,
  stddev_bias     NUMERIC(4, 2),
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, attribute_slug)
);

COMMENT ON TABLE attribute_bias IS
  'Offset da IA por (user, atributo) com shrinkage Bayesiano. bias_applied = mean_bias_raw × n/(n+10).';
COMMENT ON COLUMN attribute_bias.mean_bias_raw IS
  'média(ia_value - user_value). Positivo = IA superestima o atributo.';
COMMENT ON COLUMN attribute_bias.bias_applied IS
  'Correção efetiva aplicada no pipeline (encolhida por n). valor_calibrado = valor_IA - bias_applied.';

ALTER TABLE attribute_bias ENABLE ROW LEVEL SECURITY;
-- Sem policies: acesso somente via service role (padrão do projeto).

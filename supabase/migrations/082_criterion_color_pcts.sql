-- Override opcional dos percentis de cor POR critério (atributo).
-- Estrutura: { "<criterion_slug>": { "top": n, "high": n, "mid": n, "low": n } }.
-- Slugs ausentes herdam os percentis globais (score_color_pct_*). Usado pra
-- colorir os 9 atributos por percentil individual em vez dos limiares fixos.
ALTER TABLE formula_config
  ADD COLUMN criterion_color_pcts JSONB NOT NULL DEFAULT '{}'::jsonb;

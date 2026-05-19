-- ============================================================
-- 044 — Percentis configuráveis pras cores do ScoreBadge
-- ============================================================
-- ScoreBadge passa a colorir notas agregadas (Nota.Final/IA/Pr) por
-- percentil da distribuição do catálogo do usuário, em vez de thresholds
-- fixos (8.5/7.5/6.5/5.5). Os 4 cutoffs ficam editáveis em /preferences.
--
-- Defaults = quintis (20/40/60/80) → cada cor cobre 20% do catálogo.
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS score_color_pct_top NUMERIC(5, 2) NOT NULL DEFAULT 80
    CHECK (score_color_pct_top BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS score_color_pct_high NUMERIC(5, 2) NOT NULL DEFAULT 60
    CHECK (score_color_pct_high BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS score_color_pct_mid NUMERIC(5, 2) NOT NULL DEFAULT 40
    CHECK (score_color_pct_mid BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS score_color_pct_low NUMERIC(5, 2) NOT NULL DEFAULT 20
    CHECK (score_color_pct_low BETWEEN 0 AND 100);

-- Ordem dos percentis: low < mid < high < top.
ALTER TABLE formula_config
  ADD CONSTRAINT formula_config_score_color_pct_order
    CHECK (
      score_color_pct_low < score_color_pct_mid
      AND score_color_pct_mid < score_color_pct_high
      AND score_color_pct_high < score_color_pct_top
    );

COMMENT ON COLUMN formula_config.score_color_pct_top IS
  'Percentil (0-100) acima do qual a nota agregada usa a cor de topo (verde). Default 80.';
COMMENT ON COLUMN formula_config.score_color_pct_high IS
  'Percentil (0-100) acima do qual a nota agregada usa a 2ª cor (emerald). Default 60.';
COMMENT ON COLUMN formula_config.score_color_pct_mid IS
  'Percentil (0-100) acima do qual a nota agregada usa a 3ª cor (amarelo). Default 40.';
COMMENT ON COLUMN formula_config.score_color_pct_low IS
  'Percentil (0-100) acima do qual a nota agregada usa a 4ª cor (laranja); abaixo, vermelho. Default 20.';

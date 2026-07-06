-- ============================================================
-- 132 — Atalhos de nota (≥) configuráveis por atributo
-- ============================================================
-- Os botões rápidos (≥5 ≥6 ≥7 ≥8) da aba "Notas por critério" do /ranking
-- deixam de ser hardcoded e passam a ser configuráveis em
-- /preferencias → "Filtros do Ranking".
--
-- Formato:
--   { "default": [5,6,7,8], "overrides": { "<slug>": [4,5,6], ... } }
--
--   • default   → conjunto global aplicado a TODOS os 9 atributos.
--   • overrides → exceções por atributo (slug de criteria/eval_type=IA).
--                 Ausente = herda o default.
--
-- Consumo no ranking: presets = overrides[slug] ?? default
-- (ranking-filters.tsx → CRITERION_SCORE_DEFS). Escrito por
-- updateRankingPreferences (server/actions/settings.ts).
-- Custo de IA: zero — é só UI + filtro client-side.
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS criterion_score_presets JSONB
  NOT NULL DEFAULT '{"default":[5,6,7,8],"overrides":{}}'::jsonb;

COMMENT ON COLUMN formula_config.criterion_score_presets IS
  'Atalhos ≥ configuráveis da aba Notas do ranking: {"default":[5,6,7,8],"overrides":{"<slug>":[...]}}. overrides[slug] ?? default.';

-- ============================================================
-- 037 — Tolerância configurável de versão de prompt
-- ============================================================
-- Antes: qualquer divergência em prompt_version vs MODEL marca uma obra
-- como "outdated-model" em /ai-evaluation. Bumpar prompt por uma regra
-- pequena fazia 100% da base aparecer no backlog.
--
-- Agora: usuário define quantas versões pra trás aceita sem reavaliar.
-- 0 = comportamento antigo (qualquer diferença conta). 3 = obras só
-- aparecem como outdated quando estiverem 4+ versões atrasadas.
-- ============================================================

ALTER TABLE formula_config
  ADD COLUMN IF NOT EXISTS prompt_version_tolerance INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN formula_config.prompt_version_tolerance IS
  'Quantas versões de prompt pra trás são aceitas sem reavaliar. 0 = qualquer diferença conta como outdated.';

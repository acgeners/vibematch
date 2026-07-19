-- ============================================================
-- 160 — Toggle: ocultar conteúdo adulto (18+)
-- ============================================================
-- Preferência PESSOAL (não global): cada usuário decide se quer ver obras 18+.
-- "18+" = obra com nota do critério `adult_content` >= 7 (mesmo limiar que o
-- script scripts/tag-r19-adult.ts usa pra marcar a tag R19). O dado já está
-- persistido em category_scores — este toggle só controla a EXIBIÇÃO.
--
-- Quando true:
--   • página da obra → capa e conteúdo ficam desfocados, com botão de revelar
--     (portão; não some, pra link direto não quebrar). A pílula 🔞 18+ segue
--     visível de qualquer forma.
--   • listas (ranking/catálogo/recomendações/favoritos) → obra some. [Fase 2]
--
-- DESABILITADO por padrão (false) — preserva o comportamento atual (exibe tudo).
-- Lido por getHideAdultContent (server/queries/current-user.ts); escrito por
-- setHideAdultContent (server/actions/settings.ts).
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS hide_adult_content BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_settings.hide_adult_content IS
  'Quando true, obras 18+ (category_scores.adult_content >= 7) ficam com portão na página e somem das listas. Default false (exibe).';

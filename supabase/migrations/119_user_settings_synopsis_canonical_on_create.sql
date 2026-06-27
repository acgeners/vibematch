-- ============================================================
-- 119 — Toggle: gerar sinopse canônica na criação de obras
-- ============================================================
-- Controla se a consolidação da sinopse canônica (Haiku) roda automaticamente
-- ao CRIAR uma obra (persistNewWork → scheduleSynopsisConsolidation). HABILITADO
-- por padrão (true) pra preservar o comportamento histórico. Desligado, a obra
-- nasce sem canônica e o usuário gera depois (painel "Sinopse canônica" em
-- /settings, ou ao editar/atualizar dados da obra) — útil pra evitar custo de
-- tokens na criação em massa.
--
-- NÃO afeta updateWork / updateWorkExternalData: editar sinopses continua
-- reconsolidando normalmente. Só gate o disparo na criação.
--
-- Lido por getSynopsisCanonicalOnCreate (server/queries/current-user.ts).
-- Escrito por setSynopsisCanonicalOnCreate (server/actions/settings.ts).
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS synopsis_canonical_on_create BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN user_settings.synopsis_canonical_on_create IS
  'Quando true (default), a sinopse canônica é consolidada via Haiku ao criar uma obra. False adia a geração pra depois do save.';

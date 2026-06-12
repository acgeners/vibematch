-- ============================================================
-- 097 — Toggle: avaliação IA na criação de obras
-- ============================================================
-- Controla se a avaliação IA roda automaticamente ao criar uma obra
-- via "Buscar dados" (Path B). DESABILITADO por padrão (false): a obra
-- é criada como `pending` e a avaliação fica pra ser disparada na fila
-- "✨ Avaliar" quando o usuário quiser — evita custo de tokens não
-- intencional na criação.
--
-- Lido em app/titles/new/page.tsx → WorkForm → ExternalSearch (prop
-- evaluateAi). Escrito por setAiEvalOnCreate (server/actions/settings.ts).
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS ai_eval_on_create BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_settings.ai_eval_on_create IS
  'Quando true, a avaliação IA roda automaticamente na criação de obras (Buscar dados). Default false.';

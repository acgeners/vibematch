-- ============================================================
-- 128 — Toggles: inferência de tags (Haiku) e shadow de Interesse
-- ============================================================
-- Mais dois controles pro card "Comportamento na criação" (/settings), ambos
-- sobre etapas de IA que hoje disparam sozinhas ao CRIAR uma obra:
--
--   • tag_inference_on_create → inferência de tags por IA (Haiku), que roda em
--     TODA criação (inferAndPersistTagsForWork, via after()). Gravava tags
--     ai_inferred sem toggle — só o "salvar sem enriquecimento" a pulava.
--     HABILITADO por padrão (true) pra preservar o comportamento histórico.
--     Gate lido em inferTagsForNewWork (server/actions/works.ts).
--
--   • interest_shadow_on_create → arm B do experimento A/B de Previsão de
--     Interesse (Sonnet), que DOBRA o custo do Interesse quando roda. Hoje só
--     ligado pela env INTEREST_SHADOW=1. A flag do DB SOMA-se à env (OR) apenas
--     no caminho AUTOMÁTICO da criação (autoPredictSynopsisQuality). DESABILITADO
--     por padrão (false) — preserva o comportamento atual (off salvo env).
--
-- Lidos por getTagInferenceOnCreate / getInterestShadowOnCreate
-- (server/queries/current-user.ts). Escritos por setTagInferenceOnCreate /
-- setInterestShadowOnCreate (server/actions/settings.ts).
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS tag_inference_on_create BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS interest_shadow_on_create BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN user_settings.tag_inference_on_create IS
  'Quando true (default), a inferência de tags por IA (Haiku) roda ao criar uma obra. False adia pra sob demanda.';

COMMENT ON COLUMN user_settings.interest_shadow_on_create IS
  'Quando true, liga o arm B (shadow A/B) da Previsão de Interesse na criação — dobra o custo. Default false; soma-se à env INTEREST_SHADOW.';

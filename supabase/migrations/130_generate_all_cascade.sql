-- ============================================================
-- 130 — Cascata "Gerar todos os dados" (generate_all_work_data)
-- ============================================================
-- Suporta o fluxo contínuo/sequencial que gera TODOS os dados da obra no
-- create/update (sinopse → reviews → tags → 9 atributos → recalc → Interesse →
-- Veredito → embedding), com gate de fontes (Comix+ComicK) e checkpoint de custo.
-- Ver server/actions/generate-all.ts (generateAllWorkData).
--
--   • user_settings.generate_all_on_create → toggle do card "Comportamento na
--     criação" (/settings). Quando true, a cascata é AGENDADA ao criar uma obra
--     (Fase 0 em background → termina em needs_authorization). DESABILITADO por
--     padrão (false): é ~$0,13/obra + até ~3 min de gate. Preserva o fluxo barato
--     de hoje quando off. Lido por getGenerateAllOnCreate (current-user.ts),
--     escrito por setGenerateAllOnCreate (server/actions/settings.ts).
--
--   • works.cascade_status → estado por-obra da cascata, espelha o padrão de
--     ai_eval_status. Valores:
--       idle | verifying_sources | blocked_manual | needs_authorization
--       | generating | done | failed
--     Renderizado como banner acionável na página da obra e badge na tabela.
-- ============================================================

ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS generate_all_on_create BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE works
  ADD COLUMN IF NOT EXISTS cascade_status TEXT NOT NULL DEFAULT 'idle';

COMMENT ON COLUMN user_settings.generate_all_on_create IS
  'Quando true, agenda a cascata "Gerar todos os dados" ao criar uma obra (Fase 0 em background). Default false (custo ~$0,13 + gate lento).';

COMMENT ON COLUMN works.cascade_status IS
  'Estado da cascata generate_all_work_data: idle | verifying_sources | blocked_manual | needs_authorization | generating | done | failed.';

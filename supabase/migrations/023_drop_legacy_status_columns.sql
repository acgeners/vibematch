-- ============================================================
-- 023 - Drop das colunas legadas de status e do post_protagonists_score.
-- Pré-requisitos (já feitos):
--   - Migration 019 backfilou works.publication_status_id e works.personal_status_id
--   - Código removeu writes/reads das colunas texto (Fase 4.1)
--   - post_protagonists_score já estava sem nenhum consumer no código
-- ============================================================

ALTER TABLE works DROP COLUMN IF EXISTS publication_status;
ALTER TABLE works DROP COLUMN IF EXISTS personal_status;
ALTER TABLE works DROP COLUMN IF EXISTS post_protagonists_score;

-- Sanidade: as colunas FK não podem ser NULL pra obras ativas. Vamos
-- exigir agora (já estão populadas pela migration 019).
ALTER TABLE works ALTER COLUMN publication_status_id SET NOT NULL;
ALTER TABLE works ALTER COLUMN personal_status_id SET NOT NULL;

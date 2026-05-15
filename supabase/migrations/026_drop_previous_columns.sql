-- ============================================================
-- 026 - Drop final da coluna `previous` em publication_status e
-- personal_status. Era usada para o backfill works.publication_status
-- (texto legado) → publication_status_id (FK). Após Fase 4.1 dropar
-- works.publication_status, a coluna `previous` não tem mais utilidade.
-- ============================================================

ALTER TABLE publication_status DROP COLUMN IF EXISTS previous;
ALTER TABLE personal_status DROP COLUMN IF EXISTS previous;

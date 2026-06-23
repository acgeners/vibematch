-- ============================================================
-- APPLY — migration 114 (drop metadata): public.work_external_reviews_manual
-- ============================================================
-- DDL ESTRITO. Idêntico à migration de registro
-- (supabase/migrations/114_work_external_reviews_manual_drop_metadata.sql).
-- SEM `IF EXISTS` (falha em drift). Atômico (BEGIN/COMMIT). Rodar DEPOIS do precheck (todo PASS).
-- O DROP COLUMN auto-remove os 4 CHECKs *_nonblank/_language_format e o índice uniq_extid.
-- As 5 colunas estão VAZIAS ⇒ sem perda de dados. As linhas (source/text/hash) ficam intactas.
-- ============================================================

BEGIN;

ALTER TABLE public.work_external_reviews_manual
  DROP COLUMN source_url,
  DROP COLUMN external_review_id,
  DROP COLUMN reviewer_name,
  DROP COLUMN language,
  DROP COLUMN published_at;

COMMIT;

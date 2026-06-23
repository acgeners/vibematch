-- ============================================================
-- APPLY — migration 113 (text-only): public.work_external_reviews_manual
-- ============================================================
-- DDL ESTRITO. Idêntico à migration de registro
-- (supabase/migrations/113_work_external_reviews_manual_text_only.sql).
-- SEM `IF EXISTS` (de propósito: falhar diante de drift se um CHECK alvo não existir).
-- NÃO toca em dados, índices, RLS, policies, FK, trigger ou colunas — só nestes 3 CHECKs:
--   1. DROP _provenance        (exigência source_url OU external_review_id)
--   2. DROP _text_nonempty     (CHECK (NULLIF(BTRIM(text),'') IS NOT NULL))
--   3. ADD  _text_min40        (CHECK (char_length(btrim(text)) >= 40))
-- Atômico (BEGIN/COMMIT): se o ADD falhar, os DROPs são revertidos.
-- Rodar DEPOIS do precheck (todo PASS). A tabela está VAZIA ⇒ o ADD não falha por dados.
-- ============================================================

BEGIN;

ALTER TABLE public.work_external_reviews_manual
  DROP CONSTRAINT work_external_reviews_manual_provenance;

ALTER TABLE public.work_external_reviews_manual
  DROP CONSTRAINT work_external_reviews_manual_text_nonempty;

ALTER TABLE public.work_external_reviews_manual
  ADD CONSTRAINT work_external_reviews_manual_text_min40
    CHECK (char_length(btrim(text)) >= 40);

COMMIT;

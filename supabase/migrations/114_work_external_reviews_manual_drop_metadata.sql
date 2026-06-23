-- ============================================================
-- 114 - work_external_reviews_manual: dropar metadados opcionais (text-only)
-- ============================================================
-- Plano 3 (text-only). Decisão: SÓ `source` + `text` importam. Os 5 metadados opcionais
-- (source_url, external_review_id, reviewer_name, language, published_at) são inócuos ao
-- experimento e ficam VAZIOS ⇒ remover as colunas.
--
-- O DROP COLUMN remove AUTOMATICAMENTE os objetos dependentes de cada coluna:
--   - CHECK work_external_reviews_manual_source_url_nonblank          (com source_url)
--   - CHECK work_external_reviews_manual_external_review_id_nonblank  (com external_review_id)
--   - CHECK work_external_reviews_manual_reviewer_name_nonblank       (com reviewer_name)
--   - CHECK work_external_reviews_manual_language_format              (com language)
--   - INDEX work_external_reviews_manual_uniq_extid                   (depende de external_review_id)
--
-- Preservados: source NOT NULL + _source_format · text NOT NULL + _text_min40 ·
--   normalized_text_hash NOT NULL + _hash_format · created_by · created_at · updated_at ·
--   FK work_id CASCADE · RLS + 0 policies · uniq_hash + work + created + pkey · trigger updated_at.
--
-- As colunas estão VAZIAS (migração de dados anterior só preencheu source/text/hash) ⇒ sem perda.
-- DDL ESTRITO: falha se alguma coluna não existir (drift). ⚠️ NÃO APLICADA por este passo —
-- aplicar à mão no SQL Editor (convenção do projeto). A tabela contém dados (≥0 linhas, intactos).
-- ============================================================

BEGIN;

ALTER TABLE public.work_external_reviews_manual
  DROP COLUMN source_url,
  DROP COLUMN external_review_id,
  DROP COLUMN reviewer_name,
  DROP COLUMN language,
  DROP COLUMN published_at;

COMMIT;

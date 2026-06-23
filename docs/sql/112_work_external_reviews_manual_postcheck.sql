-- ============================================================
-- POSTCHECK da migration 112 (public.work_external_reviews_manual)
-- ============================================================
-- READ-ONLY. Rodar DEPOIS de aplicar (fora da transação do apply). NÃO altera o
-- histórico de migrations. Verifica DEFINIÇÕES (não só nomes). Enviar tudo.
-- ============================================================

-- A. Existência + schema + RLS + policies=0 + linhas=0 (resumo)
SELECT
  to_regclass('public.work_external_reviews_manual') IS NOT NULL AS table_exists,
  c.relnamespace::regnamespace::text                             AS schema_name,   -- esperado: public
  c.relrowsecurity                                               AS rls_enabled,
  (SELECT count(*) FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'work_external_reviews_manual') AS policy_count,
  (SELECT count(*) FROM public.work_external_reviews_manual)     AS row_count
FROM pg_class c
WHERE c.oid = 'public.work_external_reviews_manual'::regclass;

-- B. Nenhum objeto HOMÔNIMO fora de public (tabela/view/sequence em outro schema)
SELECT 'no_homonym_other_schema' AS check,
       NOT EXISTS (
         SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = 'work_external_reviews_manual' AND n.nspname <> 'public'
       ) AS pass;

-- C. Colunas: nome, tipo, nullability, default. Esperado: 13 colunas; created_by
--    NULLABLE; normalized_text_hash NOT NULL; sem user_rating/note.
SELECT ordinal_position, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'work_external_reviews_manual'
ORDER BY ordinal_position;

-- D. Foreign key → public.works(id) com ON DELETE CASCADE
SELECT tc.constraint_name, kcu.column_name AS fk_column,
       ccu.table_schema || '.' || ccu.table_name AS ref_table, ccu.column_name AS ref_column,
       rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
WHERE tc.table_schema = 'public' AND tc.table_name = 'work_external_reviews_manual'
  AND tc.constraint_type = 'FOREIGN KEY';

-- E. CHECK constraints com DEFINIÇÃO. Esperado: source_format, text_nonempty,
--    hash_format, provenance, source_url_nonblank, external_review_id_nonblank,
--    reviewer_name_nonblank, language_format (os *_nonblank rejeitam string vazia).
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.work_external_reviews_manual'::regclass AND contype = 'c'
ORDER BY conname;

-- F. Índices com DEFINIÇÃO (pkey + uniq_extid parcial + uniq_hash + work + created)
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'work_external_reviews_manual'
ORDER BY indexname;

-- G. Trigger: nome, BEFORE UPDATE e DEFINIÇÃO (deve chamar public.update_updated_at)
SELECT tgname,
       pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgrelid = 'public.work_external_reviews_manual'::regclass AND NOT tgisinternal;

-- ============================================================
-- PRECHECK da migration 112 (public.work_external_reviews_manual)
-- ============================================================
-- READ-ONLY. Rodar ANTES de aplicar, no Supabase SQL Editor. NÃO aplica DDL, NÃO
-- altera o histórico de migrations. Cada consulta devolve check + pass (boolean).
-- TODAS devem dar pass = true antes de aplicar.
-- ============================================================

-- 1. a tabela ainda NÃO existe
SELECT 'table_absent' AS check,
       to_regclass('public.work_external_reviews_manual') IS NULL AS pass;

-- 2. os índices esperados NÃO existem
SELECT 'indexes_absent' AS check,
       NOT EXISTS (
         SELECT 1 FROM pg_indexes
         WHERE schemaname = 'public'
           AND indexname IN (
             'work_external_reviews_manual_uniq_extid',
             'work_external_reviews_manual_uniq_hash',
             'work_external_reviews_manual_work_idx',
             'work_external_reviews_manual_created_idx'
           )
       ) AS pass;

-- 3. o trigger esperado NÃO existe
SELECT 'trigger_absent' AS check,
       NOT EXISTS (
         SELECT 1 FROM pg_trigger
         WHERE NOT tgisinternal AND tgname = 'trg_work_external_reviews_manual_updated_at'
       ) AS pass;

-- 4. public.works existe
SELECT 'works_exists' AS check, to_regclass('public.works') IS NOT NULL AS pass;

-- 5. public.works.id é UUID
SELECT 'works_id_uuid' AS check,
       COALESCE((
         SELECT data_type = 'uuid' FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'works' AND column_name = 'id'
       ), false) AS pass;

-- 6. public.update_updated_at() existe
SELECT 'fn_update_updated_at' AS check,
       EXISTS (
         SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'update_updated_at'
       ) AS pass;

-- 7. schema public existe
SELECT 'schema_public' AS check,
       EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'public') AS pass;

-- 8. nenhum TYPE homônimo (qualquer schema)
SELECT 'no_homonym_type' AS check,
       NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'work_external_reviews_manual') AS pass;

-- 9. (informativo) a migration 112 já está registrada no histórico remoto?
--    Esperado: false (DDL ainda não aplicado). registered=true + table_absent=true ⇒ DRIFT.
SELECT 'migration_112_registered' AS check,
       EXISTS (
         SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '112'
       ) AS registered_remote;

-- 10. (informativo) DRIFT: tabela ausente porém migration registrada
SELECT 'drift_absent_table_but_registered' AS check,
       (to_regclass('public.work_external_reviews_manual') IS NULL)
       AND EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '112') AS drift;

-- NOTA (verificação LOCAL): "não há outra migration local 112_" é checada no repositório
-- (supabase/migrations/) por teste estático — não por SQL remoto.

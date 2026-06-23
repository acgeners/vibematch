-- ============================================================
-- PRECHECK — migration 113 (text-only): public.work_external_reviews_manual
-- ============================================================
-- READ-ONLY. Rodar no SQL Editor ANTES do apply. NÃO altera nada (sem DML/DDL).
-- Estado esperado (pré-113): _provenance + _text_nonempty PRESENTES; _text_min40 AUSENTE;
-- tabela existe e VAZIA; RLS on; 0 policies; nullability/NOT NULL/FK/índices/trigger intactos.
-- Enviar o arquivo inteiro. O VEREDITO (seção 1) deve vir TODO 'PASS'.
-- ============================================================

-- 1) VEREDITO consolidado (PASS/FAIL por item)
SELECT ord, check_name, status, detail FROM (
  SELECT 1 AS ord, 'tabela public.work_external_reviews_manual existe' AS check_name,
         CASE WHEN to_regclass('public.work_external_reviews_manual') IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS status,
         '' AS detail
  UNION ALL SELECT 2, 'row_count = 0',
         CASE WHEN (SELECT count(*) FROM public.work_external_reviews_manual) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*)::text FROM public.work_external_reviews_manual)
  UNION ALL SELECT 3, 'RLS habilitada',
         CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.work_external_reviews_manual'::regclass) THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 4, 'policy_count = 0',
         CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='work_external_reviews_manual') = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT count(*)::text FROM pg_policies WHERE schemaname='public' AND tablename='work_external_reviews_manual')
  UNION ALL SELECT 5, 'constraint _provenance PRESENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND conname='work_external_reviews_manual_provenance') THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 6, 'constraint _text_nonempty PRESENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND conname='work_external_reviews_manual_text_nonempty') THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 7, 'constraint _text_min40 AUSENTE (ainda não existe)',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND conname='work_external_reviews_manual_text_min40') THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 8, 'source_url NULLABLE',
         CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='work_external_reviews_manual' AND column_name='source_url') = 'YES' THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 9, 'external_review_id NULLABLE',
         CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='work_external_reviews_manual' AND column_name='external_review_id') = 'YES' THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 10, 'source NOT NULL',
         CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='work_external_reviews_manual' AND column_name='source') = 'NO' THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 11, 'text NOT NULL',
         CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='work_external_reviews_manual' AND column_name='text') = 'NO' THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 12, 'normalized_text_hash NOT NULL',
         CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='work_external_reviews_manual' AND column_name='normalized_text_hash') = 'NO' THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 13, 'FK work_id -> works(id) ON DELETE CASCADE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND contype='f'
                            AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE%') THEN 'PASS' ELSE 'FAIL' END,
         (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND contype='f' LIMIT 1)
  UNION ALL SELECT 14, 'índices = 5',
         CASE WHEN (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='work_external_reviews_manual') = 5 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT string_agg(indexname, ', ' ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='work_external_reviews_manual')
  UNION ALL SELECT 15, 'trigger trg_..._updated_at PRESENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.work_external_reviews_manual'::regclass AND NOT tgisinternal
                            AND tgname='trg_work_external_reviews_manual_updated_at') THEN 'PASS' ELSE 'FAIL' END, ''
) v ORDER BY ord;

-- 2) Detalhe: definição EXATA dos 2 CHECKs que serão removidos (confirma nome+def)
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
WHERE con.conrelid = 'public.work_external_reviews_manual'::regclass
  AND con.conname IN ('work_external_reviews_manual_provenance',
                      'work_external_reviews_manual_text_nonempty')
ORDER BY con.conname;
-- esperado:
--   ..._provenance     CHECK (((NULLIF(btrim(source_url), ''::text) IS NOT NULL) OR (NULLIF(btrim(external_review_id), ''::text) IS NOT NULL)))
--   ..._text_nonempty  CHECK ((NULLIF(btrim(text), ''::text) IS NOT NULL))

-- 3) Detalhe: inventário de TODOS os CHECKs hoje (esperado: 8)
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
WHERE con.conrelid = 'public.work_external_reviews_manual'::regclass AND con.contype = 'c'
ORDER BY con.conname;

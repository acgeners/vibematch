-- ============================================================
-- POSTCHECK — migration 114 (drop metadata): public.work_external_reviews_manual
-- ============================================================
-- READ-ONLY. Rodar DEPOIS do apply. UM ÚNICO SELECT (o SQL Editor mostra só a última
-- instrução). VEREDITO esperado = todo 'PASS' (linhas 1-8) + linha 9 informativa (row_count).
-- ============================================================

SELECT ord, check_name, status, detail FROM (
  SELECT 1 AS ord, 'as 5 colunas de metadados REMOVIDAS' AS check_name,
    CASE WHEN (SELECT count(*) FROM information_schema.columns
               WHERE table_schema='public' AND table_name='work_external_reviews_manual'
                 AND column_name IN ('source_url','external_review_id','reviewer_name','language','published_at')) = 0
         THEN 'PASS' ELSE 'FAIL' END AS status, '' AS detail
  UNION ALL SELECT 2, 'os 4 CHECKs dependentes REMOVIDOS',
    CASE WHEN (SELECT count(*) FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass
               AND conname IN ('work_external_reviews_manual_source_url_nonblank','work_external_reviews_manual_external_review_id_nonblank',
                               'work_external_reviews_manual_reviewer_name_nonblank','work_external_reviews_manual_language_format')) = 0
         THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 3, 'índice uniq_extid REMOVIDO',
    CASE WHEN NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='work_external_reviews_manual'
                           AND indexname='work_external_reviews_manual_uniq_extid') THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 4, 'colunas restantes = 8',
    CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='work_external_reviews_manual') = 8
         THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='work_external_reviews_manual')
  UNION ALL SELECT 5, 'preservados: source/text/normalized_text_hash NOT NULL',
    CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='work_external_reviews_manual'
               AND column_name IN ('source','text','normalized_text_hash') AND is_nullable='NO') = 3 THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 6, 'preservados: CHECKs source_format/text_min40/hash_format (= 3 no total)',
    CASE WHEN (SELECT count(*) FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND contype='c') = 3
         THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(conname, ', ' ORDER BY conname) FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND contype='c')
  UNION ALL SELECT 7, 'preservados: índices = 4 (uniq_hash, work, created, pkey)',
    CASE WHEN (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='work_external_reviews_manual') = 4 THEN 'PASS' ELSE 'FAIL' END,
    (SELECT string_agg(indexname, ', ' ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='work_external_reviews_manual')
  UNION ALL SELECT 8, 'preservados: FK CASCADE + RLS + policies=0 + trigger',
    CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND contype='f' AND pg_get_constraintdef(oid) ILIKE '%ON DELETE CASCADE%')
          AND (SELECT relrowsecurity FROM pg_class WHERE oid='public.work_external_reviews_manual'::regclass)
          AND (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='work_external_reviews_manual') = 0
          AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.work_external_reviews_manual'::regclass AND NOT tgisinternal)
         THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 9, 'row_count (informativo — linhas intactas; DROP COLUMN não apaga linhas)',
    'INFO', (SELECT count(*)::text FROM public.work_external_reviews_manual)
) v ORDER BY ord;

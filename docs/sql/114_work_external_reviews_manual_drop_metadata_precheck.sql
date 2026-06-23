-- ============================================================
-- PRECHECK — migration 114 (drop metadata): public.work_external_reviews_manual
-- ============================================================
-- READ-ONLY. Rodar ANTES do apply. UM ÚNICO SELECT (o SQL Editor mostra só o resultado da
-- última instrução; por isso tudo está consolidado aqui). VEREDITO esperado = todo 'PASS'
-- (linhas 1-6) + linha 7 'PASS' (metadados vazios) + linha 8 informativa.
-- ============================================================

SELECT ord, check_name, status, detail FROM (
  SELECT 1 AS ord, '5 colunas de metadados PRESENTES' AS check_name,
    CASE WHEN (SELECT count(*) FROM information_schema.columns
               WHERE table_schema='public' AND table_name='work_external_reviews_manual'
                 AND column_name IN ('source_url','external_review_id','reviewer_name','language','published_at')) = 5
         THEN 'PASS' ELSE 'FAIL' END AS status,
    (SELECT string_agg(column_name, ', ' ORDER BY column_name) FROM information_schema.columns
       WHERE table_schema='public' AND table_name='work_external_reviews_manual'
         AND column_name IN ('source_url','external_review_id','reviewer_name','language','published_at')) AS detail
  UNION ALL SELECT 2, '4 CHECKs dependentes PRESENTES (serão auto-dropados)',
    CASE WHEN (SELECT count(*) FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass
               AND conname IN ('work_external_reviews_manual_source_url_nonblank','work_external_reviews_manual_external_review_id_nonblank',
                               'work_external_reviews_manual_reviewer_name_nonblank','work_external_reviews_manual_language_format')) = 4
         THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 3, 'índice uniq_extid PRESENTE (será auto-dropado)',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='work_external_reviews_manual'
                       AND indexname='work_external_reviews_manual_uniq_extid') THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 4, 'preservados: source/text/normalized_text_hash NOT NULL',
    CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='work_external_reviews_manual'
               AND column_name IN ('source','text','normalized_text_hash') AND is_nullable='NO') = 3 THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 5, 'preservados: CHECKs source_format/text_min40/hash_format',
    CASE WHEN (SELECT count(*) FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass
               AND conname IN ('work_external_reviews_manual_source_format','work_external_reviews_manual_text_min40','work_external_reviews_manual_hash_format')) = 3
         THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 6, 'preservados: uniq_hash + FK CASCADE + RLS + trigger',
    CASE WHEN EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='work_external_reviews_manual' AND indexname='work_external_reviews_manual_uniq_hash')
          AND EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND contype='f' AND pg_get_constraintdef(oid) ILIKE '%ON DELETE CASCADE%')
          AND (SELECT relrowsecurity FROM pg_class WHERE oid='public.work_external_reviews_manual'::regclass)
          AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.work_external_reviews_manual'::regclass AND NOT tgisinternal)
         THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 7, 'metadados TODOS nulos (drop = zero perda)',
    CASE WHEN (SELECT count(*) FROM public.work_external_reviews_manual
               WHERE source_url IS NOT NULL OR external_review_id IS NOT NULL
                  OR reviewer_name IS NOT NULL OR language IS NOT NULL OR published_at IS NOT NULL) = 0
         THEN 'PASS' ELSE 'WARN: há metadado não-nulo — dropar PERDE dado' END,
    (SELECT count(*)::text FROM public.work_external_reviews_manual
       WHERE source_url IS NOT NULL OR external_review_id IS NOT NULL
          OR reviewer_name IS NOT NULL OR language IS NOT NULL OR published_at IS NOT NULL) || ' linha(s) com metadado'
  UNION ALL SELECT 8, 'row_count (informativo — linhas preservadas no drop)',
    'INFO', (SELECT count(*)::text FROM public.work_external_reviews_manual)
) v ORDER BY ord;

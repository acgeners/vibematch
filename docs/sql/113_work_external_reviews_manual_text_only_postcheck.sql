-- ============================================================
-- POSTCHECK — migration 113 (text-only): public.work_external_reviews_manual
-- ============================================================
-- READ-ONLY (seções 1–3). As sondagens (seção 4) inserem dentro de um savepoint que é
-- SEMPRE revertido (RAISE) ⇒ NENHUMA linha é persistida. Rodar DEPOIS do apply.
-- Estado esperado (pós-113): _provenance + _text_nonempty REMOVIDOS; _text_min40 PRESENTE;
-- demais CHECKs/NOT NULL/FK/RLS/policies/índices/trigger intactos; tabela VAZIA.
-- O VEREDITO (seção 1) deve vir TODO 'PASS'. Enviar o arquivo inteiro.
-- ============================================================

-- 1) VEREDITO consolidado (PASS/FAIL por item)
SELECT ord, check_name, status, detail FROM (
  SELECT 1 AS ord, 'row_count continua 0' AS check_name,
         CASE WHEN (SELECT count(*) FROM public.work_external_reviews_manual) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT count(*)::text FROM public.work_external_reviews_manual) AS detail
  UNION ALL SELECT 2, 'constraint _provenance REMOVIDA',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND conname='work_external_reviews_manual_provenance') THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 3, 'constraint _text_nonempty REMOVIDA',
         CASE WHEN NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND conname='work_external_reviews_manual_text_nonempty') THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 4, 'constraint _text_min40 PRESENTE',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND conname='work_external_reviews_manual_text_min40') THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 5, 'def de _text_min40 = char_length(btrim(text)) >= 40',
         CASE WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND conname='work_external_reviews_manual_text_min40')
                   ILIKE '%char_length(btrim(text)) >= 40%' THEN 'PASS' ELSE 'FAIL' END,
         (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND conname='work_external_reviews_manual_text_min40')
  UNION ALL SELECT 6, 'source_url continua NULLABLE',
         CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='work_external_reviews_manual' AND column_name='source_url')='YES' THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 7, 'external_review_id continua NULLABLE',
         CASE WHEN (SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='work_external_reviews_manual' AND column_name='external_review_id')='YES' THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 8, 'source / text / normalized_text_hash NOT NULL',
         CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='work_external_reviews_manual'
                     AND column_name IN ('source','text','normalized_text_hash') AND is_nullable='NO') = 3 THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 9, 'demais CHECKs preservados (7 = 8 - 2 + 1)',
         CASE WHEN (SELECT count(*) FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND contype='c') = 7 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT string_agg(conname, ', ' ORDER BY conname) FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND contype='c')
  UNION ALL SELECT 10, 'FK work_id -> works(id) ON DELETE CASCADE preservada',
         CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.work_external_reviews_manual'::regclass AND contype='f'
                            AND pg_get_constraintdef(oid) ILIKE 'FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE%') THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 11, 'RLS habilitada',
         CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid='public.work_external_reviews_manual'::regclass) THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 12, 'policy_count = 0',
         CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='work_external_reviews_manual')=0 THEN 'PASS' ELSE 'FAIL' END, ''
  UNION ALL SELECT 13, 'índices = 5 (preservados)',
         CASE WHEN (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename='work_external_reviews_manual')=5 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT string_agg(indexname, ', ' ORDER BY indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='work_external_reviews_manual')
  UNION ALL SELECT 14, 'trigger updated_at preservado',
         CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.work_external_reviews_manual'::regclass AND NOT tgisinternal
                            AND tgname='trg_work_external_reviews_manual_updated_at') THEN 'PASS' ELSE 'FAIL' END, ''
) v ORDER BY ord;

-- 2) Detalhe: as 2 removidas NÃO podem mais existir (esperado: 0 linhas)
SELECT con.conname
FROM pg_constraint con
WHERE con.conrelid='public.work_external_reviews_manual'::regclass
  AND con.conname IN ('work_external_reviews_manual_provenance','work_external_reviews_manual_text_nonempty');

-- 3) Detalhe: inventário final dos CHECKs (esperado: 7, com _text_min40, sem provenance/text_nonempty)
SELECT con.conname, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
WHERE con.conrelid='public.work_external_reviews_manual'::regclass AND con.contype='c'
ORDER BY con.conname;

-- ============================================================
-- 4) SONDAGENS comportamentais — FAIL-CLOSED. A subtransação (BEGIN…EXCEPTION) é SEMPRE
--    revertida ⇒ 0 linhas persistidas. work_id via INTO STRICT (NO_DATA_FOUND se works vazia
--    → aborta). Comportamento INESPERADO ⇒ exceção propagada (aborta o DO; não esconde falha).
--    hash estrutural válido (64 hex) só para satisfazer o CHECK de formato.
-- ============================================================

-- 4.1) texto de 39 chars DEVE FALHAR (check_violation no _text_min40).
--   check_violation → PASS · INSERT aceito → RAISE/abort · qualquer outro erro → propaga/abort.
DO $$
DECLARE _wid uuid;
BEGIN
  SELECT id INTO STRICT _wid FROM public.works LIMIT 1;  -- works vazia ⇒ NO_DATA_FOUND (aborta)
  BEGIN
    INSERT INTO public.work_external_reviews_manual (work_id, source, text, normalized_text_hash)
      VALUES (_wid, 'anilist', repeat('a', 39), repeat('1', 64));
    -- alcançou aqui ⇒ o INSERT de 39 chars foi ACEITO (não deveria): ABORTA.
    RAISE EXCEPTION 'PROBE1_FAIL: texto de 39 chars foi ACEITO (esperado violar _text_min40)';
  EXCEPTION
    WHEN check_violation THEN
      RAISE NOTICE 'PROBE1_PASS: 39 chars REJEITADO por check_violation (correto)';
    -- SEM "WHEN others": o PROBE1_FAIL acima e qualquer outro erro NÃO são capturados ⇒ propagam/abortam.
  END;
END $$;

-- 4.2) texto de 40 chars SEM url/id DEVE PASSAR; reverter via subtransação.
--   aceito → reverte + PASS · check_violation/qualquer outro erro → propaga/abort.
DO $$
DECLARE _wid uuid; _id uuid;
BEGIN
  SELECT id INTO STRICT _wid FROM public.works LIMIT 1;  -- works vazia ⇒ NO_DATA_FOUND (aborta)
  BEGIN
    INSERT INTO public.work_external_reviews_manual (work_id, source, text, normalized_text_hash)
      VALUES (_wid, 'anilist', repeat('a', 40), repeat('2', 64))
      RETURNING id INTO _id;
    RAISE NOTICE 'PROBE2_PASS: 40 chars sem url/id ACEITO (id=%); revertendo', _id;
    -- desfaz a linha aceita revertendo a subtransação (sentinela com ERRCODE P0001):
    RAISE EXCEPTION 'probe2_revert' USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN raise_exception THEN          -- P0001 = nosso sentinela OU um raise inesperado
      IF SQLERRM = 'probe2_revert' THEN
        RAISE NOTICE 'PROBE2: linha revertida (subtransaction) — 0 persistidas';
      ELSE
        RAISE;                          -- raise_exception inesperado ⇒ propaga/abort
      END IF;
    -- SEM "WHEN check_violation"/"WHEN others": 40 chars NÃO deveria violar; check_violation e
    -- quaisquer outros erros NÃO são capturados ⇒ propagam/abortam (não escondem falha).
  END;
END $$;

-- 4.3) confirmação final: NENHUMA linha persistida pelas sondagens (esperado: 0)
SELECT count(*) AS row_count_final FROM public.work_external_reviews_manual;

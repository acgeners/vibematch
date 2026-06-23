-- ============================================================
-- 113 - work_external_reviews_manual: alinhar CHECK de texto à política text-only
-- ============================================================
-- Plano 3 Fase B2.2N (text-only, policy text-only-v1). Decisões:
--   (a) SÓ o TEXTO da review é sinal experimental; `source` é metadado administrativo e
--       `source_url`/`external_review_id` (e demais metadados) são OPCIONAIS e inócuos ao
--       digest. ⇒ a exigência "source_url OU external_review_id" deixa de fazer sentido.
--   (b) O schema (Zod) e o corpus canônico exigem review ÚTIL: char_length(btrim(text)) >= 40
--       (mesmo limite do `isUsefulReviewText`). O CHECK atual só garante texto NÃO-VAZIO, o que
--       é mais fraco que a regra real. ⇒ trocar por um CHECK de tamanho mínimo coerente.
--
-- Esta migration faz EXATAMENTE três coisas:
--   1. remove o CHECK de proveniência `work_external_reviews_manual_provenance`;
--   2. remove o CHECK de não-vazio `work_external_reviews_manual_text_nonempty`
--      (era: CHECK (NULLIF(BTRIM(text), '') IS NOT NULL));
--   3. adiciona `work_external_reviews_manual_text_min40`:
--        CHECK (char_length(btrim(text)) >= 40).
--
-- Preservados INTEGRALMENTE (não tocados aqui):
--   - source NOT NULL + CHECK de formato (..._source_format)
--   - text  NOT NULL  (a coluna segue NOT NULL; o nonempty é SUBSTITUÍDO pelo min40)
--   - normalized_text_hash NOT NULL + CHECK 64 hex (..._hash_format)
--   - FK work_id -> public.works(id) ON DELETE CASCADE
--   - RLS habilitada + policies (0) + índices (uniq_extid parcial, uniq_hash, work, created, pkey)
--   - trigger trg_..._updated_at
--   - CHECKs dos metadados opcionais quando preenchidos
--     (..._source_url_nonblank, ..._external_review_id_nonblank, ..._reviewer_name_nonblank,
--      ..._language_format)
--
-- Após aplicar: o banco passa a EXIGIR texto útil (>=40 após trim) e aceita cadastro com
-- SOMENTE `source` + `text` (sem URL/ID). DDL ESTRITO: falha se algum CHECK alvo não existir
-- (drift) ou se já houver linha com texto < 40 (a tabela está VAZIA ⇒ ADD não falha por dados).
--
-- ⚠️ NÃO APLICADA por este passo. Aplicar à mão no SQL Editor (convenção do projeto —
-- histórico mantido fora do CLI; ver §36). A tabela continua VAZIA.
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

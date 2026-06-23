-- ============================================================
-- APPLY MANUAL da migration 112 (public.work_external_reviews_manual)
-- ============================================================
-- Para colar no Supabase SQL Editor. É o CORPO LITERAL da migration 112 envolvido
-- em BEGIN/COMMIT (atomicidade — todos os comandos são DDL transacional; sem
-- CREATE INDEX CONCURRENTLY). Nenhuma outra diferença. Rode o precheck ANTES e o
-- postcheck DEPOIS. NÃO registra a migration no histórico (operação separada).
-- ============================================================

BEGIN;

-- ============================================================
-- 112 - work_external_reviews_manual: reviews EXTERNAS inseridas manualmente
-- ============================================================
-- Canal SEPARADO para reviews EXTERNAS copiadas/cadastradas à mão, COM proveniência
-- verificável (source + url/external_id). Entram no corpus canônico de digest junto
-- de public.work_reviews.
--
-- NÃO é opinião/nota pessoal — essa fica em public.work_manual_reviews (proibida no
-- corpus de digest). Esta tabela NÃO tem user_rating/note/personal_status/label/
-- score/reading_status.
--
-- O hash do texto é calculado NO SERVIDOR (normalização canônica compartilhada com a
-- dedup do corpus). created_by é NULLABLE: o projeto ainda não tem auth confiável; a
-- coluna só é preenchida com sessão admin validada no servidor (nunca do formulário).
--
-- Convenções reaproveitadas: UUID gen_random_uuid() (mig 001); FK public.works ON
-- DELETE CASCADE; CHECK de source ~ '^[a-z0-9][a-z0-9-]{0,79}$' (mig 027); função
-- public.update_updated_at() (mig 001); RLS habilitada SEM policies = acesso só via
-- service role (mig 013). DDL ESTRITO (sem IF NOT EXISTS / DROP): falha em drift.
-- ============================================================

CREATE TABLE public.work_external_reviews_manual (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_id              UUID NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  source               TEXT NOT NULL,
  source_url           TEXT,
  external_review_id   TEXT,
  reviewer_name        TEXT,
  text                 TEXT NOT NULL,
  language             TEXT,
  published_at         TIMESTAMPTZ,
  normalized_text_hash TEXT NOT NULL,
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- source: minúsculo alfanumérico-hífen (mesmo padrão de work_external_ids; não vazio)
  CONSTRAINT work_external_reviews_manual_source_format
    CHECK (source ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  -- texto não vazio após trim (utilidade p/ digest = isUsefulReviewText no servidor)
  CONSTRAINT work_external_reviews_manual_text_nonempty
    CHECK (NULLIF(BTRIM(text), '') IS NOT NULL),
  -- hash: 64 hex minúsculos (estrutura de SHA-256; não confirma correção semântica)
  CONSTRAINT work_external_reviews_manual_hash_format
    CHECK (normalized_text_hash ~ '^[0-9a-f]{64}$'),
  -- proveniência MÍNIMA: pelo menos source_url OU external_review_id (vazio = ausente)
  CONSTRAINT work_external_reviews_manual_provenance
    CHECK (
      NULLIF(BTRIM(source_url), '') IS NOT NULL
      OR NULLIF(BTRIM(external_review_id), '') IS NOT NULL
    ),
  -- opcionais: NULL ou não-vazio após trim (nunca string vazia persistida)
  CONSTRAINT work_external_reviews_manual_source_url_nonblank
    CHECK (source_url IS NULL OR NULLIF(BTRIM(source_url), '') IS NOT NULL),
  CONSTRAINT work_external_reviews_manual_external_review_id_nonblank
    CHECK (external_review_id IS NULL OR NULLIF(BTRIM(external_review_id), '') IS NOT NULL),
  CONSTRAINT work_external_reviews_manual_reviewer_name_nonblank
    CHECK (reviewer_name IS NULL OR NULLIF(BTRIM(reviewer_name), '') IS NOT NULL),
  -- language: NULL ou (não-vazio E código curto pt, en, pt-BR…)
  CONSTRAINT work_external_reviews_manual_language_format
    CHECK (
      language IS NULL
      OR (NULLIF(BTRIM(language), '') IS NOT NULL AND language ~ '^[a-z]{2}(-[A-Za-z]{2,4})?$')
    )
);

-- ── Deduplicação de PERSISTÊNCIA (dentro da mesma fonte) ─────────────────────
-- (a) mesmo external_review_id na mesma obra+fonte (só quando NOT NULL)
CREATE UNIQUE INDEX work_external_reviews_manual_uniq_extid
  ON public.work_external_reviews_manual (work_id, source, external_review_id)
  WHERE external_review_id IS NOT NULL;
-- (b) mesmo texto normalizado na mesma obra+fonte
CREATE UNIQUE INDEX work_external_reviews_manual_uniq_hash
  ON public.work_external_reviews_manual (work_id, source, normalized_text_hash);
-- NOTA: de propósito NÃO há unique cross-source em (work_id, normalized_text_hash):
-- o MESMO texto pode vir de FONTES diferentes (proveniência distinta legítima). A
-- deduplicação CANÔNICA (entre fontes/tabelas) é feita no corpus, que funde as
-- proveniências — não descartar proveniência legítima no nível de persistência.

-- ── Índices de consulta ──────────────────────────────────────────────────────
CREATE INDEX work_external_reviews_manual_work_idx
  ON public.work_external_reviews_manual (work_id);
CREATE INDEX work_external_reviews_manual_created_idx
  ON public.work_external_reviews_manual (created_at);

-- ── updated_at automático (reusa a função compartilhada do projeto) ──────────
-- A tabela é criada nesta migration ⇒ o trigger não pode existir; se existir, FALHA (drift).
CREATE TRIGGER trg_work_external_reviews_manual_updated_at
  BEFORE UPDATE ON public.work_external_reviews_manual
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.work_external_reviews_manual IS
  'Reviews EXTERNAS inseridas manualmente, com proveniência (source + url/external_id). Entram no corpus canônico de digest junto de work_reviews. NÃO contêm opinião/nota pessoal (essa fica em work_manual_reviews, proibida no corpus).';
COMMENT ON COLUMN public.work_external_reviews_manual.normalized_text_hash IS
  'SHA-256 do texto normalizado (trim + NFC + case folding + colapso de espaços/quebras), calculado NO SERVIDOR. Mesma normalização da dedup do corpus canônico (lib/synopsis-interest/canonical-review-corpus.ts).';
COMMENT ON COLUMN public.work_external_reviews_manual.created_by IS
  'Autoria admin (server-side). NULLABLE: o projeto ainda não tem auth confiável; preenchido só com sessão admin validada no servidor (nunca do formulário, nunca auth.uid() sob service role). NÃO inventar autoria.';
COMMENT ON COLUMN public.work_external_reviews_manual.source_url IS
  'URL da review original. Proveniência: exige source_url OU external_review_id.';

-- ── RLS: habilitada, SEM policies (acesso só via service role) ───────────────
ALTER TABLE public.work_external_reviews_manual ENABLE ROW LEVEL SECURITY;
-- Sem CREATE POLICY: anon/authenticated bloqueados; admin = service role server-side
-- (padrão do projeto — ver migration 013). NÃO usar "authenticated = acesso total".

COMMIT;

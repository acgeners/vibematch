-- ============================================================
-- 110 — work_processing_jobs  [Orquestração de dependências, Fase B passo 1]
-- ============================================================
-- ADITIVA e NÃO-DESTRUTIVA. Rastreia jobs de enriquecimento assíncrono (o que
-- hoje roda solto em `after()` sem status/retry). NÃO altera nenhuma tabela ou
-- coluna existente; NÃO mexe em ranking/scores. O orquestrador degrada
-- graciosamente para single-flight EM MEMÓRIA enquanto esta tabela não existir
-- (lib/orchestration/jobs.ts → getJobStore), então mergeá-lo antes de aplicar a
-- migration não quebra nada.
--
-- Numeração: 106 reservada (feat/shadow-ranking), 107 ai_cache_events,
-- 108 synopsis_quality_provenance, 109 synopsis_interest_golden → esta é 110.
-- ============================================================

create table if not exists work_processing_jobs (
  id                uuid primary key default gen_random_uuid(),
  -- nullable: jobs globais (ex.: recalculate_scores, ensure_taste_profile) não
  -- pertencem a uma obra. on delete cascade limpa jobs de obras removidas.
  work_id           uuid references works(id) on delete cascade,
  action            text not null,
  -- chave de deduplicação = idempotency key do contrato (action:work:assinatura).
  dedup_key         text not null,
  status            text not null default 'queued'
                      check (status in ('queued','running','succeeded','failed','skipped')),
  attempts          integer not null default 0,
  cost_estimate_usd numeric,
  cost_actual_usd   numeric,
  error_category    text,
  last_error        text,
  -- args mínimos p/ retomada idempotente após falha parcial (Fase B).
  payload           jsonb,
  created_at        timestamptz not null default now(),
  started_at        timestamptz,
  finished_at       timestamptz
);

-- Dedup CROSS-PROCESSO: no máximo um job ATIVO por dedup_key. O claim do
-- SupabaseJobStore depende deste índice (violação → trata como "já em voo").
create unique index if not exists work_processing_jobs_active_dedup
  on work_processing_jobs (dedup_key)
  where status in ('queued','running');

-- Lookups por obra/ação (UI de progresso, readiness).
create index if not exists work_processing_jobs_work_action_idx
  on work_processing_jobs (work_id, action);

-- Varredura de falhas pendentes de retomada.
create index if not exists work_processing_jobs_failed_idx
  on work_processing_jobs (status)
  where status = 'failed';

-- RLS ligado, SEM policy permissiva — acesso só via service role (createAdminClient),
-- idêntico ao restante do schema. Bloqueia anon de propósito.
alter table work_processing_jobs enable row level security;

comment on table work_processing_jobs is
  'Rastreio de jobs de enriquecimento assíncrono (orquestração Fase B). Aditiva; o orquestrador cai p/ single-flight em memória quando ausente.';
comment on column work_processing_jobs.dedup_key is
  'Chave de idempotência (action:work:assinatura). Índice único parcial garante 1 job ativo por chave.';
comment on column work_processing_jobs.payload is
  'Args mínimos p/ retomada idempotente após falha parcial.';

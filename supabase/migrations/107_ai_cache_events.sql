-- ============================================================
-- 107 — ai_cache_events (telemetria REAL do cache de resultado)  [Plano 2]
-- ============================================================
-- Camada ADITIVA e NÃO-DESTRUTIVA. NÃO altera ai_api_calls (059).
--
-- Por quê uma tabela separada: um HIT de cache curto-circuita ANTES da chamada
-- ao provider, então `ai_api_calls` (que representa TENTATIVAS do provider) NUNCA
-- vê o hit. Registrar hit como linha de custo zero em ai_api_calls distorceria
-- custo/latência/contagem de tentativas. Aqui medimos a CONSULTA ao cache, não a
-- chamada ao provider — é onde os hits finalmente aparecem.
--
-- Distinção de conceitos (plano §9):
--   • cache lookup        → uma consulta ao cache (1 linha, status RESOLVIDO);
--   • cache layer event   → opcionalmente uma linha por camada (memory→miss,
--                            persistent→hit); a coluna `is_resolution` separa o
--                            evento FINAL (que conta na taxa) dos intermediários;
--   • provider call       → continua só em ai_api_calls.
--
-- Best-effort: a escrita destes eventos NUNCA pode derrubar o fluxo funcional.
-- A numeração 106 está reservada pela branch feat/shadow-ranking; esta é 107.
--
-- RLS ligado sem policy (anon bloqueado; service role ignora) — padrão do schema.
-- ============================================================

create table if not exists ai_cache_events (
  id                     uuid primary key default gen_random_uuid(),

  -- Agrupa o evento de cache com as TENTATIVAS da mesma solicitação lógica em
  -- ai_api_calls.metadata.logical_request_id (correlação, sem FK).
  logical_request_id     uuid,

  operation              text not null,
  workload_type          text not null default 'unknown'
    check (workload_type in (
      'recurring','backfill','test','development',
      'manual_reprocess','admin','experiment','unknown'
    )),

  -- Camada onde o evento ocorreu. 'resolution' marca o resultado FINAL da
  -- consulta (o único que entra na taxa de hit) quando há eventos por-camada.
  cache_layer            text not null
    check (cache_layer in ('memory','persistent','resolution')),

  -- Status RICO (lib/ai-cache AiCacheEventStatus). CHECK reflete o enum atual;
  -- crescer o enum é uma migration nova (mesma disciplina do status de 059).
  cache_status           text not null
    check (cache_status in (
      'hit_memory','hit_persistent',
      'miss_not_found','miss_input_changed','miss_prompt_changed',
      'miss_model_changed','miss_schema_changed','miss_expired','miss_previous_error',
      'bypass_manual','bypass_experiment','bypass_force_refresh',
      'cache_error','unknown'
    )),

  -- True = este é o evento de RESOLUÇÃO da consulta (conta na taxa). Eventos
  -- de camada intermediária (ex.: miss em memory antes do hit em persistent)
  -- entram com false para não dupla-contar.
  is_resolution          boolean not null default true,

  -- Detalhe livre opcional do motivo (o sinal primário é cache_status).
  cache_miss_reason      text,

  -- Chave de cache consultada (sha256 hex) — NUNCA o conteúdo/prompt/secret.
  input_hash             text,
  model_name             text,
  prompt_version         text,
  output_schema_version  text,

  -- Per-user-ready; hoje user_id = singleton de user_settings. Sem FK p/ não
  -- acoplar telemetria efêmera ao ciclo de vida de works/users.
  work_id                uuid,
  user_id                uuid,

  lookup_latency_ms      integer,
  metadata               jsonb not null default '{}'::jsonb,

  created_at             timestamptz not null default now(),

  constraint ai_cache_events_latency_nonneg
    check (lookup_latency_ms is null or lookup_latency_ms >= 0)
);

-- Índices só pros filtros reais do painel /ai-usage:
--   (created_at)            → janela temporal.
--   (operation, created_at) → por operação + período (taxa de hit por op).
--   (logical_request_id)    → correlacionar com as tentativas em ai_api_calls.
create index if not exists ai_cache_events_created_idx
  on ai_cache_events (created_at desc);
create index if not exists ai_cache_events_operation_created_idx
  on ai_cache_events (operation, created_at desc);
create index if not exists ai_cache_events_logical_req_idx
  on ai_cache_events (logical_request_id)
  where logical_request_id is not null;

alter table ai_cache_events enable row level security;

comment on table ai_cache_events is
  'Telemetria REAL do cache de RESULTADO de IA (hits/misses/bypass). Aditiva; NÃO toca ai_api_calls (059). Hits aparecem só aqui. Plano 2 §8. Best-effort.';
comment on column ai_cache_events.is_resolution is
  'true = evento FINAL da consulta (conta na taxa de hit). false = camada intermediária.';
comment on column ai_cache_events.input_hash is
  'sha256 hex da chave de cache. NUNCA contém conteúdo/prompt/secret.';

-- Retenção (FUTURO — não implementar limpeza agora): eventos são efêmeros;
-- um job poderá podar created_at < now() - interval '90 days'. Sem cron aqui.

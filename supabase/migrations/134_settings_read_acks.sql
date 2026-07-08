-- ============================================================
-- 134 - Marcar pendências de /settings como "lidas"
-- ============================================================
-- Silencia os contadores de pendência de /settings (badge da barra
-- lateral + badge do tópico/sub-nav + pílula do card) SEM resolver as
-- pendências. Espelha o que a migration 125 fez pra /ai-evaluation, mas
-- as pendências de /settings NÃO são "obras numa fila" — são de dois
-- formatos distintos, então há dois modelos de "lido":
--
--   A) Cards AGREGADOS (batch): 'embeddings', 'synopsis-canonical',
--      'review-synthesis', 'comix'. A pendência é uma CONTAGEM ("12 obras
--      sem embedding"). Marcar como lido grava um SNAPSHOT da contagem
--      atual; o badge passa a mostrar só o excesso `max(0, atual - snapshot)`.
--      Re-notifica quando a contagem SOBE acima do snapshot (surgiu algo
--      novo). Uma linha por seção.
--
--   B) Card GRANULAR 'ai-audit' (Auditoria de critérios IA): cada pendência
--      é uma sugestão individual (`score_calibration_suggestions.id`).
--      Marcar como lido é 1-a-1 (ou tudo via o botão global). Uma linha por
--      sugestão acked; a sugestão é "lida" se existe a linha. Re-notifica
--      naturalmente: um novo run cria sugestões com ids novos (sem ack).
--
-- RLS ligado, sem policies: acesso só via service role (padrão do projeto).
-- ============================================================

-- (A) Snapshot por seção agregada.
create table if not exists public.settings_read_acks (
  section text primary key,
  acked_count integer not null default 0,
  acked_at timestamptz not null default now()
);

alter table public.settings_read_acks enable row level security;

-- (B) Ack por sugestão da auditoria de critérios. `on delete cascade`: se a
-- sugestão é apagada, a ack some junto (não deixa lixo referenciando id morto).
create table if not exists public.settings_suggestion_read_acks (
  suggestion_id uuid primary key
    references public.score_calibration_suggestions(id) on delete cascade,
  acked_at timestamptz not null default now()
);

alter table public.settings_suggestion_read_acks enable row level security;

-- Contagem de sugestões PENDENTES ainda NÃO lidas — o unread do card 'ai-audit'.
-- Feita no banco (NOT EXISTS) pra o badge da sidebar não precisar puxar até ~1000
-- ids de sugestão a cada navegação; é `stable` e roda como service role.
create or replace function public.count_unread_pending_suggestions()
returns integer
language sql
stable
as $$
  select count(*)::int
  from public.score_calibration_suggestions s
  where s.status = 'pending'
    and not exists (
      select 1
      from public.settings_suggestion_read_acks a
      where a.suggestion_id = s.id
    );
$$;

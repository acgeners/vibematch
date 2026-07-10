-- 138_user_work_state.sql
-- Fase 2 (PLANO-MULTIUSER.md) — partição do estado PER-USUÁRIO-POR-OBRA.
--
-- Extrai as colunas pessoais de `works` (compartilhada) para uma tabela própria
-- (user_id, work_id). ADITIVO: NÃO dropa as colunas de `works` — elas seguem
-- como fonte durante a transição; o rewire dos readers/writers vem depois, e o
-- drop das colunas legadas só quando tudo estiver verde.
--
-- Backfill: todo o estado atual pertence ao DONO → user_id = current_user_id da
-- linha singleton (a mais antiga de user_settings).
--
-- Aplicar à mão no SQL editor do Supabase.

create table if not exists public.user_work_state (
  user_id uuid not null,
  work_id uuid not null references public.works(id) on delete cascade,

  -- leitura / acompanhamento
  is_favorite boolean not null default false,
  personal_status_id integer references public.personal_status(id),
  chapters_read integer,
  last_read_at timestamptz,

  -- notas do usuário
  user_score numeric,
  observation_adjustment numeric not null default 0,
  observations text,

  -- interesse na sinopse (♥)
  synopsis_quality text,
  synopsis_quality_source text not null default 'legacy_unknown'
    check (synopsis_quality_source in ('legacy_unknown','human_manual','prediction_applied')),
  synopsis_quality_prediction_id uuid,
  synopsis_interest_skipped boolean not null default false,

  -- notas pós-leitura
  post_story_score numeric,
  post_fl_score numeric,
  post_ml_score numeric,
  post_character_development_score numeric,
  post_pacing_score numeric,
  post_art_visual_score numeric,
  post_impact_immersion_score numeric,
  post_originality_score numeric,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (user_id, work_id)
);

create index if not exists idx_user_work_state_work on public.user_work_state (work_id);
create index if not exists idx_user_work_state_user_fav
  on public.user_work_state (user_id) where is_favorite = true;

-- Backfill: estado atual de works → linha do DONO (singleton). Idempotente.
insert into public.user_work_state (
  user_id, work_id,
  is_favorite, personal_status_id, chapters_read, last_read_at,
  user_score, observation_adjustment, observations,
  synopsis_quality, synopsis_quality_source, synopsis_quality_prediction_id, synopsis_interest_skipped,
  post_story_score, post_fl_score, post_ml_score, post_character_development_score,
  post_pacing_score, post_art_visual_score, post_impact_immersion_score, post_originality_score
)
select
  (select current_user_id from public.user_settings order by created_at asc limit 1),
  w.id,
  w.is_favorite, w.personal_status_id, w.chapters_read, w.last_read_at,
  w.user_score, w.observation_adjustment, w.observations,
  w.synopsis_quality, w.synopsis_quality_source, w.synopsis_quality_prediction_id, w.synopsis_interest_skipped,
  w.post_story_score, w.post_fl_score, w.post_ml_score, w.post_character_development_score,
  w.post_pacing_score, w.post_art_visual_score, w.post_impact_immersion_score, w.post_originality_score
from public.works w
on conflict (user_id, work_id) do nothing;

-- Mesmo padrão do resto: RLS ligado, sem policy (acesso só via service role).
alter table public.user_work_state enable row level security;

comment on table public.user_work_state is
  'Estado per-usuário-por-obra (favorito, nota, leitura, pós-leitura, interesse). Extraído de works na Fase 2 do multi-user. Durante a transição, works.* segue como fonte legada; backfill inicial = tudo do dono (singleton).';

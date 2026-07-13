-- 141_recommendation_runs_user_id.sql
--
-- P0 (PLANO-MULTIUSER-FASE2.md §3.2): o teto de recomendações era GLOBAL.
--
-- `getRunsToday()` contava `recommendation_runs` das últimas 24h SEM filtro de usuário
-- — porque a coluna não existia. Com MAX_RUNS_PER_DAY = 20, isso é um teto de 20 runs/dia
-- para o APP INTEIRO: um usuário esgotava a cota de todos os outros.
--
-- Aditivo e reversível: a coluna é NULLABLE. O backfill atribui o histórico ao DONO (a
-- linha singleton de user_settings), que é de fato quem gerou todas as runs até aqui.
--
-- Aplicar à mão no SQL editor do Supabase (o CLI está dessincronizado).

alter table public.recommendation_runs
  add column if not exists user_id uuid;

-- Histórico → dono. `current_user_id` da linha mais antiga de user_settings é o mesmo
-- id que `getCurrentUserId()` resolve para ele.
update public.recommendation_runs
set user_id = (
  select current_user_id
  from public.user_settings
  order by created_at asc
  limit 1
)
where user_id is null;

-- O índice que a cota usa: "quanto ESTE usuário rodou nas últimas 24h".
create index if not exists recommendation_runs_user_created_idx
  on public.recommendation_runs (user_id, created_at desc);

comment on column public.recommendation_runs.user_id is
  'Dono da run. NULL = run de sistema (sem sessão). A cota diária conta por este campo — antes da migration 141 o teto era global e um usuário esgotava a cota de todos.';

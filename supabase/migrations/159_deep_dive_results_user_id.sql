-- 159_deep_dive_results_user_id.sql
--
-- P0 (mesmo bug da migration 141, outra tabela): o teto de Deep Dives era GLOBAL.
--
-- `getDeepDivesToday()` contava `deep_dive_results` das últimas 24h SEM filtro de usuário
-- — porque a coluna não existia (a tabela nasceu na migration 072 e a 141 só corrigiu
-- `recommendation_runs`). Com MAX_DEEP_DIVES_PER_DAY = 10, isso é um teto de 10/dia para o
-- APP INTEIRO: um usuário esgotava os Deep Dives de todos os outros. Deep Dive usa extended
-- thinking (a chamada mais cara do app), então é o vetor de denial-of-service mais grave.
--
-- A cota em US$ por-usuário (`ensureAiConsumption`) já protegia o *custo*; esta migration
-- fecha o *contador de frequência*, que é uma trava separada.
--
-- Aditivo e reversível: a coluna é NULLABLE. O backfill atribui o histórico ao DONO (a
-- linha singleton de user_settings), que é de fato quem gerou todos os Deep Dives até aqui.
--
-- Aplicar à mão no SQL editor do Supabase (o CLI está dessincronizado).

alter table public.deep_dive_results
  add column if not exists user_id uuid;

-- Histórico → dono. `current_user_id` da linha mais antiga de user_settings é o mesmo
-- id que `getSessionUserId()`/`getOwnerUserId()` resolvem para ele.
update public.deep_dive_results
set user_id = (
  select current_user_id
  from public.user_settings
  order by created_at asc
  limit 1
)
where user_id is null;

-- O índice que a cota usa: "quantos Deep Dives ESTE usuário rodou nas últimas 24h".
create index if not exists deep_dive_results_user_created_idx
  on public.deep_dive_results (user_id, created_at desc);

comment on column public.deep_dive_results.user_id is
  'Dono do Deep Dive. NULL = registro de sistema (sem sessão). A cota diária conta por este campo — antes da migration 159 o teto era global e um usuário esgotava os Deep Dives de todos.';

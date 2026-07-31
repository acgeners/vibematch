-- Rollback da 169 (pilot_taste_scores per-user) — SÓ VALE ENQUANTO A TABELA TIVER
-- UM ÚNICO user_id. Com um segundo usuário avaliando, voltar a PK(work_id) exigiria
-- descartar linhas — aí o rollback correto é restaurar do backup, não este script.
-- Ensaio: rodar em transação no Postgres local (BEGIN; \i migration; \i rollback; ROLLBACK).

set lock_timeout = '5s';

do $$
declare n_users int;
begin
  select count(distinct user_id) into n_users from public.pilot_taste_scores;
  if n_users > 1 then
    raise exception 'rollback abortado: % usuários distintos na tabela — restaurar do backup', n_users;
  end if;
end $$;

drop policy if exists pilot_taste_scores_own_select on public.pilot_taste_scores;
drop policy if exists pilot_taste_scores_own_insert on public.pilot_taste_scores;
drop policy if exists pilot_taste_scores_own_update on public.pilot_taste_scores;
drop policy if exists pilot_taste_scores_own_delete on public.pilot_taste_scores;

revoke select, insert, update, delete on public.pilot_taste_scores from authenticated;

alter table public.pilot_taste_scores drop constraint pilot_taste_scores_pkey;
alter table public.pilot_taste_scores add primary key (work_id);
alter table public.pilot_taste_scores drop column user_id;

comment on table public.pilot_taste_scores is
  'Piloto do gosto segmentado (Fase 3). 1 linha/obra; 6 eixos + gostei geral; escala {2,4,6.5,8,10} ou NULL. Ver PLANO-ARQUITETURA-NOTAS.md.';

-- Rollback da 216: remove a versão da avaliação (`read_edition`, `read_edition_source`) de
-- `user_work_state`. Volta ao estado anterior: nenhuma avaliação tinha versão.
--
-- ⚠️ Apaga também a versão das avaliações criadas DEPOIS da 216 (a coluna inteira sai). Notas, status
-- e o resto da linha não são tocados. O aviso abaixo imprime quantas tinham versão, para o registro.

set lock_timeout = '5s';

do $rb$
declare n_backfill int; n_novas int;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'user_work_state' and column_name = 'read_edition') then
    raise exception 'rollback 216: read_edition não existe — a 216 não foi aplicada aqui';
  end if;
  select count(*) filter (where read_edition_source = 'explicit_user_decision'),
         count(*) filter (where read_edition_source in ('active_version', 'user_choice'))
    into n_backfill, n_novas from public.user_work_state;
  raise warning 'rollback 216: removendo a versão de % avaliação(ões) do backfill e de % criada(s) depois', n_backfill, n_novas;
end
$rb$;

alter table public.user_work_state drop constraint if exists user_work_state_read_edition_par;
alter table public.user_work_state drop constraint if exists user_work_state_read_edition_source_check;
alter table public.user_work_state drop constraint if exists user_work_state_read_edition_check;
alter table public.user_work_state drop column if exists read_edition_source;
alter table public.user_work_state drop column if exists read_edition;

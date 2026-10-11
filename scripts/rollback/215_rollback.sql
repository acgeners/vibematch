-- Rollback da 215: devolve `adult_override = true` às obras liberadas e apaga o registro delas no log.
-- Só restaura obra cujo override continua NULL (decisão posterior de alguém fica). Apaga a tabela de
-- log se ela ficar vazia (foi criada pela 215).

set lock_timeout = '5s';

do $rb$
declare n int; n_bkp int;
begin
  if to_regclass('bkp.mig215_works_antes') is null then
    raise exception 'rollback 215: bkp.mig215_works_antes não existe — a 215 não foi aplicada aqui';
  end if;
  select count(*) into n_bkp from bkp.mig215_works_antes where adult_override is true;
  update public.works w set adult_override = b.adult_override
    from bkp.mig215_works_antes b where w.id = b.id and w.adult_override is null and b.adult_override is true;
  get diagnostics n = row_count;
  if n < n_bkp then
    raise warning 'rollback 215: % override(s) foram decididos de novo depois da 215 e NÃO foram restaurados', n_bkp - n;
  end if;
  delete from public.work_adult_override_log where evidence->>'mig' = '215';
  if not exists (select 1 from public.work_adult_override_log) then
    drop table public.work_adult_override_log;
  end if;
  drop table bkp.mig215_works_antes;
end
$rb$;

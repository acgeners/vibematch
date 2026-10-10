-- Rollback da 203 (aviso de violência/abuso sexual não liga o gate 18+).
--
-- Restaura, a partir do que a própria 203 guardou em `bkp`:
--   · as flags `adult_indicator` / `adult_indicator_strong` das 13 tags;
--   · `adult_auto` / `adult_reason` das obras que a 203 recalculou.
-- `is_adult` volta sozinho (coluna gerada). Override, r19_edition e notas nunca foram tocados.
--
-- ⚠️ Só restaura a obra que continua EXATAMENTE como a 203 a deixou. Se alguém (curadoria, o
-- enriquecimento, a 2ª opinião) mudou `adult_auto`/`adult_reason` depois, ela fica como está e
-- o rollback AVISA quantas — sobrescrever apagaria uma decisão posterior.
-- Ensaio: `npm run test:db-gate-aviso-sexual` (migration + rollback numa transação, no local).

set lock_timeout = '5s';

do $rb$
declare n_tags int; n_obras int; n_restauradas int; n_puladas int;
begin
  if to_regclass('bkp.mig203_tags_antes') is null or to_regclass('bkp.mig203_works_antes') is null then
    raise exception 'rollback 203: as tabelas bkp.mig203_* não existem — a 203 não foi aplicada aqui';
  end if;
  select count(*) into n_tags from bkp.mig203_tags_antes;
  if n_tags <> 13 then
    raise exception 'rollback 203: esperava 13 tags no backup, há %; abortando', n_tags;
  end if;

  update public.tags t
     set adult_indicator = b.adult_indicator, adult_indicator_strong = b.adult_indicator_strong
    from bkp.mig203_tags_antes b
   where t.slug = b.slug;

  select count(*) into n_obras from bkp.mig203_works_antes;

  update public.works w
     set adult_auto = b.adult_auto, adult_reason = b.adult_reason
    from bkp.mig203_works_antes b
   where w.id = b.work_id
     and w.adult_auto = b.adult_auto_depois
     and w.adult_reason is not distinct from b.adult_reason_depois;
  get diagnostics n_restauradas = row_count;
  n_puladas := n_obras - n_restauradas;

  if n_puladas > 0 then
    raise warning 'rollback 203: % obra(s) mudaram depois da 203 e NÃO foram restauradas — conferir à mão', n_puladas;
  end if;
  raise notice 'rollback 203: 13 tags e % de % obra(s) restauradas', n_restauradas, n_obras;
end
$rb$;

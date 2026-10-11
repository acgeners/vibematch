-- Rollback da 214 (as 280 notas por edição das 140 mixed + as 3 marcas de extras R19).
--
-- Apaga as linhas que a 214 gravou (marcadas `evidence.mig = '214'`). Linha que uma fonte posterior
-- substituiu (curadoria, avaliação por edição) não carrega mais a marca e FICA — o rollback avisa
-- quantas. Devolve `r18_extra_chapters` e `evidence` das 3 obras ao que estava em
-- `bkp.mig214_estado_antes` (só se a marca ainda é a da 214). ⚠️ Recusa com a 215 aplicada: rode
-- `215_rollback.sql` antes. `category_scores` nunca foi tocada pela 214.

set lock_timeout = '5s';

do $rb$
declare n int; n_del int; n_est int; v_215 boolean := false;
begin
  if to_regclass('public.work_edition_scores') is null then
    raise exception 'rollback 214: work_edition_scores não existe — a 213 não está aplicada';
  end if;
  -- Dinâmico: o rollback da 215 apaga a tabela de log, e uma referência estática a ela quebraria aqui.
  if to_regclass('public.work_adult_override_log') is not null then
    execute $q$select exists (select 1 from public.work_adult_override_log where evidence->>'mig' = '215')$q$ into v_215;
  end if;
  if v_215 then
    raise exception 'rollback 214: a 215 está aplicada — rode o rollback da 215 antes';
  end if;
  delete from public.work_edition_scores where evidence->>'mig' = '214';
  get diagnostics n_del = row_count;
  select count(*) into n from public.work_edition_scores;
  if n > 0 then
    raise warning 'rollback 214: % linha(s) sem a marca da 214 ficaram (gravadas depois) — conferir à mão', n;
  end if;
  if to_regclass('bkp.mig214_estado_antes') is not null then
    update public.work_edition_state s
       set r18_extra_chapters = b.r18_extra_chapters, evidence = b.evidence
      from bkp.mig214_estado_antes b
     where s.work_id = b.work_id and s.evidence ? 'extras_r19_mig214';
    get diagnostics n_est = row_count;
    drop table bkp.mig214_estado_antes;
  end if;
  raise notice 'rollback 214: % linha(s) apagadas · % marca(s) de extras desfeitas', n_del, coalesce(n_est, 0);
end
$rb$;

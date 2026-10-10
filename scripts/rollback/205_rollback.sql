-- Rollback da 205 (as 206 obras com r19_edition classificadas pela auditoria de 2026-10-10).
--
-- Restaura, a partir do que a própria 205 guardou em `bkp.mig205_*`:
--   · os 206 estados de edição LEGADOS (mixed, decided_by = 'legacy') — e com eles, pelo gatilho da
--     204, `works.r19_edition`, `works.edition_state` e a tag "R19 disponível";
--   · os vínculos de tag removidos (r19, R19 Version e a tag de exibição), com a procedência ORIGINAL;
--   · `adult_auto` / `adult_reason` das wrong_signal recalculadas (a 205 não toca `adult_override`);
--   · os 4 aliases; a tag "Uncensored Version Available" só sai se ninguém a usa.
-- `is_adult` volta sozinho (coluna gerada). Nenhuma nota foi tocada pela 205.
--
-- ⚠️ Só restaura o que continua EXATAMENTE como a 205 deixou. Estado que a curadoria trocou depois,
-- adult_auto que o enriquecimento religou, override que alguém decidiu de novo: fica como está, e o
-- rollback AVISA quantos — sobrescrever apagaria uma decisão posterior.
-- Ensaio: `npm run test:db-edicao-mixed` (migration + rollback numa transação desfeita no fim).

set lock_timeout = '5s';

do $rb$
declare
  n_est int; n_rest int; n_auto int; n_auto_rest int; n_tags int; n_tags_rest int; v_tag uuid; n_uso int;
begin
  if to_regclass('bkp.mig205_estado_antes') is null or to_regclass('bkp.mig205_works_antes') is null
     or to_regclass('bkp.mig205_work_tags_removidas') is null or to_regclass('bkp.mig205_tag_alias_antes') is null then
    raise exception 'rollback 205: as tabelas bkp.mig205_* não existem — a 205 não foi aplicada aqui';
  end if;
  select count(*) into n_est from bkp.mig205_estado_antes;
  if n_est <> 206 then raise exception 'rollback 205: esperava 206 estados no backup, há %; abortando', n_est; end if;

  -- 1) Estados: só a linha que ainda é a auditada pela 205 (ela carrega o estado legado dentro).
  update public.work_edition_state s
     set state = b.state, basis = b.basis, decided_by = b.decided_by, evidence = b.evidence,
         evidence_fetched_at = b.evidence_fetched_at, r18_extra_chapters = b.r18_extra_chapters,
         decided_at = b.decided_at
    from bkp.mig205_estado_antes b
   where s.work_id = b.work_id and s.decided_by = 'audit' and s.evidence ? 'estado_legado_mig204';
  get diagnostics n_rest = row_count;
  if n_rest < n_est then
    raise warning 'rollback 205: % estado(s) mudaram depois da 205 e NÃO foram restaurados — conferir à mão', n_est - n_rest;
  end if;

  -- 2) Vínculos de tag, com a procedência original. A tag de exibição só volta onde o estado é mixed
  --    de novo (o gatilho já a recriou com source 'edition_state'; aqui ela recupera a original).
  perform set_config('app.edition_state_sync', 'on', true);
  insert into public.work_tags (work_id, tag_id, source, confidence, created_at)
  select b.work_id, b.tag_id, b.source, b.confidence, b.created_at
    from bkp.mig205_work_tags_removidas b
    join public.tags t on t.id = b.tag_id
   where exists (select 1 from public.works w where w.id = b.work_id)
     and (not t.marks_r19_edition
          or exists (select 1 from public.work_edition_state s where s.work_id = b.work_id and s.state = 'mixed'))
  on conflict (work_id, tag_id) do update
     set source = excluded.source, confidence = excluded.confidence, created_at = excluded.created_at
   where public.work_tags.source = 'edition_state';
  get diagnostics n_tags_rest = row_count;
  perform set_config('app.edition_state_sync', '', true);
  select count(*) into n_tags from bkp.mig205_work_tags_removidas;

  -- 3) adult_auto / adult_reason: só onde ainda está como a 205 deixou.
  select count(*) into n_auto from bkp.mig205_works_antes;
  update public.works w
     set adult_auto = b.adult_auto, adult_reason = b.adult_reason
    from bkp.mig205_works_antes b
   where w.id = b.work_id
     and w.adult_auto = b.adult_auto_depois
     and w.adult_reason is not distinct from b.adult_reason_depois;
  get diagnostics n_auto_rest = row_count;
  if n_auto_rest < n_auto then
    raise warning 'rollback 205: % obra(s) com adult_auto mudado depois da 205 NÃO foram restauradas', n_auto - n_auto_rest;
  end if;

  -- 4) Aliases.
  delete from public.tag_alias a
   using bkp.mig205_tag_alias_antes b
   where a.alias_slug = b.alias_slug and b.canonical_tag_id is null;
  insert into public.tag_alias (alias_slug, canonical_tag_id)
  select b.alias_slug, b.canonical_tag_id from bkp.mig205_tag_alias_antes b
   where b.canonical_tag_id is not null and exists (select 1 from public.tags t where t.id = b.canonical_tag_id)
  on conflict (alias_slug) do update set canonical_tag_id = excluded.canonical_tag_id;

  -- 5) A tag restaurada pela 205: sai só se ninguém a usa (obra ou preferência).
  select c.tag_id into v_tag from bkp.mig205_tag_criada c join public.tags t on t.id = c.tag_id limit 1;
  if v_tag is not null then
    select (select count(*) from public.work_tags where tag_id = v_tag)
         + (select count(*) from public.user_tag_preferences where tag_id = v_tag)
      into n_uso;
    if n_uso = 0 then
      delete from public.tags where id = v_tag;
    else
      raise warning 'rollback 205: a tag "Uncensored Version Available" tem % uso(s) depois da 205 — FICA (o alias antigo volta e tem precedência na ingestão)', n_uso;
    end if;
  end if;

  raise notice 'rollback 205: % de % estado(s) · % vínculo(s) de tag (de %) · % de % obra(s) com adult_auto restaurado',
    n_rest, n_est, n_tags_rest, n_tags, n_auto_rest, n_auto;
end
$rb$;

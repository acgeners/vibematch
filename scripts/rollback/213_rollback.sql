-- Rollback da 213 (estrutura dos scores por edição).
--
-- Desfaz: a tabela `work_edition_scores` (com a função de força e o gatilho), a coluna
-- `user_settings.preferred_mixed_edition`, as colunas `expected_edition`/`expected_by_edition` das duas
-- tabelas de scores (com a função que as valida) e o contrato `s9-fantasy-b-edicao-v1` em
-- `canonical_contract`.
--
-- ⚠️ RECUSA se houver nota por edição gravada: rode antes os rollbacks da 215 e da 214 (nessa ordem).
-- Apagar a tabela com dado apagaria nota de curadoria sem backup.
-- ⚠️ RECUSA se algum resultado de scoring já foi gravado com o contrato novo: com `enforce` ligado, a
-- linha ficaria declarando um contrato que o banco não aceita mais. Recalcule com o código antigo antes.
-- Ensaio: `npm run test:db-edicao-fase2`.

set lock_timeout = '5s';

do $rb$
declare n int;
begin
  if to_regclass('public.work_edition_scores') is not null then
    select count(*) into n from public.work_edition_scores;
    if n > 0 then
      raise exception 'rollback 213: work_edition_scores tem % linha(s) — rode os rollbacks 215 e 214 antes', n;
    end if;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
              and table_name = 'calculated_scores' and column_name = 'scoring_contract') then
    select count(*) into n from public.calculated_scores where scoring_contract = 's9-fantasy-b-edicao-v1';
    if n > 0 then
      raise exception 'rollback 213: % linha(s) de calculated_scores gravadas com s9-fantasy-b-edicao-v1 — recalcule com o código anterior antes', n;
    end if;
    select count(*) into n from public.user_calculated_scores where scoring_contract = 's9-fantasy-b-edicao-v1';
    if n > 0 then
      raise exception 'rollback 213: % linha(s) de user_calculated_scores gravadas com s9-fantasy-b-edicao-v1 — recalcule com o código anterior antes', n;
    end if;
  end if;
end
$rb$;

drop trigger if exists trg_work_edition_scores_guard on public.work_edition_scores;
drop table if exists public.work_edition_scores;
drop function if exists public.trg_work_edition_scores_guard();
drop function if exists public.work_edition_score_strength(text);

alter table public.user_settings drop constraint if exists user_settings_preferred_mixed_edition_check;
alter table public.user_settings drop column if exists preferred_mixed_edition;
alter table public.calculated_scores drop constraint if exists calculated_scores_expected_edition_check;
alter table public.calculated_scores drop constraint if exists calculated_scores_expected_by_edition_check;
alter table public.calculated_scores drop column if exists expected_edition;
alter table public.calculated_scores drop column if exists expected_by_edition;
alter table public.user_calculated_scores drop constraint if exists user_calculated_scores_expected_edition_check;
alter table public.user_calculated_scores drop constraint if exists user_calculated_scores_expected_by_edition_check;
alter table public.user_calculated_scores drop column if exists expected_edition;
alter table public.user_calculated_scores drop column if exists expected_by_edition;
drop function if exists public.expected_by_edition_valido(jsonb);

-- O código anterior grava `s9-fantasy-b-v1`. Se ele já tiver saído da lista (passo pós-deploy), volta:
-- sem isso, o rollback deixaria o banco recusando o recálculo do código que ele restaura.
do $c$ begin
  if to_regclass('public.canonical_contract') is not null then
    update public.canonical_contract
       set scoring_contracts = array_remove(scoring_contracts, 's9-fantasy-b-edicao-v1')
             || case when 's9-fantasy-b-v1' = any (scoring_contracts) then '{}'::text[] else array['s9-fantasy-b-v1'] end,
           updated_at = now()
     where id = 1 and 's9-fantasy-b-edicao-v1' = any (scoring_contracts);
  end if;
end $c$;

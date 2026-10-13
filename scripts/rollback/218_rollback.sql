-- Rollback da 218: devolve `canonical_contract.scoring_contracts` a EXATAMENTE
-- {s9-fantasy-b-v1, s9-fantasy-b-edicao-v1, s9-fantasy-b-edicao-v2} — o estado depois da 217.
--
-- Não toca `enforce`, as versões de prompt nem nenhuma linha de score: só reabre a lista para que um
-- código que grava `s9-fantasy-b-edicao-v1` (Fly v48 e anteriores ao #562) ou `s9-fantasy-b-v1`
-- (checkouts anteriores à fase 2) volte a ter o recálculo aceito.
--
-- 🔴 QUANDO RODAR: ANTES de voltar o APP para a v48 ou anterior. Com `enforce` ligado, voltar o código
-- sem este rollback faz todo recálculo daquele código ser RECUSADO. A ordem é: rollback 218 → deploy do
-- código anterior → (recálculo, se for o caso).
--
-- ⚠️ Rodá-lo sem voltar o código não quebra nada — só reabre a porta para checkouts antigos gravarem
-- a Nota Prevista (o motivo da 218 existir). Já devolvida a lista ⇒ não faz nada (idempotente).
-- Qualquer outro estado ⇒ ABORTA.

set lock_timeout = '5s';

do $rb$
declare
  c record;
  trocadas int;
begin
  select * into c from public.canonical_contract where id = 1 for update;
  if not found then
    raise exception 'rollback 218: canonical_contract sem a linha 1 — abortando';
  end if;

  if cardinality(c.scoring_contracts) = 3
     and (select array_agg(x order by x) from unnest(c.scoring_contracts) x)
         = '{s9-fantasy-b-edicao-v1,s9-fantasy-b-edicao-v2,s9-fantasy-b-v1}'::text[] then
    raise notice 'rollback 218: a lista já é {s9-fantasy-b-v1,s9-fantasy-b-edicao-v1,s9-fantasy-b-edicao-v2} — nada a fazer';
    return;
  end if;

  if c.scoring_contracts is distinct from '{s9-fantasy-b-edicao-v2}'::text[] then
    raise exception 'rollback 218: scoring_contracts (%) não é o estado da 218 {s9-fantasy-b-edicao-v2} — abortando', c.scoring_contracts;
  end if;

  update public.canonical_contract
     set scoring_contracts = array['s9-fantasy-b-v1', 's9-fantasy-b-edicao-v1', 's9-fantasy-b-edicao-v2'], updated_at = now()
   where id = 1 and scoring_contracts = '{s9-fantasy-b-edicao-v2}'::text[];
  get diagnostics trocadas = row_count;
  if trocadas <> 1 then
    raise exception 'rollback 218: a troca atingiu % linha(s), esperava 1 — abortando', trocadas;
  end if;

  select * into c from public.canonical_contract where id = 1;
  raise notice 'rollback 218: scoring_contracts = % · enforce % · prompt % (inalterados)', c.scoring_contracts, c.enforce, c.eval_prompt_versions;
end
$rb$;

-- Rollback da 217: tira `s9-fantasy-b-edicao-v2` de `canonical_contract.scoring_contracts`, voltando a
-- `{s9-fantasy-b-v1, s9-fantasy-b-edicao-v1}`.
--
-- 🔴 Só é seguro ANTES do deploy do código v2. Depois dele, com `enforce` ligado, o recálculo de
-- produção (que grava `edicao-v2`) passaria a ser RECUSADO. Por isso o rollback se recusa quando já
-- existe linha de scoring gravada com a v2 — nesse caso, o caminho é reverter o CÓDIGO (voltar a gravar
-- edicao-v1), recalcular, e só então rodar este arquivo.

set lock_timeout = '5s';

do $rb$
declare n int;
begin
  select (select count(*) from public.calculated_scores where scoring_contract = 's9-fantasy-b-edicao-v2')
       + (select count(*) from public.user_calculated_scores where scoring_contract = 's9-fantasy-b-edicao-v2')
    into n;
  if n > 0 then
    raise exception 'rollback 217: % linha(s) de scoring já gravadas com s9-fantasy-b-edicao-v2 — volte o código e recalcule antes', n;
  end if;

  update public.canonical_contract
     set scoring_contracts = array_remove(scoring_contracts, 's9-fantasy-b-edicao-v2'), updated_at = now()
   where id = 1 and 's9-fantasy-b-edicao-v2' = any (scoring_contracts);
end
$rb$;

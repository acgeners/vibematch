-- 218 — RETIRADA dos contratos de scoring antigos: `canonical_contract.scoring_contracts` passa a ser
-- SÓ `s9-fantasy-b-edicao-v2`.
--
-- POR QUE AGORA: é a etapa E da publicação descrita na 217. O código publicado grava só `edicao-v2`
-- (Fly v49, `origin/main @ 31bc894`) e o recálculo global v2 da conta principal já rodou em produção
-- (2026-10-13 03:42Z). Medido em produção depois dele:
--   · calculated_scores: 1.065 linhas `edicao-v2` + 10 sem contrato (históricas); 0 v1; 0 edicao-v1;
--   · user_calculated_scores: 1.065 `edicao-v2` (conta principal) + 887 sem contrato (históricas,
--     inclusive a conta leitora); 0 v1; 0 edicao-v1.
-- Enquanto `s9-fantasy-b-v1` e `s9-fantasy-b-edicao-v1` estiverem na lista, um checkout ANTIGO
-- (ex.: `1a2e6a8`, que passa na guarda de código do recálculo e grava `s9-fantasy-b-v1`) ainda
-- consegue regravar a Nota Prevista do catálogo. Só o banco recusando fecha essa porta — é o mesmo
-- incidente que motivou a 202.
--
-- O QUE FAZ: só troca a lista de `canonical_contract.scoring_contracts`. NÃO toca `enforce`, as
-- versões de prompt nem nenhuma linha de score.
--
-- O QUE NÃO FAZ: não reescreve o histórico. Linha com `scoring_contract` NULO (anterior à 202) segue
-- como está e continua legível: o gatilho da 202 só olha o contrato quando um resultado de scoring é
-- GRAVADO ou ALTERADO. O código também continua LENDO linha `edicao-v1` como previsão por edição
-- (`EDITION_AWARE_SCORING_CONTRACTS`) — hoje não há nenhuma, e a leitura não reabre a escrita.
--
-- GUARDAS (qualquer uma falha ⇒ ABORTA, nada muda):
--   1. `enforce` ligado;
--   2. versões de prompt exatamente {v32};
--   3. lista de contratos exatamente {s9-fantasy-b-v1, s9-fantasy-b-edicao-v1, s9-fantasy-b-edicao-v2};
--   4. nenhuma linha de `calculated_scores`/`user_calculated_scores` gravada com v1 ou edicao-v1;
--   5. `edicao-v2` em uso: há linha de `calculated_scores` gravada com ele (o recálculo v2 rodou);
--   6. nenhuma linha de score com OUTRO contrato não nulo (fora `edicao-v2`).
-- Já aplicada (lista = {edicao-v2}) ⇒ não faz nada (idempotente).
--
-- CONCORRÊNCIA: as duas tabelas de score ficam em modo SHARE durante a checagem e a troca — um writer
-- antigo não consegue gravar v1 ENTRE a guarda 4 e o COMMIT. Writers esperam (milissegundos) e, depois
-- do COMMIT, são julgados pela lista nova. ⚠️ Ensaiar/aplicar em READ COMMITTED (o padrão): numa
-- transação REPEATABLE READ a foto é tirada no primeiro comando, e uma linha gravada entre essa foto e o
-- LOCK não seria vista pela guarda 4.
--
-- ROLLBACK: `scripts/rollback/218_rollback.sql` devolve a lista {v1, edicao-v1, edicao-v2}.
-- 🔴 CONSEQUÊNCIA OPERACIONAL: depois desta migration, voltar o APP para a Fly v48 ou anterior (código
-- que grava `edicao-v1` ou `v1`) exige rodar o rollback 218 ANTES — senão, com `enforce` ligado, todo
-- recálculo daquele código é recusado.
--
-- ORDEM SEGURA DE APLICAÇÃO EM PRODUÇÃO: usar o app normalmente na v49 → conferir (leitura) que nenhuma
-- gravação nova saiu com v1/edicao-v1 → backup → ensaio desta migration com ROLLBACK em produção →
-- aplicação definitiva.

set lock_timeout = '5s';

do $c$
declare
  c record;
  antigas int;
  outras int;
  v2_calc int;
  v2_ucalc int;
  trocadas int;
begin
  if to_regclass('public.canonical_contract') is null then
    raise exception 'mig 218: canonical_contract não existe (migration 202 ausente) — abortando';
  end if;
  select * into c from public.canonical_contract where id = 1 for update;
  if not found then
    raise exception 'mig 218: canonical_contract sem a linha 1 — abortando';
  end if;

  if c.scoring_contracts = '{s9-fantasy-b-edicao-v2}'::text[] then
    raise notice 'mig 218: já aplicada (scoring_contracts = %) — nada a fazer', c.scoring_contracts;
    return;
  end if;

  -- Dentro do bloco: vale também quando a migration roda em autocommit (o DO é a própria transação).
  lock table public.calculated_scores, public.user_calculated_scores in share mode;

  -- 1. enforce
  if c.enforce is distinct from true then
    raise exception 'mig 218: enforce não está ligado (%) — abortando: esta migration só faz sentido com o banco impondo o contrato', c.enforce;
  end if;
  -- 2. prompt
  if c.eval_prompt_versions is distinct from '{v32}'::text[] then
    raise exception 'mig 218: versões de prompt (%) não são as esperadas {v32} — abortando', c.eval_prompt_versions;
  end if;
  -- 3. a lista de antes, exata (como CONJUNTO, sem repetição)
  if cardinality(c.scoring_contracts) <> 3
     or (select array_agg(x order by x) from unnest(c.scoring_contracts) x)
        is distinct from '{s9-fantasy-b-edicao-v1,s9-fantasy-b-edicao-v2,s9-fantasy-b-v1}'::text[] then
    raise exception 'mig 218: canonical_contract.scoring_contracts (%) não é o esperado {s9-fantasy-b-v1,s9-fantasy-b-edicao-v1,s9-fantasy-b-edicao-v2} — abortando',
      c.scoring_contracts;
  end if;

  -- 4. nenhuma linha gravada com os contratos que saem
  select (select count(*) from public.calculated_scores where scoring_contract in ('s9-fantasy-b-v1', 's9-fantasy-b-edicao-v1'))
       + (select count(*) from public.user_calculated_scores where scoring_contract in ('s9-fantasy-b-v1', 's9-fantasy-b-edicao-v1'))
    into antigas;
  if antigas > 0 then
    raise exception 'mig 218: % linha(s) de score ainda gravadas com s9-fantasy-b-v1/s9-fantasy-b-edicao-v1 — abortando: recalcule com o código v2 antes', antigas;
  end if;

  -- 5. a v2 está em uso
  select count(*) into v2_calc from public.calculated_scores where scoring_contract = 's9-fantasy-b-edicao-v2';
  select count(*) into v2_ucalc from public.user_calculated_scores where scoring_contract = 's9-fantasy-b-edicao-v2';
  if v2_calc = 0 then
    raise exception 'mig 218: nenhuma linha de calculated_scores gravada com s9-fantasy-b-edicao-v2 — abortando: o recálculo v2 não rodou';
  end if;

  -- 6. nenhum contrato inesperado nas linhas (NULO = histórico, permitido)
  select (select count(*) from public.calculated_scores where scoring_contract is not null and scoring_contract <> 's9-fantasy-b-edicao-v2')
       + (select count(*) from public.user_calculated_scores where scoring_contract is not null and scoring_contract <> 's9-fantasy-b-edicao-v2')
    into outras;
  if outras > 0 then
    raise exception 'mig 218: % linha(s) de score com contrato inesperado (nem edicao-v2 nem nulo) — abortando', outras;
  end if;

  update public.canonical_contract
     set scoring_contracts = array['s9-fantasy-b-edicao-v2'], updated_at = now()
   where id = 1 and scoring_contracts = c.scoring_contracts;
  get diagnostics trocadas = row_count;
  if trocadas <> 1 then
    raise exception 'mig 218: a troca da lista atingiu % linha(s), esperava 1 — abortando', trocadas;
  end if;

  select * into c from public.canonical_contract where id = 1;
  if c.scoring_contracts is distinct from '{s9-fantasy-b-edicao-v2}'::text[]
     or c.enforce is distinct from true
     or c.eval_prompt_versions is distinct from '{v32}'::text[] then
    raise exception 'mig 218: estado final inesperado (contratos %, enforce %, prompt %) — abortando',
      c.scoring_contracts, c.enforce, c.eval_prompt_versions;
  end if;

  raise notice 'mig 218: scoring_contracts = {s9-fantasy-b-edicao-v2} · linhas v2: % em calculated_scores, % em user_calculated_scores · históricas sem contrato preservadas',
    v2_calc, v2_ucalc;
end
$c$;

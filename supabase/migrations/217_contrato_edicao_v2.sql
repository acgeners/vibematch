-- 217 — PREPARAÇÃO do contrato de scoring `s9-fantasy-b-edicao-v2`
--
-- O QUE MUDOU NO SCORING: desde a mig 216 o TREINO usa, para o rótulo de uma obra mixed, o
-- `adult_content` da VERSÃO LIDA (`user_work_state.read_edition`), e não mais o legado misturado. O
-- mesmo dado de entrada passa a produzir outro modelo ⇒ outro nome de contrato
-- (`lib/calculations/scoring-contract.ts`).
--
-- O QUE ESTA MIGRATION FAZ: só ACRESCENTA `s9-fantasy-b-edicao-v2` a
-- `canonical_contract.scoring_contracts`. Não retira nenhum contrato, não toca `enforce` nem as versões
-- de prompt. É a etapa A da publicação:
--   A. esta migration (o banco passa a aceitar a v2; a v1 publicada continua aceita);
--   B. deploy do código que grava `edicao-v2`;
--   C. recálculo (dona global + cada conta per-user);
--   D. conferência: as linhas ATIVAS de scoring estão em `edicao-v2`;
--   E. migration SEPARADA retirando `s9-fantasy-b-v1` e `s9-fantasy-b-edicao-v1`.
-- Aceitar a v2 e recusar as antigas na MESMA migration abriria uma janela em que o código ainda
-- publicado (edicao-v1) teria o recálculo recusado — com `enforce` ligado, como está em produção.
--
-- GUARDA: só aplica sobre o estado esperado (`{s9-fantasy-b-v1, s9-fantasy-b-edicao-v1}`). Já com a
-- v2 na lista, não faz nada (idempotente). Qualquer outro estado ABORTA.
--
-- ROLLBACK: `scripts/rollback/217_rollback.sql` (só antes de existir linha gravada com a v2).

set lock_timeout = '5s';

do $c$
begin
  if to_regclass('public.canonical_contract') is null then
    raise exception 'mig 217: canonical_contract não existe (migration 202 ausente) — abortando';
  end if;

  update public.canonical_contract
     set scoring_contracts = array['s9-fantasy-b-v1', 's9-fantasy-b-edicao-v1', 's9-fantasy-b-edicao-v2'], updated_at = now()
   where id = 1 and scoring_contracts = '{s9-fantasy-b-v1,s9-fantasy-b-edicao-v1}'::text[];

  if not exists (
    select 1 from public.canonical_contract
     where id = 1 and scoring_contracts @> '{s9-fantasy-b-v1,s9-fantasy-b-edicao-v1,s9-fantasy-b-edicao-v2}'::text[]
       and cardinality(scoring_contracts) = 3
  ) then
    raise exception 'mig 217: canonical_contract.scoring_contracts (%) não é o esperado {s9-fantasy-b-v1,s9-fantasy-b-edicao-v1} — abortando',
      (select scoring_contracts from public.canonical_contract where id = 1);
  end if;
end
$c$;


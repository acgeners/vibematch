-- 202 — CONTRATO CANÔNICO no banco: quem pode gravar avaliação de IA e resultado de scoring.
--
-- 🔴 O INCIDENTE (02–03/10/2026, e antes dele 26–27/09). Um `next dev` local numa branch 16 commits
-- atrás do `main` gravou na NUVEM avaliações com `prompt_version = 'v31'` (versão que nunca existiu
-- no `main`) e rodou recalcs que regravaram a Nota Prevista do catálogo inteiro SEM a Strategy B de
-- `fantasy`. As guardas que existiam moravam todas no CÓDIGO LOCAL — e um checkout mais antigo que a
-- guarda simplesmente não a tem. Só o banco alcança um writer que não sabe que a regra existe.
--
-- O QUE FAZ:
--   · `canonical_contract` (1 linha): versões de prompt e contratos de scoring PERMITIDOS + `enforce`.
--   · `scoring_contract` em `calculated_scores` e `user_calculated_scores`, SEM default: o writer
--     declara com que contrato calculou. Writer antigo não conhece a coluna ⇒ chega NULL.
--   · trigger em `ai_evaluations`: recusa GRAVAR/ALTERAR `prompt_version` para fora da lista.
--   · trigger nas duas tabelas de score: recusa resultado de scoring sem contrato permitido.
--
-- INERTE: nasce com `enforce = false` — nada é bloqueado até alguém ligar, na nuvem, DEPOIS do deploy
-- do código que envia `scoring_contract` (senão o recalc de produção para). O `db:pull` desliga o
-- `enforce` na cópia local (`scripts/db-pull-to-local.mjs`).
--
-- O QUE NÃO FAZ: não toca nenhuma linha existente. Histórico (inclusive as avaliações v31) fica como
-- está — o trigger de avaliação só olha `prompt_version` quando ele é GRAVADO ou ALTERADO.
--
-- 🔴 POR QUE `BEFORE INSERT` BASTA CONTRA O WRITER ANTIGO (medido no PostgREST real, 2026-10-03).
-- O recalc grava por `upsert(onConflict)` = `INSERT … ON CONFLICT DO UPDATE SET <só as colunas
-- enviadas>`. Uma coluna OMITIDA herdaria o valor antigo no UPDATE — mas o Postgres dispara o
-- `BEFORE INSERT` sobre a linha PROPOSTA antes de detectar o conflito, e a proposta do writer antigo
-- tem `scoring_contract` NULL. A variante "copiar para outra coluna e zerar a de entrada" foi testada
-- e QUEBRA o writer novo (o zerar no BEFORE INSERT contamina o EXCLUDED) — não reintroduzir.
--
-- UPDATE PURO das colunas de scoring (que nenhum writer do histórico faz) também é recusado: o
-- `BEFORE INSERT` validado deixa uma marca de transação com a chave da linha, e o `BEFORE UPDATE` só
-- aceita mudança de scoring que venha dessa proposta (o caminho do ON CONFLICT). Scoring se grava
-- por upsert, com contrato — nunca por UPDATE solto.
--
-- MANUTENÇÃO: trocar `PROMPT_VERSION` (lib/ai-evaluation/service.ts) ou `SCORING_CONTRACT`
-- (lib/calculations/scoring-contract.ts) exige migration que atualize esta linha no MESMO PR —
-- `tests/unit/orchestration/contrato-canonico-pin.test.ts` reprova a divergência. Durante a janela
-- entre migration e deploy, as listas carregam os DOIS valores.
--
-- REVERTER: drop dos 2 triggers e das 2 funções, `drop table public.canonical_contract`, e
-- `alter table … drop column scoring_contract` nas duas tabelas (nada mais depende delas).

create table if not exists public.canonical_contract (
  id smallint primary key default 1,
  eval_prompt_versions text[] not null,
  scoring_contracts text[] not null,
  enforce boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint canonical_contract_linha_unica check (id = 1),
  constraint canonical_contract_listas_nao_vazias
    check (cardinality(eval_prompt_versions) > 0 and cardinality(scoring_contracts) > 0)
);

insert into public.canonical_contract (id, eval_prompt_versions, scoring_contracts, enforce)
values (1, array['v32'], array['s9-fantasy-b-v1'], false)
on conflict (id) do nothing;

-- Só a service role lê/escreve (RLS ligada, nenhuma policy). Os triggers são SECURITY DEFINER.
alter table public.canonical_contract enable row level security;

alter table public.calculated_scores add column if not exists scoring_contract text;
alter table public.user_calculated_scores add column if not exists scoring_contract text;

comment on column public.calculated_scores.scoring_contract is
  'Contrato de scoring com que a linha foi calculada (ver canonical_contract / migration 202). NULL = linha anterior ao contrato.';
comment on column public.user_calculated_scores.scoring_contract is
  'Contrato de scoring com que a linha foi calculada (ver canonical_contract / migration 202). NULL = linha anterior ao contrato.';

-- ── avaliação ──────────────────────────────────────────────────────────────────────────────

create or replace function public.guard_ai_evaluation_prompt_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  -- Só GRAVAR/ALTERAR a versão é decisão nova. Linha em `processing` (versão NULL) e update de
  -- status/summary de avaliação histórica passam: o histórico não é revalidado retroativamente.
  if new.prompt_version is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.prompt_version is not distinct from old.prompt_version then
    return new;
  end if;

  select enforce, eval_prompt_versions into c from public.canonical_contract where id = 1;
  if not found or not c.enforce or new.prompt_version = any (c.eval_prompt_versions) then
    return new;
  end if;

  raise exception using
    errcode = 'P0001',
    message = format(
      'avaliação RECUSADA pelo contrato canônico: prompt_version %s não está entre as permitidas (%s).',
      new.prompt_version, array_to_string(c.eval_prompt_versions, ', ')),
    hint = 'O checkout que gravou isto não roda o producer canônico. Atualize-o (git fetch + origin/main) — ver migration 202.';
end;
$$;

drop trigger if exists trg_guard_ai_evaluation_prompt_version on public.ai_evaluations;
create trigger trg_guard_ai_evaluation_prompt_version
  before insert or update on public.ai_evaluations
  for each row execute function public.guard_ai_evaluation_prompt_version();

-- ── scoring ────────────────────────────────────────────────────────────────────────────────

create or replace function public.guard_scoring_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  -- Resultados que só o recalc produz. FORA de propósito: `confidence` (vem de ai_evaluations via
  -- refresh_calculated_scores_confidence), `alignment_*` (Veredito), `art_*` (Arte, fora do
  -- scoring), `platform_avg`/`total_votes` (eco de entrada), `formula_version`/`calculated_at`.
  -- Coluna ausente numa das tabelas compara NULL com NULL e não dispara.
  colunas constant text[] := array[
    'ia_eval', 'ia_eval_normalized', 'chapters_normalized', 'calc_score', 'mae_calc', 'rmse_calc',
    'expected_score', 'expected_baseline', 'expected_quality_adj', 'expected_is_stub',
    'personal_fit', 'personal_fit_percentile', 'tag_overlap_net', 'chance_score', 'chance_is_stub'
  ];
  novo jsonb := to_jsonb(new);
  velho jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  com_default text[];
  chave text;
begin
  select enforce, scoring_contracts into c from public.canonical_contract where id = 1;
  if not found or not c.enforce then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- Dispara se a linha proposta TROUXER algum resultado. Coluna com DEFAULT não conta: a proposta
    -- do upsert do Veredito (só `alignment_*`) chega com o default de `mae_calc` / `*_is_stub`
    -- preenchido sem que ninguém tenha calculado nada. Lido do catálogo, não de uma lista à mão —
    -- um default novo amanhã entra sozinho.
    select coalesce(array_agg(a.attname::text), '{}') into com_default
    from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = tg_relid and a.attname = any (colunas);
    if not exists (
      select 1 from unnest(colunas) as k where not (k = any (com_default)) and (novo ->> k) is not null
    ) then
      return new;
    end if;
  elsif not exists (
    -- UPDATE: dispara se algum resultado MUDAR.
    select 1 from unnest(colunas) as k where (novo ->> k) is distinct from (velho ->> k)
  ) then
    return new;
  end if;

  if new.scoring_contract is null or not (new.scoring_contract = any (c.scoring_contracts)) then
    raise exception using
      errcode = 'P0001',
      message = format(
        'scoring RECUSADO pelo contrato canônico em %s: scoring_contract %s não está entre os permitidos (%s).',
        tg_table_name, coalesce(new.scoring_contract, '<ausente>'), array_to_string(c.scoring_contracts, ', ')),
      hint = 'O checkout que gravou isto não roda o scoring canônico (ou é anterior ao contrato). Atualize-o — ver migration 202.';
  end if;

  chave := tg_table_name || ':' || coalesce(novo ->> 'user_id', '') || ':' || coalesce(novo ->> 'work_id', '');

  if tg_op = 'INSERT' then
    -- Proposta validada: se houver conflito, o BEFORE UPDATE desta MESMA linha vem a seguir.
    perform set_config('app.scoring_contract_row', chave, true);
    return new;
  end if;

  if current_setting('app.scoring_contract_row', true) is distinct from chave then
    raise exception using
      errcode = 'P0001',
      message = format(
        'scoring RECUSADO pelo contrato canônico em %s: UPDATE direto de colunas de scoring. O resultado do recalc se grava por upsert com scoring_contract.',
        tg_table_name),
      hint = 'Ver migration 202.';
  end if;
  perform set_config('app.scoring_contract_row', '', true);
  return new;
end;
$$;

-- A marca só vale dentro do statement que a criou: se a proposta virou INSERT de fato (sem conflito),
-- ela é limpa no fim do statement e não pode autorizar um UPDATE posterior na mesma transação.
create or replace function public.clear_scoring_contract_mark()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.scoring_contract_row', '', true);
  return null;
end;
$$;

drop trigger if exists trg_guard_scoring_contract on public.calculated_scores;
create trigger trg_guard_scoring_contract
  before insert or update on public.calculated_scores
  for each row execute function public.guard_scoring_contract();

drop trigger if exists trg_clear_scoring_contract_mark on public.calculated_scores;
create trigger trg_clear_scoring_contract_mark
  after insert on public.calculated_scores
  for each statement execute function public.clear_scoring_contract_mark();

drop trigger if exists trg_guard_scoring_contract on public.user_calculated_scores;
create trigger trg_guard_scoring_contract
  before insert or update on public.user_calculated_scores
  for each row execute function public.guard_scoring_contract();

drop trigger if exists trg_clear_scoring_contract_mark on public.user_calculated_scores;
create trigger trg_clear_scoring_contract_mark
  after insert on public.user_calculated_scores
  for each statement execute function public.clear_scoring_contract_mark();

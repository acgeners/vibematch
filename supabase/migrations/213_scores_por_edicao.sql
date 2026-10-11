-- 213 — Scores por EDIÇÃO das obras `mixed` (fase 2): a estrutura, sem dado
--
-- 🔴 NÃO APLICADA. Ordem de publicação: 213 + 214 → deploy → recálculo na nuvem → 215 → tirar o contrato
-- `s9-fantasy-b-v1` da lista (ver o fim deste cabeçalho).
--
-- O PROBLEMA: desde a fase 1 (204/205) uma obra `mixed` é UMA obra com DUAS edições — a normal (R15)
-- e a R18 —, mas `category_scores` guarda UM `adult_content` por obra. Nas 140 `mixed` esse número é
-- uma mistura: 82 descrevem a R18 (nota ≥ 9, que a R15 não pode ter), 1 descreve a normal e o resto
-- mistura as duas (auditoria de 2026-10-10, `Auditoria/edicoes-mixed-fase2-medicao-2026-10-10`).
--
-- O QUE ESTA MIGRATION FAZ (estrutura — nenhuma nota muda, nenhuma obra muda de gate):
--   1. `work_edition_scores` — tabela LATERAL: a nota de um critério para UMA edição de uma obra
--      `mixed`. Hoje só `adult_content` (CHECK). NÃO é coluna `edition` em `category_scores`: lá a
--      nota legada continua intacta, para histórico e para todo leitor que não conhece edição.
--      · `score` NULL ⇔ `source = 'not_rated'`: a AUSÊNCIA é explícita, nunca herdada da outra edição.
--      · `source` diz de ONDE veio o número, e tem FORÇA (`work_edition_score_strength`):
--          not_rated 0 < inferred_base 1 < reused_existing = ai_evaluated 2 < curator_confirmed 3.
--        Um gatilho recusa REBAIXAR (trocar um número mais forte por um mais fraco). O baseline
--        provisório (`inferred_base`, 5,0) pode ser substituído por qualquer outra fonte; o contrário
--        exige `set local app.permitir_rebaixar_edicao = 'on'` (correção explícita).
--        ⚠️ Não há fonte "derivada por regra": a existência da R18, e o piso de tag explícita sozinho,
--        não viram nota de edição (decisão de 2026-10-11 — uma R18 sem nota sustentada fica `not_rated`).
--      · `status` é derivado de `source` e travado por CHECK: inferred_base ⇒ `provisional`,
--        not_rated ⇒ `not_rated`, o resto ⇒ `rated`. É o que impede o 5,0 provisório de se passar por
--        avaliação; e o baseline é sempre `confidence = 'baixa'` (CHECK).
--      · Só aceita obra cujo estado de edição é `mixed` (gatilho).
--   2. `user_settings.preferred_mixed_edition` (`normal` | `r18` | NULL) — a preferência da conta.
--      Ocultar 18+ vence a preferência (a edição normal é forçada); quem decide é o código.
--   3. Previsão POR EDIÇÃO em `calculated_scores` e `user_calculated_scores`:
--      · `expected_edition` — a edição com que as colunas de sempre (`expected_*`, `chance_*`) da obra
--        `mixed` foram calculadas: a edição PADRÃO de quem recebe a nota. NULL em obra não-mixed.
--      · `expected_by_edition` (jsonb) — as DUAS previsões da obra `mixed`:
--          {"normal": {expected_score, expected_baseline, expected_quality_adj, expected_is_stub,
--                      chance_score, chance_is_stub}, "r18": {…}}
--        Quem conhece a edição ativa (página, listas) lê daqui; quem não conhece lê as colunas de sempre.
--        Edição sem nota de `adult_content` ⇒ `expected_score` null nela ("não avaliado"), nunca a outra.
--      ⚠️ Só vale linha gravada com o contrato `s9-fantasy-b-edicao-v1`: um checkout anterior a esta
--      fase grava a previsão sobre a nota MISTURADA e não toca estas duas colunas. Quem lê confere o
--      `scoring_contract` da linha (`lib/editions/mixed-edition.ts`) — é isso que fecha a janela entre
--      a migration e o deploy, quando os dois contratos são aceitos.
--   4. `canonical_contract.scoring_contracts` passa a aceitar `s9-fantasy-b-edicao-v1` ALÉM de
--      `s9-fantasy-b-v1`, durante a janela migration × deploy. Tirar o v1 da lista é passo seguinte,
--      depois do deploy.
--
-- O QUE NÃO FAZ: não toca `category_scores`, `works`, overrides, gate, tags, `work_edition_state`.
-- Os dados das 140 vêm na 214; os overrides na 215.
--
-- ORDEM: 213 e 214 ANTES do deploy (a nuvem tem `enforce = true`: código novo sem a 213 tem o
-- recálculo recusado — falha alto). Depois do deploy, o recálculo na nuvem grava a previsão por edição.
-- 215 só DEPOIS do deploy e do recálculo (ela torna 5 obras visíveis a quem oculta 18+, e só o código
-- novo esconde delas o que é da R18).
--
-- IDEMPOTENTE. ROLLBACK: `scripts/rollback/213_rollback.sql` (recusa com dado da 214 presente).
-- Conferida por `npm run test:db-edicao-fase2` (Postgres local, transações desfeitas).

set lock_timeout = '5s';

-- ── 0) Guardas de ENTRADA ────────────────────────────────────────────────────────────────────
do $guarda$
begin
  if to_regclass('public.work_edition_state') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'works' and column_name = 'edition_state') then
    raise exception 'mig 213: a 204 (estado de edição) não está aplicada — abortando';
  end if;
  -- A régua de tags por edição lê as flags da 210 (`enrichment_status` é a marca dela).
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tags' and column_name = 'enrichment_status') then
    raise exception 'mig 213: a 210 (tags adultas) não está aplicada — abortando';
  end if;
  if not exists (select 1 from public.criteria where slug = 'adult_content') then
    raise exception 'mig 213: critério adult_content ausente — abortando';
  end if;
end
$guarda$;

-- ── 1) A tabela lateral ──────────────────────────────────────────────────────────────────────
create table if not exists public.work_edition_scores (
  work_id          uuid not null references public.works(id) on delete cascade,
  edition          text not null,
  criterion_slug   text not null references public.criteria(slug) on update cascade on delete restrict,
  score            numeric(3,1),
  source           text not null,
  status           text not null,
  confidence       text,
  -- Procedência quando a nota É de uma avaliação (`reused_existing`, `ai_evaluated`).
  ai_evaluation_id uuid references public.ai_evaluations(id) on delete set null,
  evidence         jsonb not null default '{}'::jsonb,
  decided_by       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (work_id, edition, criterion_slug),
  constraint work_edition_scores_edition check (edition in ('normal', 'r18')),
  -- Nesta fase só a nota de conteúdo adulto diverge por edição. Generalizar é decisão futura.
  constraint work_edition_scores_criterio check (criterion_slug = 'adult_content'),
  constraint work_edition_scores_range check (score is null or (score >= 0 and score <= 10)),
  constraint work_edition_scores_source check (
    source in ('not_rated', 'inferred_base', 'reused_existing', 'ai_evaluated', 'curator_confirmed')),
  constraint work_edition_scores_ausencia_explicita check ((score is null) = (source = 'not_rated')),
  constraint work_edition_scores_status check (
    status = case source when 'not_rated' then 'not_rated' when 'inferred_base' then 'provisional' else 'rated' end),
  constraint work_edition_scores_confidence check (confidence is null or confidence in ('alta', 'media', 'baixa')),
  -- O baseline é, por definição, de baixa confiança — o CHECK impede que vire "média" por engano.
  constraint work_edition_scores_baseline_baixa check (source <> 'inferred_base' or confidence = 'baixa'),
  constraint work_edition_scores_decided_by check (decided_by in ('audit', 'curator', 'ai'))
);

comment on table public.work_edition_scores is
  'Nota de um critério por EDIÇÃO de uma obra mixed (hoje só adult_content). score NULL = não avaliado '
  'nesta edição (nunca herda da outra). source tem força: not_rated < inferred_base < '
  'reused_existing = ai_evaluated < curator_confirmed. Migration 213.';
comment on column public.work_edition_scores.source is
  'De onde veio o número. inferred_base = baseline 5,0 PROVISÓRIO da edição normal (não é avaliação); '
  'reused_existing = a nota legada de category_scores atribuída a esta edição pela auditoria; '
  'ai_evaluated = avaliação feita para esta edição; curator_confirmed = curadoria humana.';

-- Só a service role lê/escreve (catálogo): RLS ligada, nenhuma policy.
alter table public.work_edition_scores enable row level security;

create or replace function public.work_edition_score_strength(p_source text)
returns smallint
language sql
immutable
as $$
  select case p_source
    when 'not_rated' then 0 when 'inferred_base' then 1
    when 'reused_existing' then 2 when 'ai_evaluated' then 2 when 'curator_confirmed' then 3
  end::smallint
$$;

create or replace function public.trg_work_edition_scores_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_state text;
begin
  select edition_state into v_state from public.works where id = new.work_id;
  if v_state is distinct from 'mixed' then
    raise exception 'work_edition_scores: a obra % não é mixed (estado %) — nota por edição só existe em obra mixed',
      new.work_id, coalesce(v_state, '<sem estado>');
  end if;
  if tg_op = 'UPDATE'
     and public.work_edition_score_strength(new.source) < public.work_edition_score_strength(old.source)
     and coalesce(current_setting('app.permitir_rebaixar_edicao', true), '') <> 'on' then
    raise exception 'work_edition_scores: recusado rebaixar % → % (%/% de %). Use set local app.permitir_rebaixar_edicao = ''on'' numa correção explícita.',
      old.source, new.source, new.edition, new.criterion_slug, new.work_id;
  end if;
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists trg_work_edition_scores_guard on public.work_edition_scores;
create trigger trg_work_edition_scores_guard
  before insert or update on public.work_edition_scores
  for each row execute function public.trg_work_edition_scores_guard();

-- ── 2) Preferência da conta ──────────────────────────────────────────────────────────────────
alter table public.user_settings add column if not exists preferred_mixed_edition text;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'user_settings_preferred_mixed_edition_check') then
    alter table public.user_settings add constraint user_settings_preferred_mixed_edition_check
      check (preferred_mixed_edition is null or preferred_mixed_edition in ('normal', 'r18'));
  end if;
end $c$;
comment on column public.user_settings.preferred_mixed_edition is
  'Edição exibida por padrão nas obras mixed (normal | r18 | NULL = normal). hide_adult_content=true força '
  'normal e vence esta preferência. Migration 213.';

-- ── 3) Previsão por edição ───────────────────────────────────────────────────────────────────
alter table public.calculated_scores add column if not exists expected_edition text;
alter table public.calculated_scores add column if not exists expected_by_edition jsonb;
alter table public.user_calculated_scores add column if not exists expected_edition text;
alter table public.user_calculated_scores add column if not exists expected_by_edition jsonb;

create or replace function public.expected_by_edition_valido(p jsonb)
returns boolean
language sql
immutable
as $$
  -- Só as duas chaves conhecidas, e as duas juntas: previsão de UMA edição só é o estado que esta
  -- coluna existe para evitar (a outra edição ficaria sem número e sem motivo).
  select p is null
      or (jsonb_typeof(p) = 'object'
          and p ?& array['normal', 'r18']
          and (select count(*) from jsonb_object_keys(p)) = 2)
$$;

do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'calculated_scores_expected_edition_check') then
    alter table public.calculated_scores add constraint calculated_scores_expected_edition_check
      check (expected_edition is null or expected_edition in ('normal', 'r18'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_calculated_scores_expected_edition_check') then
    alter table public.user_calculated_scores add constraint user_calculated_scores_expected_edition_check
      check (expected_edition is null or expected_edition in ('normal', 'r18'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'calculated_scores_expected_by_edition_check') then
    alter table public.calculated_scores add constraint calculated_scores_expected_by_edition_check
      check (public.expected_by_edition_valido(expected_by_edition));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_calculated_scores_expected_by_edition_check') then
    alter table public.user_calculated_scores add constraint user_calculated_scores_expected_by_edition_check
      check (public.expected_by_edition_valido(expected_by_edition));
  end if;
end $c$;
comment on column public.calculated_scores.expected_edition is
  'Obra mixed: a edição (padrão de quem recebe a nota) com que expected_*/chance_* desta linha foram calculados. '
  'NULL = obra não-mixed. Só confiável com scoring_contract = s9-fantasy-b-edicao-v1. Migration 213.';
comment on column public.calculated_scores.expected_by_edition is
  'Obra mixed: as previsões das DUAS edições ({normal:{…}, r18:{…}}). NULL = obra não-mixed. '
  'Só confiável com scoring_contract = s9-fantasy-b-edicao-v1. Migration 213.';
comment on column public.user_calculated_scores.expected_edition is
  'Como calculated_scores.expected_edition, por usuário. Migration 213.';
comment on column public.user_calculated_scores.expected_by_edition is
  'Como calculated_scores.expected_by_edition, por usuário. Migration 213.';

-- ── 4) Contrato de scoring: o recálculo por edição é OUTRO contrato ─────────────────────────
-- Só troca a lista que esta fase conhece ({s9-fantasy-b-v1}); qualquer outra aborta, em vez de
-- sobrescrever um contrato que alguém tenha posto depois.
do $c$ begin
  if to_regclass('public.canonical_contract') is not null then
    update public.canonical_contract
       set scoring_contracts = array['s9-fantasy-b-v1', 's9-fantasy-b-edicao-v1'], updated_at = now()
     where id = 1 and scoring_contracts = '{s9-fantasy-b-v1}'::text[];
    if exists (select 1 from public.canonical_contract where id = 1 and not ('s9-fantasy-b-edicao-v1' = any (scoring_contracts))) then
      raise exception 'mig 213: canonical_contract (%) não é o esperado {s9-fantasy-b-v1} — abortando',
        (select scoring_contracts from public.canonical_contract where id = 1);
    end if;
  end if;
end $c$;

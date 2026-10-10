-- 204 — Estado de EDIÇÃO da obra: uma fonte autoritativa, com procedência (fase 1 de `mixed`)
--
-- 🔴 O QUE ESTAVA ERRADO (auditoria de 2026-10-10, `Auditoria/edicoes-mixed-r19-mu-2026-10-10`):
-- desde a 199, `works.r19_edition` liga sozinho a partir de QUALQUER tag com `marks_r19_edition` —
-- e essa tag nasce de um marcador de sinopse, de um alias de censura ou de um alias de categoria do
-- MangaUpdates. Ou seja, `r19_edition` significava "encontrei um marcador R19", não "esta obra tem
-- uma edição normal E uma R18". Das 206 obras com ele: 140 `mixed`, 35 R18-only, 28 com o R19 de
-- outro contexto (novel, outra obra, enredo) e 3 indeterminadas.
--
-- O QUE ESTA MIGRATION FAZ (estrutura — NÃO muda o gate de nenhuma obra de hoje):
--   1. `work_edition_state` — UMA linha por obra que tem algum sinal de edição: o ESTADO editorial
--      (`single | mixed | r18_only | unknown`), a BASE da decisão, QUEM decidiu e a EVIDÊNCIA (jsonb).
--      Responde "quantas/que versões editoriais existem?". O gate deriva dele (item 5), mas não se
--      confunde com ele — uma obra `single` pode ser R18 pelo gate normal. Sem linha = sem sinal de edição.
--   2. `works.edition_state` (espelho) e `works.r19_edition` (ponte de compatibilidade) passam a ser
--      DERIVADOS do estado por gatilho — e um CHECK impede os dois de divergirem:
--      `r19_edition = (edition_state = 'mixed')`. Ninguém mais os grava direto.
--   3. A tag "R19 disponível" (a única com `marks_r19_edition`) vira REFLEXO do estado: existe na
--      obra se e só se o estado é `mixed`. Uma guarda em `work_tags` neutraliza qualquer outra escrita
--      dela (formulário, alias, merge de tag): inserir vira, no máximo, um estado `unknown`; apagar de
--      uma obra `mixed` não apaga. É o que impede tag/alias de ligarem `mixed` diretamente.
--   4. O marcador de sinopse (`[R19 disponível]`, linha "R19") deixa de criar a tag: cria, no máximo,
--      um estado `unknown` — e só quando a obra ainda não tem estado. Como `unknown` liga o gate (item
--      5), o marcador passa a PROTEGER (ocultar) em vez de liberar, até alguém resolver a edição.
--   5. `is_adult` = COALESCE(override, CASE edition_state WHEN 'mixed' THEN false
--      WHEN 'r18_only' THEN true WHEN 'unknown' THEN true ELSE adult_auto END).
--      · `mixed`: a regra da 199 — a obra não é ocultada inteira (a versão normal pode ser lida);
--      · `r18_only`: liga o gate ESTRUTURALMENTE (hoje as 35 já ligam pelo adult_auto ou override);
--      · `unknown`: liga o gate — "na dúvida, protege": há sinal de R18 e nenhuma versão normal provada;
--      · `single` / sem estado: o gate normal (adult_auto).
--      A decisão humana (`adult_override`) continua vencendo tudo.
--   6. Legado: toda obra com `r19_edition = true` ganha um estado `mixed` com `decided_by = 'legacy'`,
--      que reproduz exatamente o comportamento de hoje. A migration 205 troca esses estados legados
--      pela classificação auditada. Sem a 205, nada muda para as 206.
--
-- O QUE NÃO FAZ: não toca nota (`category_scores`), override, `adult_auto`, aliases, nenhuma tag além
-- da troca do gatilho. O `trg_works_updated_at` reescreve `updated_at` das obras do legado (o espelho
-- `edition_state` é preenchido nelas).
--
-- IDEMPOTENTE. ROLLBACK: `scripts/rollback/204_rollback.sql` (não roda com a 205 aplicada).
-- Conferida por `npm run test:db-edicao-mixed` (Postgres local, transação desfeita no fim).

set lock_timeout = '5s';

-- ── 0) Guardas de ENTRADA ────────────────────────────────────────────────────────────────────
do $guarda$
declare n_flag int; n_r19 int; n_tag int;
begin
  select count(*) into n_flag from public.tags where marks_r19_edition;
  if n_flag <> 1 or not exists (select 1 from public.tags where slug = 'r19-disponivel' and marks_r19_edition) then
    raise exception 'mig 204: esperava UMA tag com marks_r19_edition (r19-disponivel), há % — abortando', n_flag;
  end if;
  -- Na 1ª execução, r19_edition tem de bater com a tag (a regra da 199). Se divergir, alguém gravou
  -- r19_edition à mão ou a 199 não está aplicada — o legado abaixo copiaria um estado que ninguém mediu.
  if to_regclass('public.work_edition_state') is null then
    select count(*) filter (where w.r19_edition is distinct from exists (
             select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id
              where wt.work_id = w.id and t.marks_r19_edition))
      into n_r19 from public.works w;
    if n_r19 > 0 then
      raise exception 'mig 204: % obra(s) com r19_edition divergente da tag R19 disponível — conferir antes; abortando', n_r19;
    end if;
  end if;
end
$guarda$;

-- ── 1) Retrato de ANTES (guardas de saída) ───────────────────────────────────────────────────
drop table if exists pg_temp.mig204_antes;
create temp table mig204_antes on commit drop as
  select id, is_adult, r19_edition, adult_auto, adult_reason, adult_override from public.works;
drop table if exists pg_temp.mig204_tags_antes;
create temp table mig204_tags_antes on commit drop as
  select md5(coalesce(string_agg(concat_ws(':', work_id, tag_id, source), ',' order by work_id, tag_id), '')) h, count(*) n
    from public.work_tags;
drop table if exists pg_temp.mig204_notas_antes;
create temp table mig204_notas_antes on commit drop as
  select md5(coalesce(string_agg(concat_ws(':', work_id, criterion_slug, score), ',' order by work_id, criterion_slug), '')) h
    from public.category_scores;

-- ── 2) A tabela autoritativa ─────────────────────────────────────────────────────────────────
create table if not exists public.work_edition_state (
  work_id uuid primary key references public.works(id) on delete cascade,
  state text not null check (state in ('single', 'mixed', 'r18_only', 'unknown')),
  -- A edição R18 inclui capítulos/side stories/epílogos R19 sobre uma história principal normal.
  -- Só faz sentido em `mixed` (decisão fechada: extras R19 contam como `mixed`).
  r18_extra_chapters boolean not null default false,
  basis text not null check (basis in (
    'mangaupdates_description', 'mangaupdates_category', 'reviews', 'synopsis_text',
    'synopsis_marker', 'edition_tag', 'legacy_r19_edition', 'curator')),
  decided_by text not null check (decided_by in ('audit', 'curator', 'legacy', 'auto')),
  evidence jsonb not null default '{}'::jsonb,
  evidence_fetched_at timestamptz,
  decided_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_edition_state_extras_so_em_mixed check (not r18_extra_chapters or state = 'mixed')
);
comment on table public.work_edition_state is
  'Estado EDITORIAL da obra (mig 204): quantas/que versões existem — single | mixed (normal + R18) | '
  'r18_only | unknown. Fonte autoritativa de works.edition_state / works.r19_edition (gatilho). '
  'No gate: mixed não oculta a obra inteira; r18_only e unknown ligam; single segue o adult_auto. Sem linha = sem sinal de edição.';
comment on column public.work_edition_state.basis is
  'De onde veio a evidência que sustenta o estado (descrição/categoria do MangaUpdates, reviews, texto da sinopse, marcador, tag, legado, curadoria).';
comment on column public.work_edition_state.decided_by is
  'audit/curator/legacy nunca são sobrescritos pela ingestão automática; auto só preenche ausência ou sobe unknown.';
-- Catálogo: só a service role lê/escreve (RLS ligada, nenhuma policy) — como as demais tabelas de catálogo.
alter table public.work_edition_state enable row level security;

create or replace function public.trg_work_edition_state_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_work_edition_state_touch on public.work_edition_state;
create trigger trg_work_edition_state_touch
  before update on public.work_edition_state
  for each row execute function public.trg_work_edition_state_touch();

-- ── 3) O espelho em `works` ──────────────────────────────────────────────────────────────────
alter table public.works add column if not exists edition_state text;
do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'works_edition_state_valores') then
    alter table public.works add constraint works_edition_state_valores
      check (edition_state is null or edition_state in ('single', 'mixed', 'r18_only', 'unknown'));
  end if;
end $c$;
comment on column public.works.edition_state is
  'Espelho de work_edition_state.state (mig 204). Derivado por gatilho — não gravar à mão. NULL = sem sinal de edição.';
comment on column public.works.r19_edition is
  'Ponte de compatibilidade: = (edition_state = ''mixed''), garantido por CHECK (mig 204). Derivado por gatilho — não gravar à mão.';

-- Sincroniza o espelho e a tag de exibição a partir do estado. Única função que grava os dois.
create or replace function public.sync_work_edition_mirror(p_work_id uuid)
returns void language plpgsql as $$
declare
  v_state text;
  v_mixed boolean;
  v_tag uuid;
begin
  select s.state into v_state from public.work_edition_state s where s.work_id = p_work_id;
  v_mixed := v_state is not distinct from 'mixed';

  update public.works w
     set edition_state = v_state, r19_edition = v_mixed
   where w.id = p_work_id
     and (w.edition_state is distinct from v_state or w.r19_edition is distinct from v_mixed);

  select t.id into v_tag from public.tags t where t.slug = 'r19-disponivel' and t.marks_r19_edition;
  if v_tag is null then return; end if;

  perform set_config('app.edition_state_sync', 'on', true);
  if v_mixed then
    insert into public.work_tags (work_id, tag_id, source)
    select p_work_id, v_tag, 'edition_state'
     where exists (select 1 from public.works w where w.id = p_work_id)
    on conflict (work_id, tag_id) do nothing;
  else
    delete from public.work_tags wt
     using public.tags t
     where wt.work_id = p_work_id and wt.tag_id = t.id and t.marks_r19_edition;
  end if;
  perform set_config('app.edition_state_sync', '', true);
end $$;
revoke all on function public.sync_work_edition_mirror(uuid) from public, anon, authenticated;

create or replace function public.trg_work_edition_state_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sync_work_edition_mirror(new.work_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.work_id is distinct from new.work_id) then
    perform public.sync_work_edition_mirror(old.work_id);
  end if;
  return null;
end $$;
drop trigger if exists trg_work_edition_state_sync on public.work_edition_state;
create trigger trg_work_edition_state_sync
  after insert or update or delete on public.work_edition_state
  for each row execute function public.trg_work_edition_state_sync();

-- ── 4) A tag "R19 disponível" vira REFLEXO do estado ─────────────────────────────────────────
-- Fora do sync, ninguém liga nem desliga a tag de edição. Inserir (formulário, alias de categoria,
-- merge de tag) vira no máximo um estado `unknown` — nunca `mixed`. Apagar de obra `mixed` não apaga
-- (o formulário reenvia a lista de tags e apagaria o reflexo).
create or replace function public.trg_work_tags_edition_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_new boolean := false;
  v_old boolean := false;
begin
  if current_setting('app.edition_state_sync', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select t.marks_r19_edition into v_new from public.tags t where t.id = new.tag_id;
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    select t.marks_r19_edition into v_old from public.tags t where t.id = old.tag_id;
  end if;
  if not coalesce(v_new, false) and not coalesce(v_old, false) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    insert into public.work_edition_state (work_id, state, basis, decided_by, evidence)
    select new.work_id, 'unknown', 'edition_tag', 'auto',
           jsonb_build_object('tag_id', new.tag_id, 'tag_source', new.source, 'observed_at', now())
     where exists (select 1 from public.works w where w.id = new.work_id)
    on conflict (work_id) do nothing;
    return null;
  elsif tg_op = 'DELETE' then
    -- Obra sendo apagada (cascade): a linha de `works` já sumiu, deixa passar.
    if exists (select 1 from public.work_edition_state s join public.works w on w.id = s.work_id
                where s.work_id = old.work_id and s.state = 'mixed') then
      return null;
    end if;
    return old;
  end if;
  -- UPDATE: atributo (source/confidence) passa; trocar obra/tag de/para a tag de edição, não.
  if old.work_id = new.work_id and old.tag_id = new.tag_id then
    return new;
  end if;
  return null;
end $$;
drop trigger if exists trg_work_tags_edition_guard on public.work_tags;
create trigger trg_work_tags_edition_guard
  before insert or update or delete on public.work_tags
  for each row execute function public.trg_work_tags_edition_guard();

-- A 199 fazia o caminho inverso (tag → r19_edition). Sai: quem decide agora é o estado.
drop trigger if exists trg_work_tags_r19_edition on public.work_tags;
drop function if exists public.trg_work_tags_r19_edition();
drop function if exists public.sync_work_r19_edition(uuid);

-- ── 5) Marcador de sinopse → no máximo `unknown` ─────────────────────────────────────────────
-- Mesmo regex da 199 (BOILERPLATE_MARKER_RE de lib/ai-evaluation/adult-content-rules.ts).
create or replace function public.trg_work_synopses_r19_marker()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.text ~* '\[R1[89][^]]*\]' or new.text ~* '(^|\n)\s*R\s*-?\s*1[89]\s*(\n|$)' then
    insert into public.work_edition_state (work_id, state, basis, decided_by, evidence)
    select new.work_id, 'unknown', 'synopsis_marker', 'auto',
           jsonb_build_object('synopsis_id', new.id, 'synopsis_source', new.source, 'observed_at', now())
     where exists (select 1 from public.works w where w.id = new.work_id)
    on conflict (work_id) do nothing;
  end if;
  return null;
end $$;

-- ── 6) Legado: o r19_edition de hoje vira estado `mixed` NÃO auditado ────────────────────────
insert into public.work_edition_state (work_id, state, basis, decided_by, evidence)
select w.id, 'mixed', 'legacy_r19_edition', 'legacy',
       jsonb_build_object(
         'nota', 'r19_edition=true herdado da mig 199 (marcador de sinopse ou tag); NÃO auditado. A mig 205 substitui.',
         'tags_de_edicao', (select jsonb_agg(jsonb_build_object('tag', t.slug, 'source', wt.source, 'created_at', wt.created_at)
                              order by wt.created_at)
                              from public.work_tags wt join public.tags t on t.id = wt.tag_id
                             where wt.work_id = w.id and t.marks_r19_edition))
  from public.works w
 where w.r19_edition
on conflict (work_id) do nothing;

do $c$
begin
  if not exists (select 1 from pg_constraint where conname = 'works_r19_edition_espelha_estado') then
    alter table public.works add constraint works_r19_edition_espelha_estado
      check (r19_edition = (edition_state is not distinct from 'mixed'));
  end if;
end $c$;

-- ── 7) is_adult: mixed → a versão normal aparece; r18_only → liga o gate ─────────────────────
alter table public.works alter column is_adult
  set expression as (coalesce(
    adult_override,
    case edition_state when 'mixed' then false when 'r18_only' then true when 'unknown' then true else adult_auto end));
comment on column public.works.is_adult is
  'COALESCE(adult_override, CASE edition_state WHEN mixed THEN false WHEN r18_only THEN true WHEN unknown THEN true ELSE adult_auto END). '
  'Governa OCULTAR conteúdo 18+. "Só 18+" é is_adult OR r19_edition (mixed aparece nos dois). '
  'adult_override é decisão no nível da OBRA INTEIRA: true esconde inclusive a versão normal de uma mixed. Mig 204.';
comment on column public.works.adult_override is
  'Decisão humana no nível da OBRA INTEIRA (todas as edições): true esconde até a versão normal de uma obra mixed; '
  'false mostra. NULL segue o automático. Não usar false para corrigir sinal errado — corrigir a origem. Mig 204.';
comment on column public.tags.marks_r19_edition is
  'A tag de EXIBIÇÃO do estado mixed (mig 204): presente na obra se e só se work_edition_state.state = mixed. '
  'Escritas fora do sync são neutralizadas por trg_work_tags_edition_guard.';

-- ── 8) Guardas de SAÍDA: estrutura nova, comportamento idêntico ──────────────────────────────
do $guarda$
declare n_adult int; n_r19 int; n_outros int; n_estado int; n_legacy int; n_espelho int;
begin
  select count(*) filter (where w.is_adult is distinct from a.is_adult),
         count(*) filter (where w.r19_edition is distinct from a.r19_edition),
         count(*) filter (where (w.adult_auto, w.adult_reason, w.adult_override)
                                is distinct from (a.adult_auto, a.adult_reason, a.adult_override))
    into n_adult, n_r19, n_outros
    from mig204_antes a join public.works w on w.id = a.id;
  if n_adult > 0 or n_r19 > 0 or n_outros > 0 then
    raise exception 'mig 204: mudou o comportamento — is_adult % · r19_edition % · auto/override %', n_adult, n_r19, n_outros;
  end if;

  if (select h from mig204_tags_antes) is distinct from (
       select md5(coalesce(string_agg(concat_ws(':', work_id, tag_id, source), ',' order by work_id, tag_id), ''))
         from public.work_tags) then
    raise exception 'mig 204: work_tags mudou — esta migration só troca gatilhos';
  end if;
  if (select h from mig204_notas_antes) is distinct from (
       select md5(coalesce(string_agg(concat_ws(':', work_id, criterion_slug, score), ',' order by work_id, criterion_slug), ''))
         from public.category_scores) then
    raise exception 'mig 204: category_scores mudou — esta migration não pode tocar nota';
  end if;

  select count(*) into n_estado from public.work_edition_state;
  select count(*) into n_legacy from public.works where r19_edition;
  select count(*) into n_espelho from public.works w
    left join public.work_edition_state s on s.work_id = w.id
   where w.edition_state is distinct from s.state;
  if n_espelho > 0 then raise exception 'mig 204: % obra(s) com espelho edition_state divergente', n_espelho; end if;
  if n_legacy > n_estado then raise exception 'mig 204: % obra(s) mixed sem estado', n_legacy - n_estado; end if;

  raise notice 'mig 204: % estado(s) de edição (% mixed) · is_adult, r19_edition, tags e notas idênticos', n_estado, n_legacy;
end
$guarda$;

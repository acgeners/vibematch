-- Rollback da 204 (estado de edição) — volta ao regime da 199: `r19_edition` derivado da tag
-- "R19 disponível", marcador de sinopse → tag, `is_adult` = COALESCE(override, auto AND NOT r19_edition).
--
-- 🔴 Recusa se a 205 estiver aplicada (há estado `audit`): rode `scripts/rollback/205_rollback.sql` antes.
--
-- O que se perde, e por isso é ARQUIVADO antes em `bkp.mig204_estado_descartado`: todo estado de edição
-- (legado e o que a ingestão gravou enquanto a 204 esteve no ar). O que a 199 teria feito nesse meio
-- tempo é REFEITO: toda sinopse com o marcador volta a dar a tag, e toda tentativa de gravar a tag que
-- a guarda da 204 converteu em `unknown` vira a tag de novo. Assim `r19_edition` fica como a 199 o
-- deixaria hoje — e o rollback avisa quantas obras isso muda em relação ao estado da 204.
-- Ensaio: `npm run test:db-edicao-mixed`.

set lock_timeout = '5s';

do $rb$
declare n int;
begin
  if to_regclass('public.work_edition_state') is null then
    raise exception 'rollback 204: work_edition_state não existe — a 204 não foi aplicada aqui';
  end if;
  if exists (select 1 from public.work_edition_state where decided_by in ('audit', 'curator')) then
    raise exception 'rollback 204: há estado auditado/curado (a 205 ou uma decisão de curadoria está aplicada) — rode o rollback da 205 antes; abortando';
  end if;
  create schema if not exists bkp;
  create table if not exists bkp.mig204_estado_descartado (like public.work_edition_state);
  alter table bkp.mig204_estado_descartado add column if not exists arquivado_em timestamptz default now();
  insert into bkp.mig204_estado_descartado (work_id, state, r18_extra_chapters, basis, decided_by, evidence,
                                           evidence_fetched_at, decided_at, updated_at)
  select work_id, state, r18_extra_chapters, basis, decided_by, evidence, evidence_fetched_at, decided_at, updated_at
    from public.work_edition_state;
  get diagnostics n = row_count;
  raise notice 'rollback 204: % estado(s) de edição arquivados em bkp.mig204_estado_descartado', n;
end
$rb$;

-- 1) Fora a guarda e o sync (a partir daqui a tag de edição volta a ser gravável por qualquer caminho).
drop trigger if exists trg_work_tags_edition_guard on public.work_tags;
drop function if exists public.trg_work_tags_edition_guard();
drop trigger if exists trg_work_edition_state_sync on public.work_edition_state;
drop function if exists public.trg_work_edition_state_sync();
drop trigger if exists trg_work_edition_state_touch on public.work_edition_state;
drop function if exists public.trg_work_edition_state_touch();

-- 2) O que a 199 teria gravado durante a vida da 204.
insert into public.work_tags (work_id, tag_id, source)
select s.work_id, t.id, nullif(s.evidence->>'tag_source', '')
  from public.work_edition_state s
  join public.tags t on t.slug = 'r19-disponivel'
 where s.decided_by = 'auto' and s.basis = 'edition_tag'
on conflict (work_id, tag_id) do nothing;
insert into public.work_tags (work_id, tag_id, source)
select distinct s.work_id, t.id, 'synopsis_marker'
  from public.work_synopses s
  join public.tags t on t.slug = 'r19-disponivel'
 where s.text ~* '\[R1[89][^]]*\]' or s.text ~* '(^|\n)\s*R\s*-?\s*1[89]\s*(\n|$)'
on conflict (work_id, tag_id) do nothing;

-- 3) As funções e gatilhos da 199, como eram.
create or replace function public.sync_work_r19_edition(p_work_id uuid)
returns void language sql as $$
  update works w
     set r19_edition = sub.v
    from (
      select exists (
        select 1 from work_tags wt join tags t on t.id = wt.tag_id
         where wt.work_id = p_work_id and t.marks_r19_edition
      ) as v
    ) sub
   where w.id = p_work_id and w.r19_edition is distinct from sub.v;
$$;

create or replace function public.trg_work_tags_r19_edition()
returns trigger language plpgsql as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform public.sync_work_r19_edition(new.work_id);
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    if tg_op = 'DELETE' or old.work_id is distinct from new.work_id then
      perform public.sync_work_r19_edition(old.work_id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_work_tags_r19_edition on public.work_tags;
create trigger trg_work_tags_r19_edition
  after insert or update or delete on public.work_tags
  for each row execute function public.trg_work_tags_r19_edition();

create or replace function public.trg_work_synopses_r19_marker()
returns trigger language plpgsql as $$
begin
  if new.text ~* '\[R1[89][^]]*\]' or new.text ~* '(^|\n)\s*R\s*-?\s*1[89]\s*(\n|$)' then
    insert into work_tags (work_id, tag_id, source)
    select new.work_id, t.id, 'synopsis_marker'
      from tags t where t.slug = 'r19-disponivel'
    on conflict (work_id, tag_id) do nothing;
  end if;
  return null;
end $$;

-- 4) works: is_adult da 199, r19_edition recalculado da tag, sem o espelho.
alter table public.works drop constraint if exists works_r19_edition_espelha_estado;
alter table public.works alter column is_adult
  set expression as (coalesce(adult_override, adult_auto and not r19_edition));
do $rb$
declare n int;
begin
  update public.works w
     set r19_edition = exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id
                                where wt.work_id = w.id and t.marks_r19_edition)
   where w.r19_edition is distinct from exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id
                                                 where wt.work_id = w.id and t.marks_r19_edition);
  get diagnostics n = row_count;
  if n > 0 then
    raise warning 'rollback 204: % obra(s) mudaram de r19_edition ao voltar à regra da 199 (marcador/tag gravados enquanto a 204 esteve no ar)', n;
  end if;
end $rb$;
alter table public.works drop constraint if exists works_edition_state_valores;
alter table public.works drop column if exists edition_state;
drop function if exists public.sync_work_edition_mirror(uuid);
drop table if exists public.work_edition_state;

comment on column public.works.is_adult is
  'COALESCE(adult_override, adult_auto AND NOT r19_edition). Governa OCULTAR conteúdo 18+. '
  'O filtro "só 18+" é is_adult OR r19_edition (obra com as duas edições aparece nos dois). Mig 199.';
comment on column public.works.r19_edition is
  'Existe edição R19 além da R15 (tag com marks_r19_edition). Derivada por gatilho — não gravar à mão. Mig 199.';
comment on column public.works.adult_override is
  'Decisão humana de 18+: true força, false força limpo, null segue o auto. Vence o auto.';
comment on column public.tags.marks_r19_edition is
  'A tag afirma que a obra tem uma edição R19 além da R15 (mig 199). Mantém works.r19_edition.';

-- 203 — Aviso de abuso / violência sexual NÃO liga, sozinho, o gate 18+ (works.is_adult)
--
-- 🔴 DECISÃO DE PRODUTO (Ana, 2026-10-09). O gate 18+ responde UMA pergunta: "há evidência
-- suficiente de conteúdo sexual EXPLÍCITO efetivamente apresentado nesta obra?". Tags de abuso,
-- violência sexual, não-consentimento ou pedofilia descrevem um TEMA — muitas vezes backstory,
-- trauma passado, abuso mencionado, traço de antagonista ou evento não mostrado — e não provam
-- isso. Elas continuam existindo como tag e como aviso de conteúdo; só deixam de ligar o 18+.
-- Uma obra pode ter "aviso de abuso sexual = sim" e "18+ = não". Se houver, além do tema,
-- evidência independente de sexo explícito, é ESSA evidência que liga o gate.
--
-- O QUE ESTAVA ERRADO (medido na nuvem em 2026-10-09):
--   · 12 tags com `adult_indicator_strong = true` (ligam o gate SOZINHAS) e 1 soft
--     (`Non-Consensual Relationship`: liga com a nota adult_content >= 7).
--   · O catálogo já era INCONSISTENTE: "Sexual Assault" (114 obras), "Sexual Abuse" (49),
--     "Attempted Rape" (34) e "Child Rape" NUNCA ligaram o gate, enquanto "Attempted Gang Rape" e
--     "Child Sexual Abuse" ligavam. A maioria das 13 foi criada de fonte em 2026-07-27 e
--     classificada pelo enricher de IA, cujo prompt dizia (item 4) que "Rape"/"Pedophilia" "podem
--     ser fortes o bastante pra marcar a obra 18+" — o oposto do próprio item 3 (corrigido no
--     mesmo PR, `lib/ai-evaluation/tag-enricher.ts`).
--
-- O QUE FAZ:
--   1. Tira das 13 tags SÓ os sinais do gate: `adult_indicator` e `adult_indicator_strong` → false.
--      Não toca `adult_score_tier` (é NULL nas 13 — a guarda aborta se não for: seria uma
--      dependência com a NOTA, fora do escopo desta decisão), nem `marks_r19_edition`, nem
--      `work_tags`, nem nenhuma nota.
--   2. Recalcula `works.adult_auto` / `adult_reason` SÓ das obras cuja classificação dependia
--      dessas tags. ⚠️ É obrigatório: `adult_auto` é MONOTÔNICO na aplicação
--      (`lib/tags/adult-classify.ts::recomputeAdultAuto` só SOBE), então mudar a flag da tag
--      sozinha não tira ninguém do 18+.
--
-- A RÉGUA do recálculo é a mesma do `recomputeAdultAuto`, sem o conjunto:
--   ≥1 tag strong restante → (true, 'tag_explicit') · senão tag soft restante E nota >= 7 →
--   (true, 'tag_soft_score') · senão (false, NULL).
--   Ela só é aplicada a obra que: tem ≥1 das 13 tags · `adult_auto = true` · motivo
--   'tag_explicit'/'tag_soft_score' · era sustentada pelas tags ANTES (com o conjunto) · e cujo
--   motivo ATUAL deixa de se sustentar sem o conjunto.
--   Fica FORA, de propósito: `ai_review` (2ª opinião de IA com evidência explícita — evidência
--   independente); obra com `adult_auto = false` (esta migration NUNCA liga o 18+ de ninguém);
--   obra que já não se sustentava nem com o conjunto (legado monotônico, outro problema).
--
-- O QUE NÃO FAZ: não toca `adult_override` (a decisão humana continua vencendo — `is_adult` é
-- `COALESCE(adult_override, adult_auto AND NOT r19_edition)`, coluna gerada), nem `r19_edition`,
-- nem score. O `trg_works_updated_at` reescreve `updated_at` das obras recalculadas.
--
-- IMPACTO MEDIDO (esta migration executada sobre um retrato da nuvem de 2026-10-10, obras
-- ativas): 63 com alguma das 13 tags · 34 R18 → 29 depois (5 saem, 0 entram) · 12 obras
-- recalculadas: 10 `adult_auto` true→false e 2 só trocam o motivo (tag_explicit→tag_soft_score)
-- · 8 têm override (respeitado). Uma 11ª obra com o conjunto (`tag_soft_score` com nota 6,0) já
-- não se sustentava nem COM as tags: é legado, fica fora. O comportamento é conferido por
-- `npm run test:db-gate-aviso-sexual`.
--
-- IDEMPOTENTE: rodar de novo não muda nada (as tags já limpas, as obras já recalculadas).
-- ROLLBACK: `scripts/rollback/203_rollback.sql` restaura as flags e as obras a partir de
-- `bkp.mig203_tags_antes` / `bkp.mig203_works_antes` (schema `bkp`: fora do PostgREST).

set lock_timeout = '5s';

-- ── 0) O conjunto decidido: slug, nome e o sinal que cada tag tinha ──────────────────────
drop table if exists pg_temp.mig203_conjunto;
create temp table mig203_conjunto (slug text primary key, name text not null, era_strong boolean not null)
  on commit drop;
insert into mig203_conjunto (slug, name, era_strong) values
  ('rape-as-a-start-of-relationship', 'Rape as a Start of Relationship', true),
  ('gang-rape',                       'Gang Rape',                       true),
  ('pedophilia',                      'Pedophilia',                      true),
  ('reverse-rape',                    'Reverse Rape',                    true),
  ('drugging-roofing',                'Drugging/Roofing',                true),
  ('attempted-gang-rape',             'Attempted Gang Rape',             true),
  ('attempted-reverse-rape',          'Attempted Reverse Rape',          true),
  ('rape-by-lover',                   'Rape by Lover',                   true),
  ('child-sexual-abuse',              'Child Sexual Abuse',              true),
  ('sleep-molestation',               'Sleep Molestation',               true),
  ('groping',                         'Groping',                         true),
  ('chikan',                          'Chikan',                          true),
  ('non-consensual-relationship',     'Non-Consensual Relationship',     false);

-- ── 1) Guardas de ENTRADA ──────────────────────────────────────────────────────────────
do $guarda$
declare
  n_casam int; n_piso int; n_originais int; n_limpas int;
begin
  -- As 13 existem, com o NOME esperado, no grupo content_indicator.
  select count(*) into n_casam
    from public.tags t
    join mig203_conjunto c on c.slug = t.slug and c.name = t.name
    join public.tag_group g on g.id = t.tag_group_id and g.slug = 'content_indicator';
  if n_casam <> 13 then
    raise exception 'mig 203: esperava as 13 tags do conjunto (slug + nome + grupo content_indicator), casaram %; abortando', n_casam;
  end if;

  -- Dependência com a NOTA: nenhuma delas pode impor piso/teto de adult_content.
  select count(*) into n_piso from public.tags t join mig203_conjunto c using (slug) where t.adult_score_tier is not null;
  if n_piso > 0 then
    raise exception 'mig 203: % tag(s) do conjunto têm adult_score_tier — mexer nelas afetaria a NOTA, fora desta decisão; abortando', n_piso;
  end if;

  -- O estado tem de ser o ORIGINAL inteiro (1ª execução) ou o LIMPO inteiro (re-execução).
  -- Qualquer mistura quer dizer que alguém mexeu à mão no meio — não aplico por cima.
  select count(*) filter (where t.adult_indicator and t.adult_indicator_strong = c.era_strong),
         count(*) filter (where not t.adult_indicator and not t.adult_indicator_strong)
    into n_originais, n_limpas
    from public.tags t join mig203_conjunto c using (slug);
  if n_originais <> 13 and n_limpas <> 13 then
    raise exception 'mig 203: estado misto das 13 tags (% originais, % já limpas) — conferir à mão antes; abortando', n_originais, n_limpas;
  end if;
end
$guarda$;

-- ── 2) Retrato de ANTES (para as guardas de saída) e backup para o rollback ────────────
drop table if exists pg_temp.mig203_antes;
create temp table mig203_antes on commit drop as
  select id, adult_auto, adult_reason, adult_override, r19_edition, is_adult from public.works;

drop table if exists pg_temp.mig203_notas_antes;
create temp table mig203_notas_antes on commit drop as
  select md5(coalesce(string_agg(work_id::text || ':' || coalesce(score::text, '∅'), ',' order by work_id), '')) h
    from public.category_scores where criterion_slug = 'adult_content';

create schema if not exists bkp;
create table if not exists bkp.mig203_tags_antes (
  slug text primary key,
  name text not null,
  adult_indicator boolean not null,
  adult_indicator_strong boolean not null,
  salvo_em timestamptz not null default now()
);
create table if not exists bkp.mig203_works_antes (
  work_id uuid primary key,
  adult_auto boolean not null,
  adult_reason text,
  adult_auto_depois boolean not null,
  adult_reason_depois text,
  salvo_em timestamptz not null default now()
);
comment on table bkp.mig203_tags_antes is 'mig 203: flags 18+ das 13 tags de violência/abuso sexual ANTES da migration. Usado por scripts/rollback/203_rollback.sql.';
comment on table bkp.mig203_works_antes is 'mig 203: adult_auto/adult_reason das obras recalculadas, antes e depois. Usado por scripts/rollback/203_rollback.sql.';

-- `on conflict do nothing`: a 1ª execução guarda o ORIGINAL; re-execução não sobrescreve.
insert into bkp.mig203_tags_antes (slug, name, adult_indicator, adult_indicator_strong)
select t.slug, t.name, t.adult_indicator, t.adult_indicator_strong
  from public.tags t join mig203_conjunto c using (slug)
on conflict (slug) do nothing;

-- ── 3) O PLANO: quais obras mudam, e para o quê ─────────────────────────────────────────
drop table if exists pg_temp.mig203_plano;
create temp table mig203_plano on commit drop as
with conj as (
  select t.id, c.era_strong from public.tags t join mig203_conjunto c using (slug)
),
sinais as (
  select
    w.id,
    w.adult_auto,
    w.adult_reason,
    coalesce((select cs.score from public.category_scores cs
               where cs.work_id = w.id and cs.criterion_slug = 'adult_content'), 0) as nota,
    -- COM o conjunto, pelas flags ORIGINAIS (era_strong) — independe de a migration já ter rodado.
    bool_or(conj.era_strong) as strong_conj,
    bool_or(conj.id is not null and not conj.era_strong) as soft_conj,
    -- SEM o conjunto: só as outras tags, pelas flags atuais delas.
    bool_or(conj.id is null and t.adult_indicator_strong) as strong_resto,
    bool_or(conj.id is null and t.adult_indicator and not t.adult_indicator_strong) as soft_resto
  from public.works w
  join public.work_tags wt on wt.work_id = w.id
  join public.tags t on t.id = wt.tag_id
  left join conj on conj.id = t.id
  where exists (select 1 from public.work_tags x join conj on conj.id = x.tag_id where x.work_id = w.id)
  group by w.id, w.adult_auto, w.adult_reason
),
decisao as (
  select s.*,
    (s.strong_conj or s.strong_resto
      or ((s.soft_conj or s.soft_resto) and s.nota >= 7)) as sustentada_com,
    case s.adult_reason
      when 'tag_explicit'   then coalesce(s.strong_resto, false)
      when 'tag_soft_score' then coalesce(s.soft_resto, false) and s.nota >= 7
      else true
    end as motivo_se_sustenta_sem
  from sinais s
)
select
  d.id,
  d.adult_auto as auto_antes,
  d.adult_reason as motivo_antes,
  (coalesce(d.strong_resto, false) or (coalesce(d.soft_resto, false) and d.nota >= 7)) as auto_depois,
  case
    when coalesce(d.strong_resto, false) then 'tag_explicit'
    when coalesce(d.soft_resto, false) and d.nota >= 7 then 'tag_soft_score'
  end as motivo_depois
from decisao d
where d.adult_auto
  and d.adult_reason in ('tag_explicit', 'tag_soft_score')
  and d.sustentada_com
  and not d.motivo_se_sustenta_sem;

-- ── 4) Guardas do PLANO ─────────────────────────────────────────────────────────────────
do $guarda$
declare n int; n_sobe int;
begin
  select count(*) into n from mig203_plano;
  -- Medido em 2026-10-09: 13 obras ativas. Um plano muito maior quer dizer que o banco mudou
  -- de um jeito que ninguém mediu — refazer a medição antes de aplicar.
  if n > 30 then
    raise exception 'mig 203: o plano recalcularia % obras (medido: 13 em 2026-10-09) — remedir antes de aplicar; abortando', n;
  end if;
  select count(*) into n_sobe from mig203_plano where auto_depois and not auto_antes;
  if n_sobe > 0 then
    raise exception 'mig 203: % obra(s) passariam a 18+ — esta migration só pode DESLIGAR; abortando', n_sobe;
  end if;
end
$guarda$;

-- ── 5) Aplicar ──────────────────────────────────────────────────────────────────────────
insert into bkp.mig203_works_antes (work_id, adult_auto, adult_reason, adult_auto_depois, adult_reason_depois)
select id, auto_antes, motivo_antes, auto_depois, motivo_depois from mig203_plano
on conflict (work_id) do nothing;

update public.tags t
   set adult_indicator = false, adult_indicator_strong = false
  from mig203_conjunto c
 where t.slug = c.slug and (t.adult_indicator or t.adult_indicator_strong);

update public.works w
   set adult_auto = p.auto_depois, adult_reason = p.motivo_depois
  from mig203_plano p
 where w.id = p.id;

-- ── 6) Guardas de SAÍDA: nada fora do conjunto causal mudou ─────────────────────────────
do $guarda$
declare n_tags int; n_fora int; n_override int; n_r19 int; n_piso int; n_plano int; n_sai int; n_entra int;
begin
  select count(*) into n_tags from public.tags t join mig203_conjunto c using (slug)
   where t.adult_indicator or t.adult_indicator_strong;
  if n_tags > 0 then raise exception 'mig 203: % tag(s) do conjunto ainda ligam o gate', n_tags; end if;

  select count(*) into n_fora
    from mig203_antes a join public.works w on w.id = a.id
   where (w.adult_auto, w.adult_reason) is distinct from (a.adult_auto, a.adult_reason)
     and a.id not in (select id from mig203_plano);
  if n_fora > 0 then raise exception 'mig 203: % obra(s) FORA do plano mudaram de adult_auto/adult_reason', n_fora; end if;

  select count(*) filter (where w.adult_override is distinct from a.adult_override),
         count(*) filter (where w.r19_edition is distinct from a.r19_edition)
    into n_override, n_r19
    from mig203_antes a join public.works w on w.id = a.id;
  if n_override > 0 or n_r19 > 0 then
    raise exception 'mig 203: mexeu em override (%) ou r19_edition (%)', n_override, n_r19;
  end if;

  if (select h from mig203_notas_antes) is distinct from (
       select md5(coalesce(string_agg(work_id::text || ':' || coalesce(score::text, '∅'), ',' order by work_id), ''))
         from public.category_scores where criterion_slug = 'adult_content') then
    raise exception 'mig 203: a nota adult_content mudou — esta migration não pode tocar score';
  end if;

  select count(*) into n_piso from public.tags t join mig203_conjunto c using (slug) where t.adult_score_tier is not null;
  if n_piso > 0 then raise exception 'mig 203: adult_score_tier mudou nas tags do conjunto'; end if;

  select count(*) into n_plano from mig203_plano;
  select count(*) filter (where a.is_adult and not w.is_adult),
         count(*) filter (where not a.is_adult and w.is_adult)
    into n_sai, n_entra
    from mig203_antes a join public.works w on w.id = a.id;
  if n_entra > 0 then raise exception 'mig 203: % obra(s) passaram a 18+', n_entra; end if;

  raise notice 'mig 203: % obra(s) recalculadas · % deixam o 18+ · 0 entram', n_plano, n_sai;
end
$guarda$;

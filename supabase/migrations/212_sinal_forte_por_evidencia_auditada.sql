-- 212 — Sinal forte que faltava, por evidência auditada: Smut (10 obras) e Pornographic (2)
--
-- ✅ APLICADA EM PRODUÇÃO em 2026-10-11 03:53Z, na mesma transação que a 210 e a 211 (PR #553,
-- merge 2603971; código no ar na release Fly v41). Ensaiada antes em retratos descartáveis da nuvem
-- (o último: backup de 2026-10-11T03:50Z) e conferida por `npm run test:db-tags-adultas`.
--
-- POR QUE EXISTE: com o gate só por tag forte (210) e sem os R19 que a nota inventou (211), estas 12
-- obras sairiam do 18+ — mas a auditoria obra a obra (Auditoria/tags-adultas-e-geral-2026-10-10/
-- revisao-23 e revisao-4) achou evidência INDEPENDENTE da nota de que elas mostram sexo explícito.
-- O que faltava era a tag forte legítima: `Smut` tinha 0 vínculos no catálogo inteiro porque o alias
-- antigo `smut → Sexual Content` (corrigido na 210) desviava o rótulo da fonte para uma tag fraca.
--
-- DECISÕES (Ana, 2026-10-10/11):
--   · Smut nas 10 cuja evidência é de GÊNERO (leitores e/ou descrição do MangaUpdates chamam a obra
--     de smut/porn, com cena sexual explícita descrita).
--   · Pornographic nas 2 cuja ÚNICA evidência é a classificação de conteúdo da própria fonte
--     (MangaDex/ComicK) como "pornographic" — sem inventar o gênero Smut que a fonte não afirmou.
--   · Nenhum override. A nota NÃO é evidência aqui (nem para escolher as obras, nem para o gate).
--   · Três das 10 têm classificação de fonte "erotica"; elas entram pela evidência de explicitness dos
--     leitores (e, em Prince Snow White, da descrição do MangaUpdates), não por essa classificação.
--
-- AS DUAS TAGS (migration 166, grupo content_indicator): forte (`adult_indicator_strong`) e piso
-- `explicit` — o mesmo que `adult-content-rules.ts` dá à classificação "pornographic" ("explícito por
-- definição"). Nenhuma das duas tem vínculo nem alias antes desta migration.
--
-- O QUE FAZ:
--   1. Vincula a tag decidida a cada obra com `work_tags.source = 'curadoria'` — a procedência fica no
--      próprio vínculo (o mesmo padrão de `synopsis_marker`, mig 199), e a página da obra a trata
--      como manual (só `ai_inferred` ganha selo de IA).
--   2. Registra obra, tag, evidência, auditoria e quem decidiu em `bkp.mig212_vinculos`.
--   3. Recalcula `adult_auto`/`adult_reason` dessas obras com a MESMA régua da 210 (≥1 tag forte;
--      `ai_review` intocado).
--
-- O QUE NÃO FAZ: não lê nem altera nota (`category_scores`), avaliação, piso/teto, override,
-- `edition_state`, flags de tag nem aliases; não toca nenhum outro vínculo nem outra obra.
--
-- ⚠️ ORDEM: 210 → 211 → 212 → código (a guarda exige a 210). Rollback: `scripts/rollback/212_rollback.sql`,
-- ANTES do da 211 e do da 210. IDEMPOTENTE.

set lock_timeout = '5s';

-- ── 0) A lista decidida ────────────────────────────────────────────────────────────────────
drop table if exists pg_temp.mig212_tags;
create temp table mig212_tags (
  work_id uuid primary key, titulo text not null, tag_slug text not null check (tag_slug in ('smut', 'pornographic')),
  evidencia text not null, auditoria text not null
) on commit drop;
insert into mig212_tags values
  ('20714b59-9270-41c8-a972-de2c2b79bb2f', 'A Monster’s Mate', 'smut', '13 reviews (comix, mangago): "borders on pure hentai", "packaged porn"; leitores citam as tags smut/erotica/adult da fonte', 'revisao-23 · 2026-10-10'),
  ('96024b26-915b-4a39-8c6c-eb41db254c71', 'A Taste for Being Treated Roughly', 'smut', 'reviews de 2 fontes: "funny smut", "one of my favorites for smut"; síntese: conteúdo sexual explícito (smut)', 'revisao-23 · 2026-10-10'),
  ('0559876a-db85-41d5-9bb4-a5c0301a2930', 'Curse of the Saintess', 'smut', '2 reviews (comix): "Smut is pretty short and sweet when it happens"; síntese: conteúdo sexual explícito', 'revisao-23 · 2026-10-10'),
  ('0de9257a-3eee-41d5-b890-0be64c034446', 'Is This Marriage Okay?', 'smut', '3 reviews (comix): "the smut is great", "including smut scenes"; síntese: cenas sexuais explícitas (smut)', 'revisao-23 · 2026-10-10'),
  ('e50746a5-81ad-4b47-acf8-2fdf77cf9580', 'My First XXX: The Marquess Is Wild for His Princess', 'smut', '9 reviews de 3 fontes: "porn without plot", "only two sex scene", descrição gráfica do ato; síntese: cenas sexuais explícitas', 'revisao-23 · 2026-10-10'),
  ('7acbd089-2d1a-46d4-81ef-f23419daec89', 'Prince Snow White Is Taken by the Queen', 'smut', 'descrição do MangaUpdates: "fantasy romance smut"; reviews: "smut-oriented", "the sex scenes"', 'revisao-23 · 2026-10-10'),
  ('9b563391-41ae-4d55-a040-c028146f7f41', 'Ring of Bondage - Confinement', 'smut', 'síntese: fortemente centrada em cenas sexuais (smut); 2 reviews (comix): "just enjoy the smut"', 'revisao-23 · 2026-10-10'),
  ('29a29b28-d3dc-4576-b424-68178c90ce09', 'Solstice', 'smut', 'reviews de 2 fontes: "long smut intermissions"; síntese: conteúdo sexual explícito (smut)', 'revisao-23 · 2026-10-10'),
  ('a252edbc-366e-43e9-ad94-19431247a69a', 'The Demon King Wants Peace', 'smut', '14 reviews: "This is smut", "turns out it is also porn", aviso NSFW da fonte; síntese: conteúdo sexual explícito (smut)', 'revisao-23 · 2026-10-10'),
  ('4f770dd9-7d3e-47c7-ba61-d3005389262c', 'The Saint Dreams of Secret Love', 'smut', 'fonte classifica "pornographic" (avaliações de 2026-06-13 e 2026-08-20); leitores: "good smut", "censored and vanilla" (censura dentro da cena)', 'revisao-4 · 2026-10-11'),
  ('6fd969e1-b83d-4464-923f-0226e55e480e', 'Samo', 'pornographic', 'fonte classifica "pornographic" (avaliações de 2026-07-12 e 2026-07-20); sem evidência de gênero', 'revisao-4 · 2026-10-11'),
  ('8d122c41-f36f-4e76-8a97-ad1004b85516', 'Savage Witch', 'pornographic', 'fonte classifica "pornographic" (avaliação de 2026-07-12); sem evidência de gênero', 'revisao-4 · 2026-10-11');

-- ── 1) Guardas de ENTRADA ──────────────────────────────────────────────────────────────────
do $guarda$
declare n int; n_lista int; n_curado int; n_outro int; lista text;
begin
  select count(*) into n_lista from mig212_tags;

  if to_regclass('bkp.mig210_works_antes') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tags' and column_name = 'enrichment_status') then
    raise exception 'mig 212: a 210 não foi aplicada aqui (a régua de tag forte depende dela); abortando';
  end if;

  -- As duas tags: canônicas, fortes, piso explicit, no grupo content_indicator.
  select count(*) into n from public.tags t join public.tag_group g on g.id = t.tag_group_id
   where (t.slug, t.name) in (('smut', 'Smut'), ('pornographic', 'Pornographic'))
     and t.adult_indicator and t.adult_indicator_strong and t.adult_score_tier = 'explicit' and g.slug = 'content_indicator';
  if n <> 2 then raise exception 'mig 212: Smut/Pornographic não estão como esperado (forte, piso explicit, content_indicator); abortando'; end if;

  -- As obras: com o título esperado, ativas, sem override e sem estado de edição (premissa da decisão).
  select count(*) into n from public.works w join mig212_tags c on c.work_id = w.id and c.titulo = w.title where not w.is_archived;
  if n <> n_lista then raise exception 'mig 212: esperava as % obras ativas com o título esperado, casaram %; abortando', n_lista, n; end if;
  select string_agg(c.titulo, ' · ') into lista from mig212_tags c join public.works w on w.id = c.work_id
   where w.adult_override is not null or w.edition_state is not null
      or exists (select 1 from public.work_edition_state es where es.work_id = c.work_id);
  if lista is not null then raise exception 'mig 212: obra(s) ganharam override ou estado de edição desde a auditoria — reavaliar: %', lista; end if;

  -- Vínculo decidido: ou ausente (1ª execução) ou presente como 'curadoria' (re-execução). Outro = veio por outro caminho.
  select count(*) filter (where wt.source = 'curadoria'), count(*) filter (where wt.source is distinct from 'curadoria')
    into n_curado, n_outro
    from mig212_tags c join public.tags t on t.slug = c.tag_slug join public.work_tags wt on wt.work_id = c.work_id and wt.tag_id = t.id;
  if n_outro > 0 then raise exception 'mig 212: % vínculo(s) decidido(s) já existem por OUTRO caminho (source <> curadoria); conferir à mão; abortando', n_outro; end if;
  if n_curado not in (0, n_lista) then raise exception 'mig 212: estado misto (% de % vínculos presentes); conferir à mão; abortando', n_curado, n_lista; end if;
end
$guarda$;

-- ── 2) Retratos de ANTES (guardas de saída) e backup para o rollback ──────────────────────
drop table if exists pg_temp.mig212_works_antes_t;
create temp table mig212_works_antes_t on commit drop as
  select id, adult_auto, adult_reason, adult_override, edition_state, r19_edition, is_adult from public.works;
drop table if exists pg_temp.mig212_hashes;
create temp table mig212_hashes on commit drop as select
  (select md5(coalesce(string_agg(concat_ws('|', work_id, criterion_slug, score, source, ai_evaluation_id), ',' order by work_id, criterion_slug), '')) from public.category_scores) cs,
  -- work_tags SEM os 12 pares decididos: tem de bater depois.
  (select md5(coalesce(string_agg(concat_ws('|', wt.work_id, wt.tag_id, wt.source, wt.confidence), ',' order by wt.work_id, wt.tag_id), ''))
     from public.work_tags wt join public.tags t on t.id = wt.tag_id
    where (wt.work_id, t.slug) not in (select work_id, tag_slug from mig212_tags)) wt_resto,
  (select md5(coalesce(string_agg(concat_ws('|', work_id, state, basis, decided_by), ',' order by work_id), '')) from public.work_edition_state) es,
  (select md5(coalesce(string_agg(concat_ws('|', slug, name, tag_group_id, tag_subgroup_id, adult_indicator, adult_indicator_strong, adult_score_tier, marks_r19_edition), ',' order by slug), '')) from public.tags) tags,
  (select md5(coalesce(string_agg(concat_ws('|', alias_slug, canonical_tag_id), ',' order by alias_slug), '')) from public.tag_alias) alias;

create schema if not exists bkp;
create table if not exists bkp.mig212_vinculos (
  work_id uuid not null, tag_slug text not null, titulo text not null, evidencia text not null, auditoria text not null,
  decided_by text not null, inserido_em timestamptz not null default now(), primary key (work_id, tag_slug)
);
create table if not exists bkp.mig212_works_antes (
  work_id uuid primary key, adult_auto boolean not null, adult_reason text,
  adult_auto_depois boolean not null, adult_reason_depois text, salvo_em timestamptz not null default now()
);
comment on table bkp.mig212_vinculos is 'mig 212: PROVENIÊNCIA dos vínculos Smut/Pornographic decididos pela curadoria (obra, tag, evidência auditada, auditoria, quem decidiu). Usado por scripts/rollback/212_rollback.sql.';
comment on table bkp.mig212_works_antes is 'mig 212: adult_auto/adult_reason das obras recalculadas depois do vínculo, antes e depois. Usado pelo rollback.';

insert into bkp.mig212_vinculos (work_id, tag_slug, titulo, evidencia, auditoria, decided_by)
select work_id, tag_slug, titulo, evidencia, auditoria, 'curadoria (Ana) · auditoria US$0 de tags adultas'
  from mig212_tags
on conflict (work_id, tag_slug) do nothing;

-- ── 3) O PLANO: a régua da 210 (≥1 tag forte), contando o vínculo decidido ──────────────────
drop table if exists pg_temp.mig212_plano;
create temp table mig212_plano on commit drop as
select w.id, w.adult_auto as auto_antes, w.adult_reason as motivo_antes, true as auto_depois, 'tag_explicit'::text as motivo_depois
  from public.works w join mig212_tags c on c.work_id = w.id
 where coalesce(w.adult_reason, '') <> 'ai_review'
   and not (w.adult_auto and w.adult_reason = 'tag_explicit');

-- ── 4) Aplicar ──────────────────────────────────────────────────────────────────────────────
insert into bkp.mig212_works_antes (work_id, adult_auto, adult_reason, adult_auto_depois, adult_reason_depois)
select id, auto_antes, motivo_antes, auto_depois, motivo_depois from mig212_plano
on conflict (work_id) do nothing;

insert into public.work_tags (work_id, tag_id, source)
select c.work_id, t.id, 'curadoria' from mig212_tags c join public.tags t on t.slug = c.tag_slug
on conflict (work_id, tag_id) do nothing;

update public.works w set adult_auto = p.auto_depois, adult_reason = p.motivo_depois
  from mig212_plano p where w.id = p.id;

-- ── 5) Guardas de SAÍDA ─────────────────────────────────────────────────────────────────────
do $guarda$
declare n int; n_ovr int; n_es int; n_r19 int; h record;
begin
  select count(*) into n from mig212_tags c join public.tags t on t.slug = c.tag_slug
    join public.work_tags wt on wt.work_id = c.work_id and wt.tag_id = t.id and wt.source = 'curadoria';
  if n <> (select count(*) from mig212_tags) then raise exception 'mig 212: só % dos vínculos decididos estão presentes', n; end if;

  select count(*) into n from public.works w join mig212_tags c on c.work_id = w.id where not (w.adult_auto and w.is_adult);
  if n > 0 then raise exception 'mig 212: % obra(s) da lista não ficaram 18+', n; end if;

  select count(*) into n from mig212_works_antes_t a join public.works w on w.id = a.id
   where (w.adult_auto, w.adult_reason) is distinct from (a.adult_auto, a.adult_reason)
     and a.id not in (select id from mig212_plano);
  if n > 0 then raise exception 'mig 212: % obra(s) FORA do plano mudaram de adult_auto/adult_reason', n; end if;

  select count(*) filter (where w.adult_override is distinct from a.adult_override),
         count(*) filter (where w.edition_state is distinct from a.edition_state),
         count(*) filter (where w.r19_edition is distinct from a.r19_edition)
    into n_ovr, n_es, n_r19 from mig212_works_antes_t a join public.works w on w.id = a.id;
  if n_ovr > 0 or n_es > 0 or n_r19 > 0 then
    raise exception 'mig 212: mexeu em override (%), edition_state (%) ou r19_edition (%)', n_ovr, n_es, n_r19;
  end if;

  select * into h from mig212_hashes;
  if h.cs is distinct from (select md5(coalesce(string_agg(concat_ws('|', work_id, criterion_slug, score, source, ai_evaluation_id), ',' order by work_id, criterion_slug), '')) from public.category_scores) then
    raise exception 'mig 212: category_scores mudou — esta migration não pode tocar nota';
  end if;
  if h.wt_resto is distinct from (select md5(coalesce(string_agg(concat_ws('|', wt.work_id, wt.tag_id, wt.source, wt.confidence), ',' order by wt.work_id, wt.tag_id), ''))
       from public.work_tags wt join public.tags t on t.id = wt.tag_id
      where (wt.work_id, t.slug) not in (select work_id, tag_slug from mig212_tags)) then
    raise exception 'mig 212: um vínculo FORA dos 12 decididos mudou';
  end if;
  if h.es is distinct from (select md5(coalesce(string_agg(concat_ws('|', work_id, state, basis, decided_by), ',' order by work_id), '')) from public.work_edition_state) then
    raise exception 'mig 212: work_edition_state mudou';
  end if;
  if h.tags is distinct from (select md5(coalesce(string_agg(concat_ws('|', slug, name, tag_group_id, tag_subgroup_id, adult_indicator, adult_indicator_strong, adult_score_tier, marks_r19_edition), ',' order by slug), '')) from public.tags) then
    raise exception 'mig 212: uma tag mudou — esta migration não classifica tag';
  end if;
  if h.alias is distinct from (select md5(coalesce(string_agg(concat_ws('|', alias_slug, canonical_tag_id), ',' order by alias_slug), '')) from public.tag_alias) then
    raise exception 'mig 212: tag_alias mudou';
  end if;

  raise notice 'mig 212: % vínculos (Smut %, Pornographic %) · obras recalculadas % · is_adult: % entram, % saem',
    (select count(*) from mig212_tags), (select count(*) from mig212_tags where tag_slug = 'smut'), (select count(*) from mig212_tags where tag_slug = 'pornographic'),
    (select count(*) from mig212_plano),
    (select count(*) from mig212_works_antes_t a join public.works w on w.id = a.id where not a.is_adult and w.is_adult),
    (select count(*) from mig212_works_antes_t a join public.works w on w.id = a.id where a.is_adult and not w.is_adult);
end
$guarda$;

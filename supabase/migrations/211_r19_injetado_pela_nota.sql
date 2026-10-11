-- 211 — Remove os vínculos R19 que a nota inventou (sem confirmação independente)
--
-- ✅ APLICADA EM PRODUÇÃO em 2026-10-11 03:53Z, na mesma transação que a 210 e a 212 (PR #553,
-- merge 2603971; código no ar na release Fly v41). Ensaiada antes em retratos descartáveis da nuvem
-- e conferida por `npm run test:db-tags-adultas` (que aplica 210 → 211 → 212).
--
-- POR QUE EXISTE: em 2026-07-09 03:49 UTC, `scripts/tag-r19-adult.ts` vinculou a tag R19 (forte) a
-- toda obra com `adult_content >= 7` que ainda não a tinha — 229 vínculos, `source` NULL. Era a regra
-- "nota alta ⇒ R18" disfarçada de evidência: a nota virava uma tag forte, e a tag forte liga o gate.
-- Com o gate só por tag forte (210), esses vínculos são a última porta por onde a nota ainda decide.
--
-- DECISÃO (Ana, 2026-10-10): remover o vínculo R19 cuja ÚNICA proveniência é essa inferência pela
-- nota, quando não existe confirmação independente de R19 numa fonte real. Ambíguo NÃO se remove.
-- A auditoria obra a obra (Auditoria/tags-adultas-e-geral-2026-10-10/r19/classificacao-r19.csv) deu:
--   · 131 confirmed_external — o MangaUpdates lista a edição R19 do quadrinho (107 mixed), a auditoria
--     de edição confirmou r18_only (23), ou a descrição da fonte lista o webtoon R19 (1). FICAM.
--   ·  49 ambiguous — outra tag forte afirma cena explícita sem rótulo R19 de fonte (38), a FONTE
--     classifica a obra como "pornographic" (3; gravado no contexto das avaliações), só leitor afirma
--     18+/R19 (5), fontes contraditórias ou edição decidida por reviews (3). FICAM.
--   ·  49 script_only — nenhuma evidência independente persistida (46), ou evidência CONTRÁRIA
--     (curadoria marcou "R15 but Based on a R19 Novel"; leitores dizem "isto não é R19"). SAEM AQUI.
--     ⚠️ Classificação de fonte "erotica" NÃO tira a obra daqui: é o degrau abaixo do explícito (o
--     catálogo a mapeia para piso 7) e não confirma um rótulo R19. Revisado em 2026-10-11.
--
-- POR QUE SEPARADA DA 210: a 210 decide o que cada TAG significa (classificação, aliases); esta
-- corrige VÍNCULOS que nunca deveriam ter existido. Causas diferentes, rollback diferente, e uma pode
-- ser revertida sem a outra.
--
-- O QUE FAZ:
--   1. Apaga só os vínculos R19 das 49 obras da lista, e só se forem os injetados (source NULL, criados
--      no minuto 2026-07-09 03:49 UTC). Vínculo recriado por outro caminho aborta.
--   2. Reconfere a premissa na hora: nenhuma das 51 ganhou evidência (auditoria de edição, outra tag
--      forte, tag da família R19, marcador R19 na sinopse). Se ganhou, aborta.
--   3. Recalcula `adult_auto`/`adult_reason` dessas obras com a MESMA régua da 210 (≥1 tag forte;
--      `ai_review` intocado). Override e estado de edição seguem decidindo o `is_adult` final.
--
-- O QUE NÃO FAZ: não lê nem altera nota (`category_scores`); não toca piso, override,
-- `edition_state`, flags de tag, aliases nem nenhum outro vínculo.
--
-- ⚠️ ORDEM: depois da 210 (a guarda confere). Rollback: `scripts/rollback/211_rollback.sql`, ANTES do
-- rollback da 210. IDEMPOTENTE.

set lock_timeout = '5s';

-- ── 0) A lista: as 49 obras `script_only` (gerada por r19/classificar-r19.mjs) ───────────────
drop table if exists pg_temp.mig211_remover;
create temp table mig211_remover (work_id uuid primary key, titulo text not null, motivo text not null) on commit drop;
insert into mig211_remover values
  ('860d0e8f-490b-4186-94b8-efa4ef86a2ea', 'A Butterfly Through the Mist', 'nenhuma evidência independente persistida'),
  ('20714b59-9270-41c8-a972-de2c2b79bb2f', 'A Monster’s Mate', 'nenhuma evidência independente persistida'),
  ('96024b26-915b-4a39-8c6c-eb41db254c71', 'A Taste for Being Treated Roughly', 'nenhuma evidência independente persistida'),
  ('13790b32-d3ce-4ba9-a600-2ed25d040467', 'Absolute Praise', 'nenhuma evidência independente persistida'),
  ('79328725-892a-46ba-932b-5b2eefb22428', 'An Inescapable Love', 'nenhuma evidência independente persistida'),
  ('6ffbd081-c1af-4022-a6e9-31374f247599', 'Another Typical Fantasy Romance', 'nenhuma evidência independente persistida'),
  ('da2ce35f-597e-4564-9882-4b02abf34601', 'As Night Falls Upon the Autumn River', 'nenhuma evidência independente persistida'),
  ('09a9444f-490b-4b0e-a9e6-474d98d27f8e', 'Bastian', 'nenhuma evidência independente persistida'),
  ('e7794e0a-6b6c-4aa9-aafc-187773c6725d', 'Beneath the Fallen Bloom', 'nenhuma evidência independente persistida'),
  ('3be0f2ea-b0a6-4c15-a36e-4cfbea4817b1', 'Betrothed to My Sister''s Ex', 'nenhuma evidência independente persistida'),
  ('62a32de2-686c-4cc6-a775-63564e39155c', 'Bunny, Leave the Door Open Tonight', 'nenhuma evidência independente persistida'),
  ('0559876a-db85-41d5-9bb4-a5c0301a2930', 'Curse of the Saintess', 'nenhuma evidência independente persistida'),
  ('b05937a6-2b59-431f-adf8-99b454a3b861', 'Do or Die: You Got a Tentacle Too?!', 'nenhuma fonte; leitor só especula (''might get … uncensored smut'')'),
  ('cf1bc9a8-e969-459c-8943-88b93d97f6cf', 'Ero Meruhen - Hoshi no Ginka', 'nenhuma evidência independente persistida'),
  ('bffb0ec3-f31b-4859-9e5d-dd1c97b048d6', 'Ero♥Märchen: Cinderella', 'nenhuma evidência independente persistida'),
  ('7dbeb651-13cd-442c-a3c7-3ded8dea847f', 'High Society (Gyeonu)', 'nenhuma evidência independente persistida'),
  ('6a170468-ed9f-467f-afcf-a9784532dc24', 'Holding You Close', 'nenhuma evidência independente persistida'),
  ('fcd870e2-5b69-48df-84cc-751acbe38b79', 'How to Tame the Merciless Villain', 'nenhuma evidência independente persistida'),
  ('8f28edca-9c31-4fc3-943c-5441d84e73b0', 'I Raised the Devil', 'nenhuma evidência independente persistida'),
  ('3c5cb58e-a835-4865-ab04-eeb16ce6a28d', 'I''m an Introverted Maiden in Another World and Have a Handsome Elf All Over Me', 'nenhuma evidência independente persistida'),
  ('0de9257a-3eee-41d5-b890-0be64c034446', 'Is This Marriage Okay?', 'nenhuma evidência independente persistida'),
  ('1e10413d-1b10-4d47-ae0f-654c0a5d0bde', 'Just Peachy', 'nenhuma evidência independente persistida'),
  ('b76764cb-08e3-45ef-b6af-97f00ac5f3a7', 'MOONSTRUCK', 'nenhuma evidência independente persistida'),
  ('b3a24361-6ad7-4338-b63e-f2773f0ba1a8', 'My Brother''s Friend Can''t Be This Big!', 'nenhuma evidência independente persistida'),
  ('e50746a5-81ad-4b47-acf8-2fdf77cf9580', 'My First XXX: The Marquess Is Wild for His Princess', 'nenhuma evidência independente persistida'),
  ('ced72849-bdf3-412c-841f-03daa0eaf353', 'My Master, the Wolf Queen', 'nenhuma evidência independente persistida'),
  ('6bf06f67-11b1-4f20-bb3c-99679fc43f38', 'Nullitas ~The Counterfeit Bride~', 'nenhuma evidência independente persistida'),
  ('4fb5ad87-0c14-4586-9df1-2c710c670a04', 'One Night Stand Otoko wa Kekkon Aite de Shita', 'nenhuma evidência independente persistida'),
  ('9b563391-41ae-4d55-a040-c028146f7f41', 'Ring of Bondage - Confinement', 'nenhuma evidência independente persistida'),
  ('4a018133-1e92-4f69-9652-3ef936c69b73', 'Seduce a Fox', 'nenhuma evidência independente persistida'),
  ('23282986-a8ed-4b17-9e8b-70670cd357b9', 'Sheathe Your Sword in the Bedroom', 'nenhuma evidência independente persistida'),
  ('3ad71c3e-ed00-4140-a414-50c6a27d988a', 'Siren: The Beginning of the Curse', 'nenhuma evidência independente persistida'),
  ('453a42dc-fd17-4d33-83f1-fb15df252e2b', 'Spring Amidst My Wintertide', 'nenhuma evidência independente persistida'),
  ('3565d4b2-2b4d-406a-86e2-a96aafc00b6e', 'Tears on a Withered Flower', 'nenhuma evidência independente persistida'),
  ('72f1d322-2711-467f-950d-0316177ccfef', 'The Armored Prince''s Awkward Love', 'nenhuma evidência independente persistida'),
  ('c48560ec-449b-440b-848c-28287273d35f', 'The Ash Salmon Quenches the Beast Monarch''s Desire', 'nenhuma evidência independente persistida'),
  ('a252edbc-366e-43e9-ad94-19431247a69a', 'The Demon King Wants Peace', 'nenhuma evidência independente persistida'),
  ('e9b69112-b784-4adf-bbfb-865c9209c100', 'The Destroyer Fell in Love With Me', 'nenhuma evidência independente persistida'),
  ('6cf21eda-5443-411c-852c-cc71186e0c88', 'The Evil Girl Is the Emperor', 'nenhuma evidência independente persistida'),
  ('3f98982e-f546-4836-a6d3-d0de0041fec5', 'The Heat of the Reincarnated Villainess', 'nenhuma evidência independente persistida'),
  ('110b1d9f-0d0e-455c-a1a0-f3e53558b8b9', 'The Hidden Muse', 'nenhuma fonte; leitores: ''WHY IS THIS NOT AN R19?'''),
  ('abfb869a-82b6-41f9-86ea-ed096126faf2', 'The Princess and the Fool', 'nenhuma evidência independente persistida'),
  ('8a8b22eb-9bf1-4a0a-927b-be91af6f8684', 'The Problematic Prince', 'evidência CONTRÁRIA: curadoria marcou ''R15 but Based on a R19 Novel'' (o R19 é do novel)'),
  ('bce69f10-1f64-4df5-a0d7-7e9a277a443f', 'The Red Empress', 'nenhuma evidência independente persistida'),
  ('32364e1e-6579-46b1-b2c6-e42f763124d4', 'Try Crying Prettier', 'nenhuma evidência independente persistida'),
  ('9db0aa16-08a8-4a15-8335-aaf8cc788917', 'Viscount Wants to Go to the Mill', 'nenhuma evidência independente persistida'),
  ('b6a3fb16-da4e-44de-a5d8-369ff7b5108b', 'Vivian''s Circumstances', 'nenhuma evidência independente persistida'),
  ('857c238a-b0fd-4cda-85d7-4286ee12408b', 'Wait, My Fiancé and Childhood Friend Is This Handsome!?', 'nenhuma evidência independente persistida'),
  ('f6049216-c763-40de-8740-badc4df02f64', 'What You Wish For', 'nenhuma evidência independente persistida');

-- ── 1) Guardas de ENTRADA ──────────────────────────────────────────────────────────────────
do $guarda$
declare n int; n_lista int; n_inj int; n_outro int; lista text;
begin
  select count(*) into n_lista from mig211_remover;

  if to_regclass('bkp.mig210_works_antes') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tags' and column_name = 'enrichment_status') then
    raise exception 'mig 211: a 210 não foi aplicada aqui (a régua de tag forte depende dela); abortando';
  end if;

  if not exists (select 1 from public.tags where slug = 'r19' and name = 'R19' and adult_indicator_strong) then
    raise exception 'mig 211: tag R19 (slug r19, forte) não encontrada como esperado; abortando';
  end if;

  select count(*) into n from public.works w join mig211_remover r on r.work_id = w.id and r.titulo = w.title;
  if n <> n_lista then raise exception 'mig 211: esperava as % obras com o título esperado, casaram %; abortando', n_lista, n; end if;

  -- Vínculo R19 dessas obras: ou é o injetado (1ª execução) ou não existe (re-execução). Outro = recriado.
  select count(*) filter (where wt.source is null and wt.created_at >= '2026-07-09 03:49:00+00' and wt.created_at < '2026-07-09 03:50:00+00'),
         count(*) filter (where not (wt.source is null and wt.created_at >= '2026-07-09 03:49:00+00' and wt.created_at < '2026-07-09 03:50:00+00'))
    into n_inj, n_outro
    from mig211_remover r join public.work_tags wt on wt.work_id = r.work_id join public.tags t on t.id = wt.tag_id and t.slug = 'r19';
  if n_outro > 0 then raise exception 'mig 211: % vínculo(s) R19 dessas obras NÃO são o injetado (alguém revinculou); abortando', n_outro; end if;
  if n_inj not in (0, n_lista) then raise exception 'mig 211: estado misto (% de % vínculos injetados ainda presentes); conferir à mão; abortando', n_inj, n_lista; end if;

  -- A premissa: nenhuma ganhou evidência independente desde a auditoria.
  select string_agg(r.titulo, ' · ' order by r.titulo) into lista
    from mig211_remover r join public.works w on w.id = r.work_id
   where w.edition_state in ('mixed', 'r18_only', 'unknown')
      or exists (select 1 from public.work_edition_state es where es.work_id = r.work_id and es.state in ('mixed', 'r18_only', 'unknown'))
      or exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id
                  where wt.work_id = r.work_id and t.slug <> 'r19' and t.adult_indicator_strong)
      or exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id
                  where wt.work_id = r.work_id and t.slug in ('r19-version', 'r18-r19', 'r19-disponivel'))
      or exists (select 1 from public.work_synopses s
                  where s.work_id = r.work_id and s.text ~* '(\mR-?1[89]\M|\m1[89]\+|uncensored|sem censura)');
  if lista is not null then raise exception 'mig 211: obra(s) da lista ganharam evidência de R19/explícito desde a auditoria — reclassificar: %', lista; end if;
end
$guarda$;

-- ── 2) Retratos de ANTES (guardas de saída) e backup para o rollback ──────────────────────
drop table if exists pg_temp.mig211_works_antes_t;
create temp table mig211_works_antes_t on commit drop as
  select id, adult_auto, adult_reason, adult_override, edition_state, r19_edition, is_adult from public.works;
drop table if exists pg_temp.mig211_hashes;
create temp table mig211_hashes on commit drop as select
  (select md5(coalesce(string_agg(concat_ws('|', work_id, criterion_slug, score, source, ai_evaluation_id), ',' order by work_id, criterion_slug), '')) from public.category_scores) cs,
  -- work_tags SEM os vínculos que esta migration pode apagar: tem de bater depois.
  (select md5(coalesce(string_agg(concat_ws('|', wt.work_id, wt.tag_id, wt.source, wt.confidence), ',' order by wt.work_id, wt.tag_id), ''))
     from public.work_tags wt join public.tags t on t.id = wt.tag_id
    where not (t.slug = 'r19' and wt.work_id in (select work_id from mig211_remover))) wt_resto,
  (select md5(coalesce(string_agg(concat_ws('|', work_id, state, basis, decided_by), ',' order by work_id), '')) from public.work_edition_state) es,
  (select md5(coalesce(string_agg(concat_ws('|', slug, name, tag_group_id, tag_subgroup_id, adult_indicator, adult_indicator_strong, adult_score_tier, marks_r19_edition), ',' order by slug), '')) from public.tags) tags,
  (select md5(coalesce(string_agg(concat_ws('|', alias_slug, canonical_tag_id), ',' order by alias_slug), '')) from public.tag_alias) alias;

create schema if not exists bkp;
create table if not exists bkp.mig211_r19_vinculos (
  work_id uuid primary key, tag_id uuid not null, source text, confidence real, created_at timestamptz not null,
  titulo text not null, motivo text not null, salvo_em timestamptz not null default now()
);
create table if not exists bkp.mig211_works_antes (
  work_id uuid primary key, adult_auto boolean not null, adult_reason text,
  adult_auto_depois boolean not null, adult_reason_depois text, causa text not null,
  salvo_em timestamptz not null default now()
);
comment on table bkp.mig211_r19_vinculos is 'mig 211: os vínculos R19 injetados pela nota (scripts/tag-r19-adult.ts, 2026-07-09) que foram apagados por não terem confirmação independente. Usado por scripts/rollback/211_rollback.sql.';
comment on table bkp.mig211_works_antes is 'mig 211: adult_auto/adult_reason das obras recalculadas depois de apagar o R19 injetado, antes e depois. Usado pelo rollback.';

insert into bkp.mig211_r19_vinculos (work_id, tag_id, source, confidence, created_at, titulo, motivo)
select wt.work_id, wt.tag_id, wt.source, wt.confidence, wt.created_at, r.titulo, r.motivo
  from mig211_remover r join public.work_tags wt on wt.work_id = r.work_id join public.tags t on t.id = wt.tag_id and t.slug = 'r19'
on conflict (work_id) do nothing;

-- ── 3) O PLANO: a régua da 210 (≥1 tag forte), olhando as tags que FICAM ───────────────────
drop table if exists pg_temp.mig211_plano;
create temp table mig211_plano on commit drop as
with s as (
  select w.id, w.adult_auto, w.adult_reason,
    exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id
             where wt.work_id = w.id and t.adult_indicator_strong and t.slug <> 'r19') as forte_depois
  from public.works w join mig211_remover r on r.work_id = w.id
),
d as (
  select s.*, case
      when coalesce(s.adult_reason, '') = 'ai_review' then null
      when s.forte_depois and not (s.adult_auto and s.adult_reason = 'tag_explicit') then 'liga'
      when not s.forte_depois and s.adult_auto and s.adult_reason in ('tag_explicit', 'tag_soft_score') then 'desliga'
    end as acao
  from s
)
select id, adult_auto as auto_antes, adult_reason as motivo_antes, (acao = 'liga') as auto_depois,
       case when acao = 'liga' then 'tag_explicit' end as motivo_depois,
       'R19 injetado pela nota removido; nenhuma outra tag forte' as causa
  from d where acao is not null;

do $guarda$
declare n int;
begin
  select count(*) into n from mig211_plano where auto_depois;
  if n > 0 then raise exception 'mig 211: o plano LIGARIA % obra(s) — apagar vínculo nunca liga o gate; abortando', n; end if;
end
$guarda$;

-- ── 4) Aplicar ──────────────────────────────────────────────────────────────────────────────
insert into bkp.mig211_works_antes (work_id, adult_auto, adult_reason, adult_auto_depois, adult_reason_depois, causa)
select id, auto_antes, motivo_antes, auto_depois, motivo_depois, causa from mig211_plano
on conflict (work_id) do nothing;

delete from public.work_tags wt using public.tags t, mig211_remover r
 where t.id = wt.tag_id and t.slug = 'r19' and wt.work_id = r.work_id
   and wt.source is null and wt.created_at >= '2026-07-09 03:49:00+00' and wt.created_at < '2026-07-09 03:50:00+00';

update public.works w set adult_auto = p.auto_depois, adult_reason = p.motivo_depois
  from mig211_plano p where w.id = p.id;

-- ── 5) Guardas de SAÍDA ─────────────────────────────────────────────────────────────────────
do $guarda$
declare n int; n_ovr int; n_es int; n_r19 int; h record;
begin
  select count(*) into n from mig211_remover r join public.work_tags wt on wt.work_id = r.work_id join public.tags t on t.id = wt.tag_id and t.slug = 'r19';
  if n > 0 then raise exception 'mig 211: % obra(s) da lista ainda com R19', n; end if;

  select count(*) into n from public.works w join mig211_remover r on r.work_id = w.id
   where coalesce(w.adult_reason, '') <> 'ai_review'
     and (w.adult_auto is distinct from exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id
                                                 where wt.work_id = w.id and t.adult_indicator_strong));
  if n > 0 then raise exception 'mig 211: % obra(s) com adult_auto fora da regra (≥1 tag forte)', n; end if;

  select count(*) into n from mig211_works_antes_t a join public.works w on w.id = a.id
   where (w.adult_auto, w.adult_reason) is distinct from (a.adult_auto, a.adult_reason)
     and a.id not in (select id from mig211_plano);
  if n > 0 then raise exception 'mig 211: % obra(s) FORA do plano mudaram de adult_auto/adult_reason', n; end if;

  select count(*) filter (where w.adult_override is distinct from a.adult_override),
         count(*) filter (where w.edition_state is distinct from a.edition_state),
         count(*) filter (where w.r19_edition is distinct from a.r19_edition)
    into n_ovr, n_es, n_r19 from mig211_works_antes_t a join public.works w on w.id = a.id;
  if n_ovr > 0 or n_es > 0 or n_r19 > 0 then
    raise exception 'mig 211: mexeu em override (%), edition_state (%) ou r19_edition (%)', n_ovr, n_es, n_r19;
  end if;

  select * into h from mig211_hashes;
  if h.cs is distinct from (select md5(coalesce(string_agg(concat_ws('|', work_id, criterion_slug, score, source, ai_evaluation_id), ',' order by work_id, criterion_slug), '')) from public.category_scores) then
    raise exception 'mig 211: category_scores mudou — esta migration não pode tocar nota';
  end if;
  if h.wt_resto is distinct from (select md5(coalesce(string_agg(concat_ws('|', wt.work_id, wt.tag_id, wt.source, wt.confidence), ',' order by wt.work_id, wt.tag_id), ''))
       from public.work_tags wt join public.tags t on t.id = wt.tag_id
      where not (t.slug = 'r19' and wt.work_id in (select work_id from mig211_remover))) then
    raise exception 'mig 211: um vínculo FORA dos R19 da lista mudou';
  end if;
  if h.es is distinct from (select md5(coalesce(string_agg(concat_ws('|', work_id, state, basis, decided_by), ',' order by work_id), '')) from public.work_edition_state) then
    raise exception 'mig 211: work_edition_state mudou';
  end if;
  if h.tags is distinct from (select md5(coalesce(string_agg(concat_ws('|', slug, name, tag_group_id, tag_subgroup_id, adult_indicator, adult_indicator_strong, adult_score_tier, marks_r19_edition), ',' order by slug), '')) from public.tags) then
    raise exception 'mig 211: uma tag mudou — esta migration não classifica tag';
  end if;
  if h.alias is distinct from (select md5(coalesce(string_agg(concat_ws('|', alias_slug, canonical_tag_id), ',' order by alias_slug), '')) from public.tag_alias) then
    raise exception 'mig 211: tag_alias mudou';
  end if;

  raise notice 'mig 211: % vínculos R19 injetados apagados (lista de %) · obras recalculadas % · is_adult: % entram, % saem',
    (select count(*) from bkp.mig211_r19_vinculos), (select count(*) from mig211_remover), (select count(*) from mig211_plano),
    (select count(*) from mig211_works_antes_t a join public.works w on w.id = a.id where not a.is_adult and w.is_adult),
    (select count(*) from mig211_works_antes_t a join public.works w on w.id = a.id where a.is_adult and not w.is_adult);
end
$guarda$;

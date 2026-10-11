#!/usr/bin/env node
/**
 * TESTE DE BANCO das migrations 210 (tags adultas: classificação, aliases, proveniência do enriquecimento,
 * gate só por tag forte), 211 (vínculos R19 que a nota inventou) e 212 (Smut/Pornographic por evidência
 * auditada) —
 * ALVO: um RETRATO DESCARTÁVEL da nuvem no Postgres LOCAL, US$0, nada persiste.
 *
 *   npm run test:db-tags-adultas
 *   node scripts/tags-adultas-db.mjs [--banco=retrato_tags]
 *
 * O retrato sai de `scripts/retrato-local-de-backup.mjs <backup> retrato_tags --aplicar=204,205`
 * (a 210 depende de tags que só existem no estado ATUAL da nuvem: as 4 de 2026-10-08, Sex Toy/s com
 * piso explicit…). Sem o banco, isto FALHA com a linha de comando — não pula calado.
 *
 * 🔴 TUDO em transações que terminam em ROLLBACK. Confere:
 *   · as 108 tags, os 28 aliases, a tag nova "Mature" e as 4 tags de 08/10 no estado decidido;
 *   · D4 citadas, Big Penis e Pubic Hair não ligam o gate; as 5 residuais das mixed como decidido;
 *   · 211: só os 49 R19 `script_only` saem; confirmados e ambíguos ficam; a nota não entra;
 *   · 212: Smut nas 10 e Pornographic nas 2, com procedência; nenhum override; nada fora delas muda;
 *   · a regra do gate é "≥1 tag forte": tag fraca + nota 7 ou 10 NÃO liga; tag forte rebaixada desliga;
 *     `ai_review` (evidência independente) não é tocado; toda obra termina coerente com a regra;
 *   · `adult_override` vence, `edition_state` (mixed) continua mandando no `is_adult`;
 *   · nota, vínculos, estado de edição e tags fora dos conjuntos intocados;
 *   · idempotência de cada uma e rollback (212 → 211 → 210) devolvendo o estado exato, mais o rollback
 *     isolado da 210;
 * e sessões separadas provam que as guardas de ENTRADA das duas abortam.
 */
import { spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const banco = process.argv.find((a) => a.startsWith("--banco="))?.split("=")[1] ?? "retrato_tags"
if (!/^[a-z0-9_]+$/.test(banco) || banco === "postgres") {
  console.error(`🔴 banco recusado: ${banco} (o teste roda num RETRATO descartável, nunca no 'postgres' do app local)`)
  process.exit(1)
}
const LOCAL = `postgresql://postgres:postgres@127.0.0.1:54322/${banco}`
const MIGRATION = path.join(ROOT, "supabase/migrations/210_tags_adultas_coerencia.sql")
const ROLLBACK = path.join(ROOT, "scripts/rollback/210_rollback.sql")
const MIGRATION_211 = path.join(ROOT, "supabase/migrations/211_r19_injetado_pela_nota.sql")
const ROLLBACK_211 = path.join(ROOT, "scripts/rollback/211_rollback.sql")
const MIGRATION_212 = path.join(ROOT, "supabase/migrations/212_sinal_forte_por_evidencia_auditada.sql")
const ROLLBACK_212 = path.join(ROOT, "scripts/rollback/212_rollback.sql")
const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`)

/** Obra ativa "limpa": sem nenhuma tag com sinal 18+ ou piso, sem override, fora de mixed/r18/unknown. */
const LIMPA = `select w.id from public.works w
  where not w.is_archived and w.adult_override is null and coalesce(w.edition_state, 'single') = 'single'
    and not exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id
                     where wt.work_id = w.id and (t.adult_indicator or t.adult_score_tier is not null or t.marks_r19_edition))`

const MONTA = `
create temp table t_cenario (cen text primary key, work_id uuid not null) on commit drop;
do $monta$
declare v uuid;
begin
  -- Sintéticas (estado montado aqui e desfeito no ROLLBACK).
  select id into v from (${LIMPA} order by w.id limit 1) x;
  insert into t_cenario values ('forte_nova_liga', v);
  insert into public.work_tags (work_id, tag_id, source) select v, id, 'teste-210' from public.tags where slug = 'sex-toy-s';
  update public.works set adult_auto = false, adult_reason = null where id = v;

  select id into v from (${LIMPA} order by w.id offset 1 limit 1) x;
  insert into t_cenario values ('forte_vence_segunda_opiniao_limpa', v);
  insert into public.work_tags (work_id, tag_id, source) select v, id, 'teste-210' from public.tags where slug = 'sex-toy-s';
  update public.works set adult_auto = false, adult_reason = 'ai_review_clean' where id = v;

  select id into v from (${LIMPA} order by w.id offset 2 limit 1) x;
  insert into t_cenario values ('override_vence', v);
  insert into public.work_tags (work_id, tag_id, source) select v, id, 'teste-210' from public.tags where slug = 'prostitution';
  update public.works set adult_auto = true, adult_reason = 'tag_explicit', adult_override = true where id = v;

  -- Fraca + nota 7 e fraca + nota 10: NÃO ligam (a nota é montada aqui, antes do retrato da migration).
  select id into v from (${LIMPA} order by w.id offset 3 limit 1) x;
  insert into t_cenario values ('fraca_nota_7_nao_liga', v);
  insert into public.work_tags (work_id, tag_id, source) select v, id, 'teste-210' from public.tags where slug = 'sexual-content';
  insert into public.category_scores (work_id, criterion_slug, score, source) values (v, 'adult_content', 7, 'manual')
    on conflict (work_id, criterion_slug) do update set score = 7;
  update public.works set adult_auto = false, adult_reason = null where id = v;

  select id into v from (${LIMPA} order by w.id offset 4 limit 1) x;
  insert into t_cenario values ('fraca_nota_10_nao_liga', v);
  insert into public.work_tags (work_id, tag_id, source) select v, id, 'teste-210' from public.tags where slug in ('sexual-content', 'adult', 'nudity');
  insert into public.category_scores (work_id, criterion_slug, score, source) values (v, 'adult_content', 10, 'manual')
    on conflict (work_id, criterion_slug) do update set score = 10;
  update public.works set adult_auto = false, adult_reason = null where id = v;

  select w.id into v from public.works w where w.edition_state = 'mixed' and w.adult_override is null order by w.id limit 1;
  insert into t_cenario values ('mixed_continua_normal', v);
  insert into public.work_tags (work_id, tag_id, source) select v, id, 'teste-210' from public.tags where slug = 'sex-toy-s'
  on conflict do nothing;

  -- ai_review + tag forte: o motivo (evidência independente) é preservado, não reescrito.
  select id into v from (${LIMPA} order by w.id offset 5 limit 1) x;
  insert into t_cenario values ('ai_review_com_forte_preserva_motivo', v);
  insert into public.work_tags (work_id, tag_id, source) select v, id, 'teste-210' from public.tags where slug = 'facial';
  update public.works set adult_auto = true, adult_reason = 'ai_review' where id = v;

  -- D4 e anatomia genital, SOZINHAS, ligavam o gate; depois da 210 não ligam.
  select id into v from (${LIMPA} order by w.id offset 6 limit 1) x;
  insert into t_cenario values ('d4_necrophilia_nao_liga', v);
  insert into public.work_tags (work_id, tag_id, source) select v, id, 'teste-210' from public.tags where slug = 'necrophilia';
  update public.works set adult_auto = true, adult_reason = 'tag_explicit' where id = v;

  select id into v from (${LIMPA} order by w.id offset 7 limit 1) x;
  insert into t_cenario values ('big_penis_nao_liga', v);
  insert into public.work_tags (work_id, tag_id, source) select v, id, 'teste-210' from public.tags where slug = 'big-penis';
  update public.works set adult_auto = true, adult_reason = 'tag_explicit' where id = v;

  select id into v from (${LIMPA} order by w.id offset 8 limit 1) x;
  insert into t_cenario values ('pubic_hair_nao_liga', v);
  insert into public.work_tags (work_id, tag_id, source) select v, id, 'teste-210' from public.tags where slug = 'pubic-hair';
  update public.works set adult_auto = true, adult_reason = 'tag_explicit' where id = v;

  -- Só as residuais que viraram fracas (Realistic Breasts, Condom/s) + nota 9: não liga.
  select id into v from (${LIMPA} order by w.id offset 9 limit 1) x;
  insert into t_cenario values ('residuais_fracas_nao_ligam', v);
  insert into public.work_tags (work_id, tag_id, source) select v, id, 'teste-210' from public.tags where slug in ('realistic-breasts', 'condom-s', 'blindfold');
  insert into public.category_scores (work_id, criterion_slug, score, source) values (v, 'adult_content', 9, 'manual')
    on conflict (work_id, criterion_slug) do update set score = 9;
  update public.works set adult_auto = false, adult_reason = null where id = v;

  -- Reais (o retrato da nuvem), uma por causa.
  insert into t_cenario select 'regra_removida_sai', id from public.works where title = 'Samo';
  insert into t_cenario select 'forte_rebaixada_sai_anatomia', id from public.works where title = 'Wotakoi: Love Is Hard for Otaku';
  insert into t_cenario select 'east_wind_sai', id from public.works where title = 'The East Wind of the Altas';
  insert into t_cenario select 'housekeeper_sai', id from public.works where title = 'I Was Reborn as a Housekeeper in a Parallel World!';
  insert into t_cenario select 'so_troca_motivo', id from public.works where title = 'Love Potion Panic';
  insert into t_cenario select 'fraca_nota_9_real_continua_fora', id from public.works where title = 'The Young Lady Has a Vulgar Secret';
  insert into t_cenario select 'ai_review_intocado', id from public.works where title = 'The Tainted Saintess';
  -- 211: uma por classe da auditoria R19 (vínculo injetado pela nota em 2026-07-09).
  insert into t_cenario select 'r19_confirmado_mixed', id from public.works where title = 'A Winter Cabin of Serenity and Insanity';
  insert into t_cenario select 'r19_confirmado_r18_only', id from public.works where title = 'A Lady''s Risqué Hobby';
  insert into t_cenario select 'r19_confirmado_descricao', id from public.works where title = 'The Queen''s Secret Lessons';
  insert into t_cenario select 'r19_ambiguo_outra_forte', id from public.works where title = 'A Foxy Affair';
  insert into t_cenario select 'r19_ambiguo_leitor', id from public.works where title = 'Beatrice';
  insert into t_cenario select 'r19_ambiguo_fontes', id from public.works where title = 'Rod of Love';
  insert into t_cenario select 'r19_ambiguo_fonte_porn', id from public.works where title = 'The Magicians';
  insert into t_cenario select 'r19_script_only', id from public.works where title = 'A Butterfly Through the Mist';
  insert into t_cenario select 'r19_script_only_contrario', id from public.works where title = 'The Problematic Prince';
  insert into t_cenario select 'r19_script_only_nota_9', id from public.works where title = 'My First XXX: The Marquess Is Wild for His Princess';
  if (select count(*) from t_cenario) <> 28 then raise exception 'preparo: % cenários (esperava 28)', (select count(*) from t_cenario); end if;
end
$monta$;

create temp table t_works_pre on commit drop as select id, adult_auto, adult_reason, adult_override, edition_state, is_adult from public.works;
create temp table t_tags_pre on commit drop as
  select slug, name, tag_group_id, tag_subgroup_id, adult_indicator, adult_indicator_strong, adult_score_tier, adult_score_tier_reviewed_at from public.tags;
create temp table t_alias_pre on commit drop as select a.alias_slug, t.slug destino from public.tag_alias a join public.tags t on t.id = a.canonical_tag_id;
create temp table t_notas_pre on commit drop as select work_id, criterion_slug, score, source from public.category_scores;
create temp table t_vinc_pre on commit drop as select work_id, tag_id from public.work_tags;`

const confere = (caso, cond) => `
  if not (${cond}) then raise exception using errcode = 'P9999', message = 'FALHOU: ' || ${q(caso)}; end if;
  raise notice 'ok · %', ${q(caso)};`

const obra = (cen, cond) =>
  `exists (select 1 from public.works w join t_cenario c on c.work_id = w.id where c.cen = ${q(cen)} and ${cond})`
const alias = (a, destino) =>
  destino == null
    ? `not exists (select 1 from public.tag_alias where alias_slug = ${q(a)})`
    : `exists (select 1 from public.tag_alias x join public.tags t on t.id = x.canonical_tag_id where x.alias_slug = ${q(a)} and t.slug = ${q(destino)})`
const sinal = (slugs, ind, strong) =>
  `(select count(*) from public.tags where slug in (${slugs.map(q).join(",")}) and adult_indicator = ${ind} and adult_indicator_strong = ${strong}) = ${slugs.length}`
const DEFAULT_PENDING = "(select column_default from information_schema.columns where table_schema = 'public' and table_name = 'tags' and column_name = 'enrichment_status') like " + q("'pending'%")

const ASSERCOES = `
do $teste$
begin
  ${confere("Sex Toy/s, Strap-On e Facial ligam sozinhas (piso explicit mantido)", sinal(["sex-toy-s", "strap-on", "facial"], true, true) + " and (select count(*) from public.tags where slug in ('sex-toy-s','strap-on','facial') and adult_score_tier = 'explicit') = 3")}
  ${confere("D1 circunstância/posição deixa de ser forte (Doggy Style, Outdoor, Public Sex, Missionary…)", sinal(["doggy-style", "outdoor-intercourse", "public-sex", "missionary-position", "school-intercourse", "toilet-intercourse", "balcony-sex"], true, false))}
  ${confere("D1 que já não ligava continua sem sinal (First-Time, Drunken, Office Intercourse)", sinal(["first-time-intercourse", "drunken-intercourse", "office-intercourse"], false, false))}
  ${confere("D2a: Nudity, Fetish/es, Lust viram sinal fraco", sinal(["nudity", "fetish-es", "lust"], true, false))}
  ${confere("D2b: traço/enredo/ocupação sem sinal (Prostitution, Horny Character/s, Brothel/s, Sexually Active Protagonist)", sinal(["prostitution", "horny-character-s", "brothel-s", "sexually-active-protagonist"], false, false))}
  ${confere("D3: Big Breasts, Big Areolae, Inverted Nipples deixam de ser fortes", sinal(["big-breasts", "big-areolae", "inverted-nipples"], true, false))}
  ${confere("anatomia genital: Big Penis e Pubic Hair viram fracas (não ligam o gate)", sinal(["big-penis", "pubic-hair"], true, false))}
  ${confere("D5/D6: Whipping, Tentacles, Impregnation, Gagged, Voyeurism forte → fraca", sinal(["whipping", "tentacles", "impregnation", "gagged", "voyeurism"], true, false))}
  ${confere("D4 citadas viram fracas: Necrophilia, Somnophilia, Sleep Intercourse, Bestiality, Cousin Incest", sinal(["necrophilia", "somnophilia", "sleep-intercourse", "bestiality", "cousin-cousin-incest"], true, false) + " and exists (select 1 from public.tags where slug = 'bestiality' and adult_score_tier = 'explicit')")}
  ${confere("D4 NÃO citadas ficam como estavam (Incest, Twincest, Brother-Sister Incest sem sinal)", sinal(["incest", "twincest", "brother-sister-incest"], false, false))}
  ${confere("residuais: Realistic Breasts e Condom/s = fraca; Big-Breasted Female Lead, Blindfold e Asphyxiation = sem sinal", sinal(["realistic-breasts", "condom-s"], true, false) + " and " + sinal(["big-breasted-female-lead", "blindfold", "asphyxiation"], false, false))}
  ${confere("nenhuma tag forte entre as D4 citadas, a anatomia genital e as residuais", "not exists (select 1 from public.tags where adult_indicator_strong and slug in ('necrophilia','somnophilia','sleep-intercourse','bestiality','cousin-cousin-incest','big-penis','pubic-hair','realistic-breasts','big-breasted-female-lead','condom-s','blindfold','asphyxiation'))")}
  ${confere("as 108 tags levam a proveniência 'curated' com o motivo (+ Mature)", "(select count(*) from public.tags where enrichment_status = 'curated' and enrichment_detail like 'mig 210:%') = 109")}
  ${confere("alias smut → Smut e hentai → Hentai", alias("smut", "smut") + " and " + alias("hentai", "hentai"))}
  ${confere("ecchi NÃO vira Smut (vai para Ecchi) e erotica vai para Erotica", alias("ecchi", "ecchi") + " and " + alias("erotica", "erotica"))}
  ${confere("mature vai para a tag nova Mature, sem sinal 18+ e sem piso", alias("mature", "mature") + " and exists (select 1 from public.tags where slug = 'mature' and not adult_indicator and not adult_indicator_strong and adult_score_tier is null)")}
  ${confere("aliases que inventavam ato: removidos", ["multiple-sexual-partners", "urination", "exhibitionism", "rimjob"].map((a) => alias(a, null)).join(" and "))}
  ${confere("r15 não inventa 'baseado em novel R19' (alias removido)", alias("r15", null))}
  ${confere("nakadashi → Nakadashi / Creampie e orgy → Orgy/ies", alias("nakadashi", "nakadashi-creampie") + " and " + alias("orgy", "orgy-ies"))}
  ${confere("alias de conceito RELACIONADO sai: submission ≠ BDSM, spanking ≠ Whipping, dubious-consent ≠ Sexual Abuse, choking ≠ Asphyxiation", ["submission", "spanking", "dubious-consent", "choking"].map((a) => alias(a, null)).join(" and "))}
  ${confere("aliases de sentido INVERTIDO saem: 'added censorship' ≠ 'Uncensored Version Available'; vítima ≠ agressor", alias("english-company-added-censorship", null) + " and " + alias("abused-family-member-s", null))}
  ${confere("os outros 10 aliases relacionados também saem (erotic-asphyxiation, erotic-torture, abuse, child-abuse, stockings, tail-plug, nipple-*, sex-friends…, sexual-curiosity)", ["erotic-asphyxiation", "erotic-torture", "abuse", "child-abuse", "stockings", "tail-plug", "nipple-piercing-s", "nipple-play", "sex-friends-become-lovers", "sexual-curiosity"].map((a) => alias(a, null)).join(" and "))}
  ${confere("nenhum outro alias mudou", "not exists (select 1 from t_alias_pre p left join public.tag_alias a on a.alias_slug = p.alias_slug left join public.tags t on t.id = a.canonical_tag_id where p.alias_slug not in (select alias_slug from pg_temp.mig210_aliases) and t.slug is distinct from p.destino)")}
  ${confere("as 4 tags de 08/10 sem grupo falso, sem marca de revisão, provider_not_called", "(select count(*) from public.tags where slug in ('mouse-girl-s','prehistoric-ambience','rabbitbeast-s','catbeast-s') and tag_group_id is null and adult_score_tier_reviewed_at is null and enrichment_status = 'provider_not_called') = 4")}
  ${confere("toda tag que já existia (e não foi tocada) vira legacy", "not exists (select 1 from public.tags t join t_tags_pre p using (slug) where t.enrichment_status <> 'legacy' and t.slug not in (select slug from pg_temp.mig210_tags union all select slug from pg_temp.mig210_falsas))")}
  ${confere("tag nova nasce pending (default da coluna)", DEFAULT_PENDING)}

  ${confere("tag forte nova liga o gate", obra("forte_nova_liga", "w.adult_auto and w.adult_reason = 'tag_explicit' and w.is_adult"))}
  ${confere("tag forte vence a 2ª opinião 'limpo' (que só olhou sinais fracos)", obra("forte_vence_segunda_opiniao_limpa", "w.adult_auto and w.adult_reason = 'tag_explicit'"))}
  ${confere("tag fraca + nota 7 NÃO liga", obra("fraca_nota_7_nao_liga", "not w.adult_auto and not w.is_adult"))}
  ${confere("tags fracas + nota 10 NÃO ligam", obra("fraca_nota_10_nao_liga", "not w.adult_auto and not w.is_adult"))}
  ${confere("override vence: o auto desliga, o is_adult continua true", obra("override_vence", "not w.adult_auto and w.adult_reason is null and w.adult_override and w.is_adult"))}
  ${confere("mixed: continua fora do 18+ e o edition_state não muda", obra("mixed_continua_normal", "not w.is_adult and w.edition_state = 'mixed'"))}
  ${confere("regra removida: obra que só era 18+ por tag fraca + nota sai (Samo)", obra("regra_removida_sai", "not w.adult_auto and w.adult_reason is null and not w.is_adult"))}
  ${confere("tag forte rebaixada desliga o gate (Wotakoi: só Big Breasts)", obra("forte_rebaixada_sai_anatomia", "not w.adult_auto and not w.is_adult"))}
  ${confere("The East Wind of the Altas sai (só Prostitution forte a ligava)", obra("east_wind_sai", "not w.adult_auto and not w.is_adult"))}
  ${confere("Housekeeper sai (Prostitution forte + nota 7 levada pelo piso)", obra("housekeeper_sai", "not w.adult_auto and not w.is_adult"))}
  ${confere("motivo legado tag_soft_score com tag forte: só troca para tag_explicit", obra("so_troca_motivo", "w.adult_auto and w.adult_reason = 'tag_explicit' and w.is_adult"))}
  ${confere("fraca + nota 9 real (Young Lady…) continua fora: não é mais deriva", obra("fraca_nota_9_real_continua_fora", "not w.adult_auto and not w.is_adult"))}
  ${confere("motivo ai_review (evidência independente) não é tocado", obra("ai_review_intocado", "w.adult_auto and w.adult_reason = 'ai_review'"))}
  ${confere("ai_review com tag forte: o motivo é preservado (não vira tag_explicit)", obra("ai_review_com_forte_preserva_motivo", "w.adult_auto and w.adult_reason = 'ai_review'"))}
  ${confere("D4 sozinha (Necrophilia) não liga mais: o gate desliga", obra("d4_necrophilia_nao_liga", "not w.adult_auto and not w.is_adult"))}
  ${confere("Big Penis sozinha não liga mais", obra("big_penis_nao_liga", "not w.adult_auto and not w.is_adult"))}
  ${confere("Pubic Hair sozinha não liga mais", obra("pubic_hair_nao_liga", "not w.adult_auto and not w.is_adult"))}
  ${confere("residuais fracas (Realistic Breasts, Condom/s) + Blindfold + nota 9: não liga", obra("residuais_fracas_nao_ligam", "not w.adult_auto and not w.is_adult"))}

  ${confere("TODA obra fica coerente com a regra (≥1 tag forte), salvo ai_review", "not exists (select 1 from public.works w where coalesce(w.adult_reason,'') <> 'ai_review' and w.adult_auto is distinct from exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id where wt.work_id = w.id and t.adult_indicator_strong))")}
  ${confere("nenhuma nota mudou (category_scores inteira)", "not exists ((select work_id, criterion_slug, score, source from public.category_scores) except (select * from t_notas_pre)) and not exists ((select * from t_notas_pre) except (select work_id, criterion_slug, score, source from public.category_scores))")}
  ${confere("nenhum vínculo mudou", "not exists ((select work_id, tag_id from public.work_tags) except (select * from t_vinc_pre)) and not exists ((select * from t_vinc_pre) except (select work_id, tag_id from public.work_tags))")}
  ${confere("override e edition_state intocados em TODAS as obras", "not exists (select 1 from public.works w join t_works_pre p using (id) where (w.adult_override, w.edition_state) is distinct from (p.adult_override, p.edition_state))")}
  ${confere("adult_score_tier intocado em TODAS as tags", "not exists (select 1 from public.tags t join t_tags_pre p using (slug) where t.adult_score_tier is distinct from p.adult_score_tier)")}
  ${confere("só obras do plano mudaram", "not exists (select 1 from public.works w join t_works_pre p using (id) where (w.adult_auto, w.adult_reason) is distinct from (p.adult_auto, p.adult_reason) and w.id not in (select work_id from bkp.mig210_works_antes))")}
end
$teste$;

create temp table t_works_pos1 on commit drop as select id, adult_auto, adult_reason from public.works;
create temp table t_tags_pos1 on commit drop as select slug, adult_indicator, adult_indicator_strong, tag_group_id, enrichment_status, enrichment_detail from public.tags;
create temp table t_alias_pos1 on commit drop as select alias_slug, canonical_tag_id from public.tag_alias;`

/** Retrato depois da 210, para a 211 provar que só mexe no que deve e que o rollback dela volta aqui. */
const RETRATO_POS210 = `
create temp table t_works_pos210 on commit drop as select id, adult_auto, adult_reason, adult_override, edition_state, is_adult from public.works;
create temp table t_vinc_pos210 on commit drop as select work_id, tag_id, source, confidence, created_at from public.work_tags;
create temp table t_notas_pos210 on commit drop as select work_id, criterion_slug, score, source from public.category_scores;
create temp table t_r19_injetado on commit drop as
  select wt.work_id from public.work_tags wt join public.tags t on t.id = wt.tag_id
  where t.slug = 'r19' and wt.source is null and wt.created_at >= '2026-07-09 03:49:00+00' and wt.created_at < '2026-07-09 03:50:00+00';`

const r19 = (cen, tem) => obra(cen, `${tem ? "" : "not "}exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id where wt.work_id = w.id and t.slug = 'r19')`)

const ASSERCOES_211 = `
do $teste$
begin
  ${confere("211 parte de 229 vínculos R19 injetados", "(select count(*) from t_r19_injetado) = 229")}
  ${confere("211: apaga exatamente os 49 script_only (e só R19)", "(select count(*) from bkp.mig211_r19_vinculos) = 49 and (select count(*) from t_vinc_pos210) - (select count(*) from public.work_tags) = 49 and not exists (select 1 from t_vinc_pos210 p join public.tags t on t.id = p.tag_id where t.slug <> 'r19' and not exists (select 1 from public.work_tags x where x.work_id = p.work_id and x.tag_id = p.tag_id))")}
  ${confere("211: os 180 injetados confirmados/ambíguos continuam", "(select count(*) from public.work_tags wt join public.tags t on t.id = wt.tag_id where t.slug = 'r19' and wt.work_id in (select work_id from t_r19_injetado)) = 180")}
  ${confere("R19 com evidência externa é preservado (mixed com edição R19 no MangaUpdates)", r19("r19_confirmado_mixed", true))}
  ${confere("R19 com evidência externa é preservado (r18_only auditada)", r19("r19_confirmado_r18_only", true))}
  ${confere("R19 com evidência externa é preservado (descrição da fonte lista o webtoon R19)", r19("r19_confirmado_descricao", true))}
  ${confere("ambíguo NÃO é removido (outra tag forte)", r19("r19_ambiguo_outra_forte", true))}
  ${confere("ambíguo NÃO é removido (só leitor afirma)", r19("r19_ambiguo_leitor", true))}
  ${confere("ambíguo NÃO é removido (fontes contraditórias)", r19("r19_ambiguo_fontes", true))}
  ${confere("ambíguo NÃO é removido (fonte classifica 'pornographic': The Magicians)", r19("r19_ambiguo_fonte_porn", true))}
  ${confere("R19 script-only é removido e a obra sai do 18+", r19("r19_script_only", false) + " and " + obra("r19_script_only", "not w.adult_auto and not w.is_adult"))}
  ${confere("R19 script-only com evidência contrária (R15 baseado em novel R19) é removido", r19("r19_script_only_contrario", false))}
  ${confere("a nota nunca entra: script-only com adult_content 9 sai do 18+", r19("r19_script_only_nota_9", false) + " and " + obra("r19_script_only_nota_9", "not w.is_adult and exists (select 1 from public.category_scores cs where cs.work_id = w.id and cs.criterion_slug = 'adult_content' and cs.score >= 9)"))}
  ${confere("211: TODA obra segue coerente com a regra (≥1 tag forte), salvo ai_review", "not exists (select 1 from public.works w where coalesce(w.adult_reason,'') <> 'ai_review' and w.adult_auto is distinct from exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id where wt.work_id = w.id and t.adult_indicator_strong))")}
  ${confere("211: nenhuma nota mudou", "not exists ((select work_id, criterion_slug, score, source from public.category_scores) except (select * from t_notas_pos210)) and not exists ((select * from t_notas_pos210) except (select work_id, criterion_slug, score, source from public.category_scores))")}
  ${confere("211: override e edition_state intocados (mixed segue fora do 18+, r18_only segue dentro)", "not exists (select 1 from public.works w join t_works_pos210 p using (id) where (w.adult_override, w.edition_state) is distinct from (p.adult_override, p.edition_state)) and " + obra("r19_confirmado_mixed", "not w.is_adult") + " and " + obra("r19_confirmado_r18_only", "w.is_adult"))}
  ${confere("211: só as obras do plano mudaram de gate, e nenhuma entrou", "not exists (select 1 from public.works w join t_works_pos210 p using (id) where (w.adult_auto, w.adult_reason) is distinct from (p.adult_auto, p.adult_reason) and w.id not in (select work_id from bkp.mig211_works_antes)) and not exists (select 1 from public.works w join t_works_pos210 p using (id) where w.is_adult and not p.is_adult)")}
end
$teste$;

create temp table t_vinc_pos211 on commit drop as select work_id, tag_id from public.work_tags;
create temp table t_works_pos211 on commit drop as select id, adult_auto, adult_reason from public.works;`

const IDEMPOTENTE_211 = `
do $teste$
begin
  ${confere("211 idempotente: vínculos e obras iguais na 2ª aplicação", "not exists ((select work_id, tag_id from public.work_tags) except (select * from t_vinc_pos211)) and (select count(*) from public.work_tags) = (select count(*) from t_vinc_pos211) and not exists (select 1 from public.works w join t_works_pos211 p using (id) where (w.adult_auto, w.adult_reason) is distinct from (p.adult_auto, p.adult_reason))")}
end
$teste$;`

const SMUT_212 = ["A Monster’s Mate", "A Taste for Being Treated Roughly", "Curse of the Saintess", "Is This Marriage Okay?",
  "My First XXX: The Marquess Is Wild for His Princess", "Prince Snow White Is Taken by the Queen", "Ring of Bondage - Confinement",
  "Solstice", "The Demon King Wants Peace", "The Saint Dreams of Secret Love"]
const PORN_212 = ["Samo", "Savage Witch"]
const lista = (ts) => ts.map(q).join(",")
const vinculadas = (ts, slug) => `(select count(*) from public.works w join public.work_tags wt on wt.work_id = w.id join public.tags t on t.id = wt.tag_id and t.slug = ${q(slug)} where w.title in (${lista(ts)}) and wt.source = 'curadoria')`

const RETRATO_POS211 = `
create temp table t_works_pos211b on commit drop as select id, adult_auto, adult_reason, adult_override, edition_state, is_adult from public.works;
create temp table t_vinc_pos211b on commit drop as select work_id, tag_id, source, confidence, created_at from public.work_tags;`

const ASSERCOES_212 = `
do $teste$
begin
  ${confere("212: Smut vinculado às 10 obras de evidência de gênero, com source 'curadoria'", `${vinculadas(SMUT_212, "smut")} = 10`)}
  ${confere("212: Pornographic SÓ em Samo e Savage Witch (não Smut)", `${vinculadas(PORN_212, "pornographic")} = 2 and ${vinculadas(PORN_212, "smut")} = 0 and (select count(*) from public.work_tags wt join public.tags t on t.id = wt.tag_id where t.slug = 'pornographic') = 2`)}
  ${confere("212: as 12 ficam 18+ pelo gate de tag forte (adult_auto, tag_explicit)", `(select count(*) from public.works where title in (${lista([...SMUT_212, ...PORN_212])}) and adult_auto and adult_reason = 'tag_explicit' and is_adult) = 12`)}
  ${confere("212: nenhum override criado (Siren incluída)", "not exists (select 1 from public.works w join t_works_pos211b p using (id) where w.adult_override is distinct from p.adult_override) and exists (select 1 from public.works where title = 'Siren: The Beginning of the Curse' and adult_override is null and not is_adult)")}
  ${confere("212: só os 12 vínculos novos; nenhum outro vínculo mudou", "(select count(*) from public.work_tags) - (select count(*) from t_vinc_pos211b) = 12 and not exists ((select * from t_vinc_pos211b) except (select work_id, tag_id, source, confidence, created_at from public.work_tags))")}
  ${confere("212: só as obras da lista mudaram de gate", "not exists (select 1 from public.works w join t_works_pos211b p using (id) where (w.adult_auto, w.adult_reason, w.is_adult) is distinct from (p.adult_auto, p.adult_reason, p.is_adult) and w.title not in (" + lista([...SMUT_212, ...PORN_212]) + "))")}
  ${confere("212: procedência registrada para as 12 (tag, evidência, auditoria, quem decidiu)", "(select count(*) from bkp.mig212_vinculos where evidencia <> '' and auditoria <> '' and decided_by like 'curadoria%') = 12")}
  ${confere("212: nenhuma nota mudou", "not exists ((select work_id, criterion_slug, score, source from public.category_scores) except (select * from t_notas_pos210)) and not exists ((select * from t_notas_pos210) except (select work_id, criterion_slug, score, source from public.category_scores))")}
  ${confere("212: edition_state intocado", "not exists (select 1 from public.works w join t_works_pos211b p using (id) where w.edition_state is distinct from p.edition_state)")}
  ${confere("212: TODA obra segue coerente com a regra (≥1 tag forte), salvo ai_review", "not exists (select 1 from public.works w where coalesce(w.adult_reason,'') <> 'ai_review' and w.adult_auto is distinct from exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id where wt.work_id = w.id and t.adult_indicator_strong))")}
end
$teste$;

create temp table t_vinc_pos212 on commit drop as select work_id, tag_id from public.work_tags;
create temp table t_works_pos212 on commit drop as select id, adult_auto, adult_reason from public.works;`

const IDEMPOTENTE_212 = `
do $teste$
begin
  ${confere("212 idempotente: vínculos e obras iguais na 2ª aplicação", "not exists ((select work_id, tag_id from public.work_tags) except (select * from t_vinc_pos212)) and (select count(*) from public.work_tags) = (select count(*) from t_vinc_pos212) and not exists (select 1 from public.works w join t_works_pos212 p using (id) where (w.adult_auto, w.adult_reason) is distinct from (p.adult_auto, p.adult_reason))")}
end
$teste$;`

const VOLTOU_212 = `
do $teste$
begin
  ${confere("rollback 212: os 12 vínculos saem e nada mais muda", "not exists ((select work_id, tag_id, source, confidence, created_at from public.work_tags) except (select * from t_vinc_pos211b)) and (select count(*) from public.work_tags) = (select count(*) from t_vinc_pos211b)")}
  ${confere("rollback 212: obras de volta ao estado pós-211", "not exists (select 1 from public.works w join t_works_pos211b p using (id) where (w.adult_auto, w.adult_reason, w.is_adult) is distinct from (p.adult_auto, p.adult_reason, p.is_adult))")}
  ${confere("rollback 212: backup removido", "to_regclass('bkp.mig212_vinculos') is null and to_regclass('bkp.mig212_works_antes') is null")}
end
$teste$;`

const VOLTOU_211 = `
do $teste$
begin
  ${confere("rollback 211: vínculos R19 de volta com source e created_at originais", "not exists ((select work_id, tag_id, source, confidence, created_at from public.work_tags) except (select * from t_vinc_pos210)) and (select count(*) from public.work_tags) = (select count(*) from t_vinc_pos210)")}
  ${confere("rollback 211: obras de volta ao estado pós-210", "not exists (select 1 from public.works w join t_works_pos210 p using (id) where (w.adult_auto, w.adult_reason, w.is_adult) is distinct from (p.adult_auto, p.adult_reason, p.is_adult))")}
  ${confere("rollback 211: backup removido", "to_regclass('bkp.mig211_r19_vinculos') is null and to_regclass('bkp.mig211_works_antes') is null")}
end
$teste$;`


const IDEMPOTENTE = `
do $teste$
begin
  ${confere("idempotente: obras iguais na 2ª aplicação", "not exists (select 1 from public.works w join t_works_pos1 p using (id) where (w.adult_auto, w.adult_reason) is distinct from (p.adult_auto, p.adult_reason))")}
  ${confere("idempotente: tags iguais na 2ª aplicação", "not exists ((select slug, adult_indicator, adult_indicator_strong, tag_group_id, enrichment_status, enrichment_detail from public.tags) except (select * from t_tags_pos1))")}
  ${confere("idempotente: aliases iguais na 2ª aplicação", "not exists ((select alias_slug, canonical_tag_id from public.tag_alias) except (select * from t_alias_pos1)) and (select count(*) from public.tag_alias) = (select count(*) from t_alias_pos1)")}
end
$teste$;`

const VOLTOU = `
do $teste$
begin
  ${confere("rollback: obras de volta (adult_auto, motivo, is_adult)", "not exists (select 1 from public.works w join t_works_pre p using (id) where (w.adult_auto, w.adult_reason, w.is_adult) is distinct from (p.adult_auto, p.adult_reason, p.is_adult))")}
  ${confere("rollback: tags de volta (flags, grupo, subgrupo, piso, marca)", "not exists ((select slug, name, tag_group_id, tag_subgroup_id, adult_indicator, adult_indicator_strong, adult_score_tier, adult_score_tier_reviewed_at from public.tags) except (select * from t_tags_pre)) and (select count(*) from public.tags) = (select count(*) from t_tags_pre)")}
  ${confere("rollback: aliases de volta", "not exists ((select a.alias_slug, t.slug from public.tag_alias a join public.tags t on t.id = a.canonical_tag_id) except (select * from t_alias_pre)) and (select count(*) from public.tag_alias) = (select count(*) from t_alias_pre)")}
  ${confere("rollback: colunas de proveniência removidas", "not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'tags' and column_name like 'enrichment_%')")}
end
$teste$;`

const principal = `
\\set ON_ERROR_STOP 1
begin;
${MONTA}
\\i ${MIGRATION}
${ASSERCOES}
\\i ${MIGRATION}
${IDEMPOTENTE}
${RETRATO_POS210}
\\i ${MIGRATION_211}
${ASSERCOES_211}
\\i ${MIGRATION_211}
${IDEMPOTENTE_211}
${RETRATO_POS211}
\\i ${MIGRATION_212}
${ASSERCOES_212}
\\i ${MIGRATION_212}
${IDEMPOTENTE_212}
\\i ${ROLLBACK_212}
${VOLTOU_212}
\\i ${ROLLBACK_211}
${VOLTOU_211}
\\i ${ROLLBACK}
${VOLTOU}
rollback;
`

/** Guardas de ENTRADA: cada sessão quebra uma premissa e a migration tem de ABORTAR. */
const GUARDAS = [
  ["guarda · tag renomeada aborta", "update public.tags set name = 'Sex Toys' where slug = 'sex-toy-s';", "esperava as 108 tags"],
  ["guarda · piso mexido aborta", "update public.tags set adult_score_tier = 'label' where slug = 'strap-on';", "esperava as 108 tags"],
  ["guarda · estado misto aborta", "update public.tags set adult_indicator = false where slug = 'korean-bl';", "estado misto"],
  ["guarda · alias fora do destino antigo e do novo aborta", "update public.tag_alias set canonical_tag_id = (select id from public.tags where slug = 'adult') where alias_slug = 'smut';", "fora do destino antigo e do novo"],
  ["guarda · 'mature' preexistente diferente aborta", "insert into public.tags (slug, name, adult_indicator) values ('mature', 'Mature', true);", "já existe uma tag \"mature\""],
  ["guarda · tag de 08/10 já com subgrupo aborta", "update public.tags set tag_subgroup_id = (select id from public.tag_subgroup limit 1) where slug = 'catbeast-s';", "esperava as 4 tags"],
]

/** Guardas de ENTRADA da 211: a sessão aplica a 210 (ou não), quebra uma premissa e a 211 tem de ABORTAR. */
const VINC_LISTA = "(select wt.work_id from public.work_tags wt join public.tags t on t.id = wt.tag_id join public.works w on w.id = wt.work_id where t.slug = 'r19' and w.title = 'A Butterfly Through the Mist')"
const GUARDAS_211 = [
  ["guarda 211 · sem a 210 aplicada aborta", null, "a 210 não foi aplicada aqui"],
  ["guarda 211 · R19 revinculado por outro caminho aborta", `update public.work_tags set created_at = now() where tag_id = (select id from public.tags where slug = 'r19') and work_id in ${VINC_LISTA};`, "NÃO são o injetado"],
  ["guarda 211 · estado misto (um já apagado à mão) aborta", `delete from public.work_tags where tag_id = (select id from public.tags where slug = 'r19') and work_id in ${VINC_LISTA};`, "estado misto"],
  ["guarda 211 · obra da lista ganhou outra tag forte aborta", "insert into public.work_tags (work_id, tag_id, source) select w.id, t.id, 'teste-211' from public.works w, public.tags t where w.title = 'A Butterfly Through the Mist' and t.slug = 'cunnilingus';", "ganharam evidência"],
  ["guarda 211 · obra da lista ganhou marcador R19 na sinopse aborta", "insert into public.work_synopses (work_id, source, text, is_primary, position) select id, 'teste-211', 'Official Webtoon: R19: Lezhin', false, 99 from public.works where title = 'A Butterfly Through the Mist';", "ganharam evidência"],
  ["guarda 211 · título mudou aborta", "update public.works set title = title || ' (teste)' where title = 'A Butterfly Through the Mist';", "esperava as 49 obras"],
]

/** Guardas de ENTRADA da 212: a sessão aplica 210 (+211), quebra uma premissa e a 212 tem de ABORTAR. */
const W212 = "(select id from public.works where title = 'Solstice')"
const GUARDAS_212 = [
  ["guarda 212 · sem a 210 aplicada aborta", null, "a 210 não foi aplicada aqui"],
  ["guarda 212 · obra ganhou override aborta", `update public.works set adult_override = false where id = ${W212};`, "ganharam override ou estado de edição"],
  ["guarda 212 · obra ganhou estado de edição aborta", `insert into public.work_edition_state (work_id, state, basis, decided_by) select ${W212}, 'unknown', 'edition_tag', 'auto';`, "ganharam override ou estado de edição"],
  ["guarda 212 · Smut já vinculado por outro caminho aborta", `insert into public.work_tags (work_id, tag_id, source) select ${W212}, id, null from public.tags where slug = 'smut';`, "por OUTRO caminho"],
  ["guarda 212 · Pornographic deixou de ser forte aborta", "update public.tags set adult_indicator_strong = false where slug = 'pornographic';", "Smut/Pornographic não estão como esperado"],
  ["guarda 212 · título mudou aborta", `update public.works set title = title || ' (teste)' where id = ${W212};`, "esperava as 12 obras"],
]

function psql(input) {
  return spawnSync("psql", [LOCAL, "-X", "-q"], { input, encoding: "utf8" })
}

const r = psql(principal)
const notices = (r.stderr ?? "").split("\n").filter((l) => l.includes("NOTICE:  ok · ")).map((l) => l.replace(/.*NOTICE:\s+/, ""))
const resumo = (r.stderr ?? "").split("\n").filter((l) => /NOTICE:  mig 21[012]/.test(l)).map((l) => l.replace(/.*NOTICE:\s+/, ""))
for (const n of notices) console.log(`  ✓ ${n.replace(/^ok · /, "")}`)
for (const n of resumo) console.log(`    · ${n}`)
if (r.error || r.status !== 0) {
  const erro = (r.stderr ?? "").split("\n").filter((l) => /ERROR|FALHOU|could not connect|Connection refused|does not exist/.test(l)).join("\n")
  console.error(`\n🔴 teste de banco das migrations 210/211/212 FALHOU (psql exit ${r.status ?? r.error?.message}).\n${erro}`)
  if (/could not connect|Connection refused|does not exist/.test(erro)) {
    console.error(`   Monte o retrato: node scripts/retrato-local-de-backup.mjs <backup> ${banco} --aplicar=204,205`)
  }
  process.exit(1)
}

let falhas = 0
for (const [caso, quebra, esperado] of GUARDAS) {
  const g = psql(`\\set ON_ERROR_STOP 1\nbegin;\n${quebra}\n\\i ${MIGRATION}\nrollback;\n`)
  const abortou = g.status !== 0 && (g.stderr ?? "").includes(esperado)
  console.log(`  ${abortou ? "✓" : "✗"} ${caso}`)
  if (!abortou) {
    falhas++
    console.error(`    esperava abortar com "${esperado}"; psql exit ${g.status}\n${(g.stderr ?? "").split("\n").filter((l) => /ERROR/.test(l)).join("\n")}`)
  }
}
for (const [caso, quebra, esperado] of GUARDAS_211) {
  const g = psql(quebra == null
    ? `\\set ON_ERROR_STOP 1\nbegin;\n\\i ${MIGRATION_211}\nrollback;\n`
    : `\\set ON_ERROR_STOP 1\nbegin;\n\\i ${MIGRATION}\n${quebra}\n\\i ${MIGRATION_211}\nrollback;\n`)
  const abortou = g.status !== 0 && (g.stderr ?? "").includes(esperado)
  console.log(`  ${abortou ? "✓" : "✗"} ${caso}`)
  if (!abortou) {
    falhas++
    console.error(`    esperava abortar com "${esperado}"; psql exit ${g.status}\n${(g.stderr ?? "").split("\n").filter((l) => /ERROR/.test(l)).join("\n")}`)
  }
}
for (const [caso, quebra, esperado] of GUARDAS_212) {
  const g = psql(quebra == null
    ? `\\set ON_ERROR_STOP 1\nbegin;\n\\i ${MIGRATION_212}\nrollback;\n`
    : `\\set ON_ERROR_STOP 1\nbegin;\n\\i ${MIGRATION}\n\\i ${MIGRATION_211}\n${quebra}\n\\i ${MIGRATION_212}\nrollback;\n`)
  const abortou = g.status !== 0 && (g.stderr ?? "").includes(esperado)
  console.log(`  ${abortou ? "✓" : "✗"} ${caso}`)
  if (!abortou) {
    falhas++
    console.error(`    esperava abortar com "${esperado}"; psql exit ${g.status}\n${(g.stderr ?? "").split("\n").filter((l) => /ERROR/.test(l)).join("\n")}`)
  }
}

// Rollback ISOLADO da 210 (sem 211/212): aplica e reverte numa sessão própria; o estado volta ao inicial.
const ISOLADO_210 = psql(`\\set ON_ERROR_STOP 1
begin;
create temp table i_works on commit drop as select id, adult_auto, adult_reason, is_adult from public.works;
create temp table i_tags on commit drop as select slug, adult_indicator, adult_indicator_strong, tag_group_id from public.tags;
create temp table i_alias on commit drop as select alias_slug, canonical_tag_id from public.tag_alias;
\\i ${MIGRATION}
\\i ${ROLLBACK}
do $t$ begin
  if exists ((select id, adult_auto, adult_reason, is_adult from public.works) except (select * from i_works))
     or exists ((select slug, adult_indicator, adult_indicator_strong, tag_group_id from public.tags) except (select * from i_tags))
     or exists ((select alias_slug, canonical_tag_id from public.tag_alias) except (select * from i_alias))
     or (select count(*) from public.tag_alias) <> (select count(*) from i_alias)
  then raise exception 'FALHOU: rollback isolado da 210 não voltou ao estado inicial'; end if;
end $t$;
rollback;
`)
console.log(`  ${ISOLADO_210.status === 0 ? "✓" : "✗"} rollback isolado da 210 (só ela) volta ao estado inicial`)
if (ISOLADO_210.status !== 0) { falhas++; console.error((ISOLADO_210.stderr ?? "").split("\n").filter((l) => /ERROR/.test(l)).join("\n")) }
if (falhas > 0) process.exit(1)

console.log(`\n✓ ${notices.length + GUARDAS.length + GUARDAS_211.length + GUARDAS_212.length + 1} casos · banco ${banco} · transações desfeitas (ROLLBACK): nada persistiu.`)

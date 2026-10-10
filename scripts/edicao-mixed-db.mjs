#!/usr/bin/env node
/**
 * TESTE DE BANCO das migrations 204 (estado de edição) e 205 (as 206 obras auditadas) — ALVO: o
 * Postgres LOCAL do stack, US$0, nada persiste.
 *
 *   npm run test:db-edicao-mixed
 *   RETRATO_DB=retrato_mixed node scripts/edicao-mixed-db.mjs
 *
 * Mesma escolha do `npm run test:db-gate-aviso-sexual`: o vitest não tem Postgres, e um teste que
 * "pula quando não alcança o banco" sumiria calado — sem o stack de pé isto FALHA, com a linha de comando.
 *
 * 🔴 TUDO em transações que terminam em ROLLBACK.
 *
 * PARTE A — a 204 sobre a réplica local (`postgres`), com estado sintético em obras reais:
 *   · o legado reproduz o gate de hoje (is_adult, r19_edition, tags e notas idênticos);
 *   · mixed: hide_adult não elimina, "só 18+" inclui, a tag de exibição é reflexo do estado;
 *   · r18_only e unknown ligam o gate ("na dúvida, protege"); single segue o gate normal;
 *   · adult_override vence tudo (inclusive unknown);
 *   · a guarda: tag de edição gravada por fora vira no máximo `unknown` (que protege), e não some de mixed;
 *   · o marcador de sinopse vira no máximo `unknown` (que protege); o CHECK impede gravar r19_edition à mão;
 *   · apagar obra mixed não quebra; idempotência; rollback devolve o estado exato.
 *
 * PARTE B — 204 + 205 sobre um RETRATO DA NUVEM (banco descartável `RETRATO_DB`, padrão
 * `retrato_mixed`), porque a 205 só se aplica às 206 obras reais:
 *   · 140/35/28/3, o efeito no gate, as 3 unknown, os 6 overrides INTACTOS, as wrong_signal, os aliases,
 *     a nota intocada;
 *   · idempotência; rollback da 205 → estado pós-204; rollback da 204 → retrato original.
 *   Monte o retrato com `node scripts/retrato-local-de-backup.mjs <backup> retrato_mixed --aplicar=203`.
 *
 * E sessões separadas provam que as guardas de ENTRADA abortam.
 */
import { spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
// URLs FIXAS no stack local: é o local por construção, nunca a nuvem.
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const RETRATO_DB = process.env.RETRATO_DB ?? "retrato_mixed"
if (!/^[a-z0-9_]+$/.test(RETRATO_DB)) {
  console.error(`🔴 RETRATO_DB inválido: ${RETRATO_DB}`)
  process.exit(1)
}
const RETRATO = `postgresql://postgres:postgres@127.0.0.1:54322/${RETRATO_DB}`
const M204 = path.join(ROOT, "supabase/migrations/204_estado_de_edicao.sql")
const M205 = path.join(ROOT, "supabase/migrations/205_edicoes_auditadas.sql")
const R204 = path.join(ROOT, "scripts/rollback/204_rollback.sql")
const R205 = path.join(ROOT, "scripts/rollback/205_rollback.sql")

const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`)
const confere = (caso, cond) => `
  if not (${cond}) then raise exception using errcode = 'P9999', message = 'FALHOU: ' || ${q(caso)}; end if;
  raise notice 'ok · %', ${q(caso)};`

/** Retrato do que as migrations podem mexer — para provar idempotência e rollback exatos. */
const RETRATO_FN = `
create or replace function pg_temp.retrato() returns table (k text, h text) language plpgsql as $f$
begin
  return query select 'works'::text, md5(string_agg((to_jsonb(w) - 'updated_at')::text, ',' order by w.id)) from public.works w;
  return query select 'work_tags', md5(string_agg(concat_ws(':', work_id, tag_id, source, confidence, created_at), ',' order by work_id, tag_id)) from public.work_tags;
  return query select 'tags', md5(string_agg((to_jsonb(t) - 'created_at' - 'reviewed_at')::text, ',' order by t.id)) from public.tags t;
  return query select 'tag_alias', md5(string_agg(concat_ws(':', alias_slug, canonical_tag_id), ',' order by alias_slug)) from public.tag_alias;
  return query select 'notas', md5(string_agg(concat_ws(':', work_id, criterion_slug, score, source), ',' order by work_id, criterion_slug)) from public.category_scores;
  return query select 'gatilhos', string_agg(tgname::text, ',' order by tgname) from pg_trigger
                where tgrelid in ('public.work_tags'::regclass, 'public.work_synopses'::regclass, 'public.works'::regclass) and not tgisinternal;
  if to_regclass('public.work_edition_state') is null then
    return query select 'estado', 'sem tabela';
  else
    return query execute $q$select 'estado'::text, md5(string_agg(concat_ws(':', work_id, state, basis, decided_by, r18_extra_chapters, decided_at, md5(evidence::text)), ',' order by work_id)) from public.work_edition_state$q$;
  end if;
end $f$;`
const IGUAL = (tabela) => `not exists (select * from ${tabela} except select * from pg_temp.retrato()) and not exists (select * from pg_temp.retrato() except select * from ${tabela})`

// ── PARTE A ────────────────────────────────────────────────────────────────────────────────────
const CENARIOS_A = `
do $teste$
declare
  v_tag uuid; w_a uuid; w_b uuid; w_c uuid; w_d uuid; w_e uuid; w_f uuid; r record; ids uuid[]; v_falhou boolean;
begin
  select id into v_tag from public.tags where slug = 'r19-disponivel';
  select array_agg(id order by id) into ids from (
    select w.id from public.works w
     where not w.is_archived and w.adult_override is null and w.edition_state is null and not w.adult_auto
     order by w.id limit 5) x;
  select w.id into w_a from public.works w
   where not w.is_archived and w.adult_override is null and w.edition_state is null and w.adult_auto order by w.id limit 1;
  if w_a is null or coalesce(array_length(ids, 1), 0) < 5 then
    raise exception using errcode = 'P9999', message = 'FALHOU: a réplica local não tem obras suficientes (rode npm run db:pull)';
  end if;
  w_b := ids[1]; w_c := ids[2]; w_d := ids[3]; w_e := ids[4]; w_f := ids[5];

  -- mixed (obra com sinal adulto: adult_auto = true)
  insert into public.work_edition_state (work_id, state, basis, decided_by) values (w_a, 'mixed', 'curator', 'curator');
  select * into r from public.works where id = w_a;
  ${confere("a1 · mixed com adult_auto=true: hide_adult NÃO elimina (is_adult = false)", "not r.is_adult")}
  ${confere("a2 · mixed entra no só 18+ (is_adult OR r19_edition)", "r.is_adult or r.r19_edition")}
  ${confere("a3 · mixed: espelho edition_state + ponte r19_edition", "r.edition_state = 'mixed' and r.r19_edition")}
  ${confere("a4 · mixed: a tag R19 disponível é criada pelo estado (source edition_state)", "exists (select 1 from public.work_tags where work_id = w_a and tag_id = v_tag and source = 'edition_state')")}
  update public.works set adult_override = true where id = w_a;
  ${confere("a5 · override=true é decisão da OBRA INTEIRA: esconde até a versão normal", "(select is_adult from public.works where id = w_a)")}
  update public.works set adult_override = null where id = w_a;
  delete from public.work_tags where work_id = w_a and tag_id = v_tag;
  ${confere("a6 · guarda: apagar a tag de exibição de uma obra mixed não apaga", "exists (select 1 from public.work_tags where work_id = w_a and tag_id = v_tag)")}
  update public.work_tags set confidence = 0.5 where work_id = w_a and tag_id = v_tag;
  ${confere("a7 · guarda: atualizar atributo do vínculo passa", "(select confidence from public.work_tags where work_id = w_a and tag_id = v_tag) = 0.5")}

  -- r18_only sem sinal adulto: o estado liga o gate
  insert into public.work_edition_state (work_id, state, basis, decided_by) values (w_b, 'r18_only', 'curator', 'curator');
  select * into r from public.works where id = w_b;
  ${confere("a8 · r18_only: hide_adult elimina mesmo com adult_auto=false", "r.is_adult")}
  ${confere("a9 · r18_only: no só 18+, sem ponte r19_edition, sem tag de exibição", "(r.is_adult or r.r19_edition) and not r.r19_edition and not exists (select 1 from public.work_tags where work_id = w_b and tag_id = v_tag)")}

  -- unknown liga o gate ("na dúvida, protege"); single segue o gate normal
  update public.work_edition_state set state = 'unknown' where work_id = w_a;
  select * into r from public.works where id = w_a;
  ${confere("a10 · unknown sem passe livre: adult_auto=true continua oculta", "r.is_adult and not r.r19_edition")}
  insert into public.work_edition_state (work_id, state, basis, decided_by) values (w_e, 'unknown', 'curator', 'curator');
  ${confere("a10b · unknown com adult_auto=false: o ESTADO oculta (na dúvida, protege)", "(select is_adult from public.works where id = w_e)")}
  update public.works set adult_override = false where id = w_e;
  ${confere("a10c · unknown: adult_override=false (decisão humana) continua vencendo", "not (select is_adult from public.works where id = w_e)")}
  update public.works set adult_override = null where id = w_e;
  delete from public.work_edition_state where work_id = w_e;
  ${confere("a11 · sair de mixed tira a tag de exibição", "not exists (select 1 from public.work_tags where work_id = w_a and tag_id = v_tag)")}
  update public.work_edition_state set state = 'single' where work_id = w_a;
  ${confere("a12 · single segue o gate normal (adult_auto)", "(select is_adult from public.works where id = w_a)")}

  -- a guarda: tag de edição gravada por fora (formulário, alias, merge) vira no máximo unknown
  insert into public.work_tags (work_id, tag_id, source) values (w_c, v_tag, 'teste-204');
  ${confere("a13 · tag/alias de edição em obra sem estado: nenhum vínculo, estado unknown", "not exists (select 1 from public.work_tags where work_id = w_c and tag_id = v_tag) and (select state from public.work_edition_state where work_id = w_c) = 'unknown' and (select basis from public.work_edition_state where work_id = w_c) = 'edition_tag'")}
  ${confere("a14 · tag/alias de edição nunca liga r19_edition (nunca mixed); o unknown resultante PROTEGE", "not (select r19_edition from public.works where id = w_c) and (select is_adult from public.works where id = w_c)")}
  insert into public.work_tags (work_id, tag_id, source) values (w_b, v_tag, 'teste-204');
  ${confere("a15 · tag de edição numa obra com decisão (r18_only) não muda nada", "(select state from public.work_edition_state where work_id = w_b) = 'r18_only' and not exists (select 1 from public.work_tags where work_id = w_b and tag_id = v_tag)")}

  -- marcador de sinopse → no máximo unknown
  insert into public.work_synopses (work_id, source, text) values (w_d, 'teste', 'Uma sinopse qualquer.' || chr(10) || chr(10) || '[R19 disponível]');
  ${confere("a16 · marcador isolado nasce unknown (synopsis_marker), sem tag e sem mixed — e protege", "(select state from public.work_edition_state where work_id = w_d) = 'unknown' and (select basis from public.work_edition_state where work_id = w_d) = 'synopsis_marker' and not exists (select 1 from public.work_tags where work_id = w_d and tag_id = v_tag) and (select is_adult from public.works where id = w_d) and not (select r19_edition from public.works where id = w_d)")}
  insert into public.work_edition_state (work_id, state, basis, decided_by) values (w_e, 'single', 'curator', 'curator');
  insert into public.work_synopses (work_id, source, text) values (w_e, 'teste', 'Outra.' || chr(10) || 'R19');
  ${confere("a17 · marcador numa obra já decidida não muda o estado", "(select state from public.work_edition_state where work_id = w_e) = 'single'")}

  -- ninguém grava a ponte à mão
  v_falhou := false;
  begin
    update public.works set r19_edition = true where id = w_e;
  exception when check_violation then v_falhou := true;
  end;
  ${confere("a18 · CHECK: gravar r19_edition à mão é recusado", "v_falhou")}

  -- apagar o estado → espelho some
  delete from public.work_edition_state where work_id = w_b;
  select * into r from public.works where id = w_b;
  ${confere("a19 · sem estado: espelho NULL e gate normal", "r.edition_state is null and not r.r19_edition and not r.is_adult")}

  -- apagar uma obra mixed (cascade) não quebra
  insert into public.work_edition_state (work_id, state, basis, decided_by) values (w_f, 'mixed', 'curator', 'curator');
  delete from public.works where id = w_f;
  ${confere("a20 · apagar obra mixed: cascade sem erro, estado e tag somem", "not exists (select 1 from public.work_edition_state where work_id = w_f) and not exists (select 1 from public.work_tags where work_id = w_f)")}
end
$teste$;`

const PARTE_A = `
\\set ON_ERROR_STOP 1
begin;
${RETRATO_FN}
create temp table t_orig on commit drop as select * from pg_temp.retrato();
create temp table t_pre on commit drop as select id, is_adult, r19_edition from public.works;
\\i ${M204}
do $teste$
begin
  ${confere("a0 · legado: toda obra com r19_edition ganhou estado mixed (legacy)", "(select count(*) from public.work_edition_state where decided_by = 'legacy' and state = 'mixed') = (select count(*) from public.works where r19_edition)")}
  ${confere("a0b · legado: is_adult e r19_edition idênticos aos de antes", "not exists (select 1 from public.works w join t_pre p using (id) where (w.is_adult, w.r19_edition) is distinct from (p.is_adult, p.r19_edition))")}
end
$teste$;
savepoint cenarios;
${CENARIOS_A}
rollback to savepoint cenarios;
create temp table t_pos204 on commit drop as select * from pg_temp.retrato();
\\i ${M204}
do $teste$
begin
  ${confere("a21 · 204 idempotente: a 2ª aplicação não muda nada", IGUAL("t_pos204"))}
end
$teste$;
\\i ${R204}
do $teste$
begin
  ${confere("a22 · rollback da 204: works, tags, aliases, notas e gatilhos exatamente como antes", IGUAL("t_orig"))}
end
$teste$;
rollback;
`

// ── PARTE B ────────────────────────────────────────────────────────────────────────────────────
const ASSERCOES_B = `
do $teste$
declare v_tag uuid; v_uva uuid; w_x uuid; w_y uuid;
begin
  ${confere("b1 · 206 estados auditados: 140 mixed · 35 r18_only · 28 single · 3 unknown", "(select count(*) from public.work_edition_state where decided_by = 'audit') = 206 and (select count(*) from public.work_edition_state where decided_by = 'audit' and state = 'mixed') = 140 and (select count(*) from public.work_edition_state where decided_by = 'audit' and state = 'r18_only') = 35 and (select count(*) from public.work_edition_state where decided_by = 'audit' and state = 'single') = 28 and (select count(*) from public.work_edition_state where decided_by = 'audit' and state = 'unknown') = 3")}
  ${confere("b2 · mixed: hide_adult NÃO elimina 134; as 6 ocultas são exatamente as do override mantido", "(select count(*) from public.works w join mig205_classe c on c.work_id = w.id where c.state = 'mixed' and not w.is_adult) = 134 and not exists (select 1 from public.works w join mig205_classe c on c.work_id = w.id where c.state = 'mixed' and w.is_adult and w.id not in (select work_id from mig205_overrides))")}
  ${confere("b3 · as 140 mixed entram no só 18+ (is_adult OR r19_edition)", "(select count(*) from public.works w join mig205_classe c on c.work_id = w.id where c.state = 'mixed' and (w.is_adult or w.r19_edition)) = 140")}
  ${confere("b4 · sem filtro, cada mixed é UMA linha de obra", "(select count(*) from public.works w join mig205_classe c on c.work_id = w.id where c.state = 'mixed') = 140")}
  ${confere("b5 · as 35 r18_only: hide_adult elimina e o só 18+ inclui", "(select count(*) from public.works w join mig205_classe c on c.work_id = w.id where c.state = 'r18_only' and w.is_adult and not w.r19_edition) = 35")}
  ${confere("b6 · unknown liga o gate pelo ESTADO: is_adult = coalesce(override, true)", "not exists (select 1 from public.works w join mig205_classe c on c.work_id = w.id where c.state = 'unknown' and w.is_adult is distinct from coalesce(w.adult_override, true))")}
  ${confere("b6b · as 3 unknown: Can't Get Enough (adult_auto=false) e Sip of Poison ocultas; Disobey visível pelo override=false", "(select is_adult from public.works where id = (select work_id from mig205_classe where titulo = 'Can''t Get Enough of You')) and not (select adult_auto from public.works where id = (select work_id from mig205_classe where titulo = 'Can''t Get Enough of You')) and (select is_adult from public.works where id = (select work_id from mig205_classe where titulo = 'Sip of Poison')) and not (select is_adult from public.works where id = (select work_id from mig205_classe where titulo = 'Disobey the Duke If You Dare'))")}
  ${confere("b7 · single (wrong_signal) segue o gate normal, sem a máscara da 199", "not exists (select 1 from public.works w join mig205_classe c on c.work_id = w.id where c.state = 'single' and (w.r19_edition or w.is_adult is distinct from coalesce(w.adult_override, w.adult_auto)))")}
  ${confere("b8 · wrong_signal não vira override=false (os 3 false são os de antes)", "(select count(*) from public.works w join mig205_classe c on c.work_id = w.id where c.classe = 'wrong_signal' and w.adult_override is false) = 3 and not exists (select 1 from public.works w join t_pre p using (id) where w.adult_override is false and p.adult_override is distinct from false)")}
  ${confere("b9 · nenhum adult_auto ligou (a limpeza nunca cria R18 pelo automático)", "not exists (select 1 from public.works w join t_pre p using (id) where w.adult_auto and not p.adult_auto)")}
  ${confere("b10 · wrong_signal que segue 18+ tem sinal adulto PRÓPRIO (não-R19)", "not exists (select 1 from public.works w join mig205_classe c on c.work_id = w.id where c.classe = 'wrong_signal' and w.adult_auto and w.adult_reason <> 'ai_review' and not exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id where wt.work_id = w.id and t.adult_indicator and t.slug not in ('r19', 'r19-version', 'r18-r19')))")}
  ${confere("b11 · wrong_signal: a tag r19 saiu das 15 e R19 disponível das 28", "not exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id join mig205_classe c on c.work_id = wt.work_id where c.classe = 'wrong_signal' and t.slug in ('r19', 'r19-disponivel'))")}
  ${confere("b12 · o alias R19 with R15 Version aponta para R19 disponível, não para R19 Version", "(select t.slug from public.tag_alias a join public.tags t on t.id = a.canonical_tag_id where a.alias_slug = 'r19-with-r15-version') = 'r19-disponivel'")}
  ${confere("b13 · as 14 obras com R19 Version: todas mixed, visíveis para quem oculta 18+ e no só 18+", "(select count(*) from public.works w join mig205_classe c on c.work_id = w.id where c.state = 'mixed' and not w.is_adult and w.r19_edition and w.id in (select p.work_id from t_wt_pre p join public.tags t on t.id = p.tag_id where t.slug = 'r19-version')) = 14")}
  ${confere("b14 · R19 Version saiu só das 6 com a categoria no MU; as 8 sem prova ficaram", "(select count(*) from public.work_tags wt join public.tags t on t.id = wt.tag_id where t.slug = 'r19-version') = 8")}

  -- simulações de INGESTÃO em obras fora das 206 (sem estado)
  select id into v_tag from public.tags where slug = 'r19-disponivel';
  select id into v_uva from public.tags where slug = 'uncensored-version-available';
  select w.id into w_x from public.works w where w.edition_state is null and not w.is_archived order by w.id limit 1;
  select w.id into w_y from public.works w where w.edition_state is null and not w.is_archived and w.id <> w_x order by w.id limit 1;
  ${confere("b15 · aliases de censura → tag NEUTRA (sem gate, sem edição)", "(select count(*) from public.tag_alias a where a.alias_slug in ('official-english-uncensored', 'english-company-added-censorship') and a.canonical_tag_id = v_uva) = 2 and not exists (select 1 from public.tags where id = v_uva and (adult_indicator or adult_indicator_strong or marks_r19_edition or adult_score_tier is not null)) and not exists (select 1 from public.tag_alias where alias_slug = 'uncensored-version-available')")}
  insert into public.work_tags (work_id, tag_id, source) values (w_x, (select canonical_tag_id from public.tag_alias where alias_slug = 'official-english-uncensored'), 'teste-205');
  ${confere("b16 · censura anexada a uma obra não cria estado de edição nem muda o gate", "not exists (select 1 from public.work_edition_state where work_id = w_x) and exists (select 1 from public.work_tags where work_id = w_x and tag_id = v_uva)")}
  insert into public.work_tags (work_id, tag_id, source) values (w_y, (select canonical_tag_id from public.tag_alias where alias_slug = 'r19-with-r15-version'), 'teste-205');
  ${confere("b17 · R19 with R15 Version anexado sozinho: no máximo unknown (que protege), nunca mixed", "(select state from public.work_edition_state where work_id = w_y) = 'unknown' and not (select r19_edition from public.works where id = w_y) and not exists (select 1 from public.work_tags where work_id = w_y and tag_id = v_tag) and (select is_adult from public.works where id = w_y) is not distinct from coalesce((select adult_override from public.works where id = w_y), true)")}
  delete from public.work_tags where work_id = w_x and tag_id = v_uva;
  delete from public.work_edition_state where work_id = w_y;

  ${confere("b18 · os 6 overrides INTACTOS (true, ocultos), mixed, com a classificação da auditoria na procedência", "(select count(*) from public.works w join mig205_overrides o on o.work_id = w.id where w.adult_override is true and w.is_adult and w.r19_edition) = 6 and (select count(*) from public.work_edition_state s join mig205_overrides o using (work_id) where s.evidence->'override_work_level'->>'classificacao_auditoria' = o.classificacao) = 6")}
  ${confere("b18b · nenhum adult_override mudou em obra nenhuma, e não há log de remoção inventado", "not exists (select 1 from public.works w join t_pre p using (id) where w.adult_override is distinct from p.adult_override) and to_regclass('public.work_adult_override_log') is null")}
  ${confere("b19 · procedência: toda linha auditada tem a evidência e o estado legado que substituiu", "not exists (select 1 from public.work_edition_state s join mig205_classe c using (work_id) where not (s.evidence ? 'auditoria' and s.evidence ? 'mangaupdates' and s.evidence ? 'estado_legado_mig204' and s.evidence_fetched_at is not null))")}
  ${confere("b20 · extras R19 contam como mixed (7 com r18_extra_chapters)", "(select count(*) from public.work_edition_state where r18_extra_chapters and state = 'mixed') = 7")}
  ${confere("b21 · nota: category_scores intocada", "(select h from t_pos204 where k = 'notas') = (select h from pg_temp.retrato() where k = 'notas')")}
  ${confere("b22 · nenhuma obra FORA das 206 mudou de gate", "not exists (select 1 from public.works w join t_pre p using (id) where w.id not in (select work_id from mig205_classe) and (w.is_adult, w.r19_edition, w.adult_auto, w.adult_override) is distinct from (p.is_adult, p.r19_edition, p.adult_auto, p.adult_override))")}
end
$teste$;`

const PARTE_B = `
\\set ON_ERROR_STOP 1
begin;
${RETRATO_FN}
do $pre$
begin
  if to_regclass('public.work_edition_state') is not null then
    raise exception using errcode = 'P9999', message = 'FALHOU: o retrato já tem a 204 aplicada — remonte-o (scripts/retrato-local-de-backup.mjs)';
  end if;
end $pre$;
create temp table t_orig on commit drop as select * from pg_temp.retrato();
create temp table t_pre on commit drop as select id, is_adult, r19_edition, adult_auto, adult_reason, adult_override from public.works;
create temp table t_wt_pre on commit drop as select work_id, tag_id from public.work_tags;
\\i ${M204}
create temp table t_pos204 on commit drop as select * from pg_temp.retrato();
\\i ${M205}
${ASSERCOES_B}
create temp table t_pos205 on commit drop as select * from pg_temp.retrato();
\\i ${M205}
do $teste$
begin
  ${confere("b23 · 205 idempotente: a 2ª aplicação não muda nada", IGUAL("t_pos205"))}
end
$teste$;
\\i ${R205}
do $teste$
begin
  ${confere("b24 · rollback da 205: estado, works, tags, aliases, notas e gatilhos = pós-204", IGUAL("t_pos204"))}
end
$teste$;
\\i ${R204}
do $teste$
begin
  ${confere("b25 · rollback da 204: o retrato original exato", IGUAL("t_orig"))}
end
$teste$;
rollback;
`

/** As guardas de ENTRADA: cada sessão quebra uma premissa e a migration tem de ABORTAR. */
const GUARDAS = [
  [LOCAL, "guarda 204 · duas tags marcando edição aborta", "update public.tags set marks_r19_edition = true where slug = 'r19-version';", [M204], "esperava UMA tag"],
  [LOCAL, "guarda 204 · r19_edition gravado à mão (divergente da tag) aborta",
    "update public.works set r19_edition = true where id = (select id from public.works where not r19_edition order by id limit 1);", [M204], "divergente da tag"],
  [RETRATO, "guarda 205 · sem a 204 aborta", "", [M205], "não está aplicada"],
  [RETRATO, "guarda 205 · override de uma das 6 mudado aborta",
    "update public.works set adult_override = null where id = '0907dc04-99c0-4393-b2b8-d9663b07d356';", [M204, M205], "esperava os 6 overrides"],
  [RETRATO, "guarda 205 · obra nova com r19_edition fora das 206 aborta",
    "insert into public.work_tags (work_id, tag_id, source) select (select id from public.works where not r19_edition and not is_archived order by id limit 1), id, 'teste' from public.tags where slug = 'r19-disponivel';", [M204, M205], "fora das 206"],
  [RETRATO, "guarda 205 · tag errada já removida (catálogo mudou) aborta",
    "delete from public.work_tags wt using public.tags t where t.id = wt.tag_id and t.slug = 'r19' and wt.work_id = 'ba18abd5-e0b8-4952-9822-32429fb3bee9';", [M204, M205], "vínculo(s) de tag errada"],
  [RETRATO, "guarda 205 · título divergente (id trocado) aborta",
    "update public.works set title = 'Outro título' where id = '4d6e8e8a-608e-403a-b53e-afa214e6b482';", [M204, M205], "título divergente"],
]

function psql(url, input) {
  return spawnSync("psql", [url, "-X", "-q"], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

function roda(rotulo, url, sql) {
  const r = psql(url, sql)
  const notices = (r.stderr ?? "").split("\n").filter((l) => l.includes("NOTICE:  ok · ")).map((l) => l.replace(/.*NOTICE:\s+ok · /, ""))
  const resumo = (r.stderr ?? "").split("\n").filter((l) => /NOTICE:  (mig 20[45]|rollback 20[45])/.test(l)).map((l) => l.replace(/.*NOTICE:\s+/, ""))
  console.log(`\n${rotulo}`)
  for (const n of notices) console.log(`  ✓ ${n}`)
  for (const n of resumo) console.log(`    · ${n}`)
  if (r.error || r.status !== 0) {
    const erro = (r.stderr ?? "").split("\n").filter((l) => /ERROR|FALHOU|could not connect|Connection refused|does not exist/.test(l)).join("\n")
    console.error(`\n🔴 ${rotulo} FALHOU (psql exit ${r.status ?? r.error?.message}).\n${erro}`)
    if (/could not connect|Connection refused/.test(erro)) console.error("   O stack local está de pé? (`supabase start`, a partir do diretório do projeto)")
    if (new RegExp(`database "${RETRATO_DB}" does not exist`).test(erro)) {
      console.error(`   Monte o retrato: node scripts/retrato-local-de-backup.mjs .backups/<backup-de-10-10> ${RETRATO_DB} --aplicar=203`)
    }
    process.exit(1)
  }
  return notices.length
}

let casos = 0
casos += roda("PARTE A — a 204 sobre a réplica local", LOCAL, PARTE_A)
casos += roda(`PARTE B — 204 + 205 sobre o retrato da nuvem (${RETRATO_DB})`, RETRATO, PARTE_B)

console.log("\nGuardas de entrada")
let falhas = 0
for (const [url, caso, quebra, migrations, esperado] of GUARDAS) {
  const g = psql(url, `\\set ON_ERROR_STOP 1\nbegin;\n${quebra}\n${migrations.map((m) => `\\i ${m}`).join("\n")}\nrollback;\n`)
  const abortou = g.status !== 0 && (g.stderr ?? "").includes(esperado)
  console.log(`  ${abortou ? "✓" : "✗"} ${caso}`)
  if (!abortou) {
    falhas++
    console.error(`    esperava abortar com "${esperado}"; psql exit ${g.status}\n${(g.stderr ?? "").split("\n").filter((l) => /ERROR/.test(l)).join("\n")}`)
  }
}
if (falhas > 0) process.exit(1)

console.log(`\n✓ ${casos + GUARDAS.length} casos · transações desfeitas (ROLLBACK): nada persistiu.`)

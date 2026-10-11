#!/usr/bin/env node
/**
 * TESTE DE BANCO das migrations 213 (scores por edição: estrutura), 214 (as 280 notas das 140 mixed +
 * 3 marcas de extras R19) e 215 (liberação de 5 overrides) — ALVO: um RETRATO DE PRODUÇÃO no Postgres
 * LOCAL do stack, US$0, nada persiste.
 *
 *   npm run test:db-edicao-fase2
 *   RETRATO_DB=fase2_prod node scripts/edicao-fase2-db.mjs
 *
 * O retrato precisa estar no estado de produção DEPOIS da frente de tags (210 → 211 → 212). Montado em
 * 2026-10-11 a partir do backup de 03:50Z (o `retrato_publicacao`, pré-210) + a publicação aplicada
 * localmente; a validação de produção (`validacao.sql` da publicação) bateu byte a byte. Tabelas que o
 * retrato não trazia (reviews, calculated_scores, user_settings…) foram carregadas do mesmo backup.
 *
 * 🔴 TUDO em transações que terminam em ROLLBACK. Sem o stack de pé isto FALHA (não pula calado).
 *
 * O que prova:
 *   · 213: a tabela e as travas (só mixed; ausência explícita; baseline sempre provisório e de baixa
 *     confiança; nenhuma fonte "por regra"; nada de rebaixar fonte sem a chave de correção);
 *     preferência; previsão por edição (CHECK das duas chaves); o contrato novo convive com o antigo e
 *     o gatilho de scoring da 202 aceita a escrita nova com `enforce` ligado;
 *   · 214: 140 obras × 2 edições, contagem exata por origem, NENHUMA R18 = 9 por regra, os 10 extras
 *     sem baseline (3 marcados agora), NENHUMA nota de category_scores tocada, gate/override/estado
 *     intactos, idempotência;
 *   · régua de tags por edição nas 140 (as flags pós-210): o que a normal oculta;
 *   · 215: 5 overrides liberados com histórico, One Last Night continua oculto;
 *   · rollbacks 215 → 214 → 213 devolvem o retrato EXATO;
 *   · guardas de entrada abortam (sessões separadas).
 */
import { spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const RETRATO_DB = process.env.RETRATO_DB ?? "fase2_prod"
if (!/^[a-z0-9_]+$/.test(RETRATO_DB) || RETRATO_DB === "postgres") {
  console.error(`🔴 RETRATO_DB inválido: ${RETRATO_DB}`)
  process.exit(1)
}
// URL FIXA no stack local: é o local por construção, nunca a nuvem.
const RETRATO = `postgresql://postgres:postgres@127.0.0.1:54322/${RETRATO_DB}`
const mig = (f) => path.join(ROOT, "supabase/migrations", f)
const rb = (f) => path.join(ROOT, "scripts/rollback", f)
const M213 = mig("213_scores_por_edicao.sql")
const M214 = mig("214_scores_por_edicao_dados.sql")
const M215 = mig("215_libera_overrides_mixed.sql")
const R213 = rb("213_rollback.sql")
const R214 = rb("214_rollback.sql")
const R215 = rb("215_rollback.sql")

const ONE_LAST_NIGHT = "8719d6a0-b7ee-45ea-ba61-7cbaaf6d185d"
const LUCIA = "52bc22ce-581f-4359-9077-94c06bb13133"
const EXTRAS_NOVAS = ["c5281238-83f3-41bd-94ce-b6d4ab8155c3", "04d015be-eaf0-498f-90af-dacf11f8e6c2", "435a5c5f-43ef-4775-8a3b-494b92d843e3"]
const ex = `('${EXTRAS_NOVAS.join("','")}')`

const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`)
const confere = (caso, cond) => `
do $c$ begin
  if not (${cond}) then raise exception using errcode = 'P9999', message = 'FALHOU: ' || ${q(caso)}; end if;
  raise notice 'ok · %', ${q(caso)};
end $c$;`
/** Um comando que TEM de falhar, dentro de um savepoint (o resto da transação segue). */
const recusa = (caso, sql, esperado) => `
do $c$ begin
  begin
    ${sql}
    raise exception using errcode = 'P9999', message = 'FALHOU (não recusou): ' || ${q(caso)};
  exception when others then
    if sqlstate = 'P9999' then raise; end if;
    if position(${q(esperado)} in sqlerrm) = 0 then
      raise exception using errcode = 'P9999', message = 'FALHOU (recusou pelo motivo errado: ' || sqlerrm || '): ' || ${q(caso)};
    end if;
  end;
  raise notice 'ok · %', ${q(caso)};
end $c$;`

const RETRATO_FN = `
create or replace function pg_temp.retrato() returns table (k text, h text) language plpgsql as $f$
begin
  return query select 'works'::text, md5(string_agg((to_jsonb(w) - 'updated_at')::text, ',' order by w.id)) from public.works w;
  return query select 'notas', md5(string_agg(concat_ws(':', work_id, criterion_slug, score, source, ai_evaluation_id), ',' order by work_id, criterion_slug)) from public.category_scores;
  return query select 'work_tags', md5(string_agg(concat_ws(':', work_id, tag_id, source), ',' order by work_id, tag_id)) from public.work_tags;
  return query select 'estado', md5(string_agg(concat_ws(':', work_id, state, basis, decided_by, r18_extra_chapters, md5(evidence::text)), ',' order by work_id)) from public.work_edition_state;
  return query select 'user_settings', md5(string_agg((to_jsonb(u))::text, ',' order by u.id)) from public.user_settings u;
  return query select 'calc', md5(string_agg((to_jsonb(c))::text, ',' order by c.work_id)) from public.calculated_scores c;
  return query select 'ucalc', md5(string_agg((to_jsonb(c))::text, ',' order by c.user_id, c.work_id)) from public.user_calculated_scores c;
  return query select 'contrato', (select scoring_contracts::text || enforce::text from public.canonical_contract where id = 1);
  return query select 'tabelas', (select string_agg(table_schema || '.' || table_name, ',' order by 1) from information_schema.tables
                                   where table_name in ('work_edition_scores', 'work_adult_override_log')
                                      or (table_schema = 'bkp' and table_name in ('mig214_estado_antes', 'mig215_works_antes')));
  return query select 'funcoes', (select string_agg(proname, ',' order by proname) from pg_proc where proname in
                                   ('work_edition_score_strength', 'trg_work_edition_scores_guard', 'expected_by_edition_valido'));
end $f$;`

const CONTA = (ed, src) =>
  `(select count(*) from public.work_edition_scores where edition = '${ed}' and source = '${src}')`
const SCORE = (w, ed) => `(select score from public.work_edition_scores where work_id = '${w}' and edition = '${ed}')`
const SRC = (w, ed) => `(select source from public.work_edition_scores where work_id = '${w}' and edition = '${ed}')`
const HASH_EDICAO = `(select md5(string_agg(concat_ws(':', work_id, edition, score, source, status, confidence, md5(evidence::text)), ',' order by work_id, edition)) from public.work_edition_scores)`
const ADULTAS = "(select count(*) from public.works where is_adult and not is_archived)"
/** A régua de tags por edição (lib/editions/edition-content.ts), em SQL: classe pela flag. */
const CLASSE_TAG = `(case when t.adult_indicator_strong or t.adult_score_tier = 'explicit' then 'r18'
  when t.marks_r19_edition then 'compartilhada'
  when t.adult_indicator or t.adult_score_tier = 'label' then 'desconhecida' else 'compartilhada' end)`
const VINCULOS_MIXED = `public.works w join public.work_tags wt on wt.work_id = w.id join public.tags t on t.id = wt.tag_id where w.edition_state = 'mixed'`
const PREVISAO = (score) => `jsonb_build_object('expected_score', ${score}, 'expected_baseline', ${score}, 'expected_quality_adj', 0, 'expected_is_stub', false, 'chance_score', 50, 'chance_is_stub', false)`

const CASOS = `
\\set ON_ERROR_STOP 1
begin;
${RETRATO_FN}
create temp table antes as select * from pg_temp.retrato();
${confere("retrato no estado de produção pós-212 (140 mixed, 6 overrides nelas, 166 adultas, 7 extras)", `(select count(*) from public.works where edition_state = 'mixed') = 140 and (select count(*) from public.works where edition_state = 'mixed' and adult_override) = 6 and ${ADULTAS} = 166 and (select count(*) from public.work_edition_state where r18_extra_chapters) = 7`)}

-- ── régua de tags por edição nas 140 (flags pós-210) ──
${confere("tags · a normal oculta 673 de 7.555 vínculos das mixed (258 R18 + 415 de edição desconhecida), em 132 obras", `(select count(*) from ${VINCULOS_MIXED}) = 7555 and (select count(*) from ${VINCULOS_MIXED} and ${CLASSE_TAG} = 'r18') = 258 and (select count(*) from ${VINCULOS_MIXED} and ${CLASSE_TAG} = 'desconhecida') = 415 and (select count(distinct w.id) from ${VINCULOS_MIXED} and ${CLASSE_TAG} <> 'compartilhada') = 132`)}
${confere("tags · nenhuma tag forte ou explícita é vista na normal (por construção, a normal não liga o gate)", `not exists (select 1 from ${VINCULOS_MIXED} and ${CLASSE_TAG} = 'compartilhada' and (t.adult_indicator_strong or t.adult_score_tier = 'explicit'))`)}
${confere("tags · 'R19 disponível' e violência sexual ficam nas duas edições", `not exists (select 1 from ${VINCULOS_MIXED} and (t.slug in ('r19-disponivel', 'sexual-assault', 'sexual-abuse', 'sexual-violence')) and ${CLASSE_TAG} <> 'compartilhada')`)}

-- ── 213 ──
\\i ${M213}
${confere("213 · tabela, preferência e previsão por edição existem", "to_regclass('public.work_edition_scores') is not null and exists (select 1 from information_schema.columns where table_name = 'user_settings' and column_name = 'preferred_mixed_edition') and (select count(*) from information_schema.columns where table_name in ('calculated_scores', 'user_calculated_scores') and column_name in ('expected_edition', 'expected_by_edition')) = 4")}
${confere("213 · contrato aceita o antigo E o novo", "(select scoring_contracts from public.canonical_contract where id = 1) @> array['s9-fantasy-b-v1', 's9-fantasy-b-edicao-v1']")}
${recusa("213 · nota por edição em obra NÃO mixed é recusada", "insert into public.work_edition_scores (work_id, edition, criterion_slug, score, source, status, confidence, decided_by) select id, 'normal', 'adult_content', 5, 'inferred_base', 'provisional', 'baixa', 'audit' from public.works where edition_state = 'r18_only' limit 1;", "não é mixed")}
${recusa("213 · baseline sem nota (ausência disfarçada) é recusado", `insert into public.work_edition_scores (work_id, edition, criterion_slug, score, source, status, confidence, decided_by) values ('${LUCIA}', 'normal', 'adult_content', null, 'inferred_base', 'provisional', 'baixa', 'audit');`, "work_edition_scores_ausencia_explicita")}
${recusa("213 · baseline com confiança média é recusado", `insert into public.work_edition_scores (work_id, edition, criterion_slug, score, source, status, confidence, decided_by) values ('${LUCIA}', 'normal', 'adult_content', 5, 'inferred_base', 'provisional', 'media', 'audit');`, "work_edition_scores_baseline_baixa")}
${recusa("213 · baseline marcado como 'rated' é recusado (não se passa por avaliação)", `insert into public.work_edition_scores (work_id, edition, criterion_slug, score, source, status, confidence, decided_by) values ('${LUCIA}', 'normal', 'adult_content', 5, 'inferred_base', 'rated', 'baixa', 'audit');`, "work_edition_scores_status")}
${recusa("213 · fonte 'por regra' (R18 = 9 automático) é recusada", `insert into public.work_edition_scores (work_id, edition, criterion_slug, score, source, status, confidence, decided_by) values ('${LUCIA}', 'r18', 'adult_content', 9, 'rule_derived', 'rated', 'media', 'audit');`, "work_edition_scores_source")}
${recusa("213 · outro critério que não adult_content é recusado", `insert into public.work_edition_scores (work_id, edition, criterion_slug, score, source, status, confidence, decided_by) values ('${LUCIA}', 'normal', 'romance', 5, 'curator_confirmed', 'rated', 'alta', 'curator');`, "work_edition_scores_criterio")}
${recusa("213 · preferência fora de normal/r18 é recusada", "update public.user_settings set preferred_mixed_edition = 'ambas';", "user_settings_preferred_mixed_edition_check")}
${recusa("213 · previsão por edição com UMA edição só é recusada", `update public.calculated_scores set expected_by_edition = jsonb_build_object('normal', ${PREVISAO(7)}) where work_id = '${LUCIA}';`, "expected_by_edition_check")}
savepoint escrita;
update public.canonical_contract set enforce = true where id = 1;
insert into public.calculated_scores (work_id, expected_score, expected_edition, expected_by_edition, scoring_contract)
  values ('${LUCIA}', 7, 'normal', jsonb_build_object('normal', ${PREVISAO(7)}, 'r18', ${PREVISAO(6)}), 's9-fantasy-b-edicao-v1')
  on conflict (work_id) do update set expected_score = excluded.expected_score, expected_edition = excluded.expected_edition,
    expected_by_edition = excluded.expected_by_edition, scoring_contract = excluded.scoring_contract;
${confere("213 · com enforce ligado, o recálculo novo grava pelo upsert com o contrato novo", `(select expected_by_edition->'r18'->>'expected_score' from public.calculated_scores where work_id = '${LUCIA}') = '6' and (select scoring_contract from public.calculated_scores where work_id = '${LUCIA}') = 's9-fantasy-b-edicao-v1'`)}
${recusa("213 · com enforce ligado, contrato desconhecido é recusado", `insert into public.calculated_scores (work_id, expected_score, scoring_contract) values ('${LUCIA}', 7, 's9-outro') on conflict (work_id) do update set expected_score = excluded.expected_score, scoring_contract = excluded.scoring_contract;`, "scoring RECUSADO")}
rollback to savepoint escrita;
${confere("213 · nada de dado mexido", "(select h from antes where k = 'notas') = (select h from pg_temp.retrato() where k = 'notas') and (select h from antes where k = 'works') = (select h from pg_temp.retrato() where k = 'works') and (select h from antes where k = 'estado') = (select h from pg_temp.retrato() where k = 'estado')")}

-- ── 214 ──
\\i ${M214}
${confere("214 · 280 linhas = 140 obras × 2 edições", "(select count(*) from public.work_edition_scores) = 280 and (select count(distinct work_id) from public.work_edition_scores) = 140")}
${confere("214 · R18: 82 reaproveitadas + 58 sem nota (nenhuma 9 por regra)", `${CONTA("r18", "reused_existing")} = 82 and ${CONTA("r18", "not_rated")} = 58 and (select count(*) from public.work_edition_scores where edition = 'r18') = 140`)}
${confere("214 · 210 com nota + 70 'não avaliado' (score NULL, status not_rated, sem confiança, nenhum zero)", "(select count(*) from public.work_edition_scores where score is not null) = 210 and (select count(*) from public.work_edition_scores where source = 'not_rated' and score is null and status = 'not_rated' and confidence is null) = 70 and not exists (select 1 from public.work_edition_scores where score = 0)")}
${confere("214 · normal: 1 real + 127 baseline + 12 sem nota", `${CONTA("normal", "reused_existing")} = 1 and ${CONTA("normal", "inferred_base")} = 127 and ${CONTA("normal", "not_rated")} = 12`)}
${confere("214 · todo baseline é 5,0 · provisional · baixa · com a regra na procedência", "not exists (select 1 from public.work_edition_scores where source = 'inferred_base' and not (score = 5.0 and status = 'provisional' and confidence = 'baixa' and evidence->>'regra' = 'baseline_normal_mixed_v1'))")}
${confere("214 · 10 obras com extras R19 (7 + as 3 marcadas agora), nenhuma com baseline na normal", `(select count(*) from public.work_edition_state where r18_extra_chapters) = 10 and (select count(*) from public.work_edition_state where r18_extra_chapters and work_id in ${ex} and evidence ? 'extras_r19_mig214') = 3 and not exists (select 1 from public.work_edition_scores s join public.work_edition_state e on e.work_id = s.work_id where e.r18_extra_chapters and s.edition = 'normal' and s.source = 'inferred_base')`)}
${confere("214 · marcar os extras não mexe no estado de edição (state/decided_by) nem no gate", `(select count(*) from public.work_edition_state where work_id in ${ex} and state = 'mixed' and decided_by = 'audit') = 3 and ${ADULTAS} = 166`)}
${confere("214 · nenhuma nota da normal é cópia da R18 (nada ≥ 7 na normal)", "not exists (select 1 from public.work_edition_scores where edition = 'normal' and score >= 7)")}
${confere("214 · R18 reaproveitada = a nota legada, e ≥ 9", "not exists (select 1 from public.work_edition_scores s join public.category_scores c on c.work_id = s.work_id and c.criterion_slug = 'adult_content' where s.edition = 'r18' and s.source = 'reused_existing' and (s.score <> c.score or s.score < 9))")}
${confere("214 · Lucia: normal 6,0 real (avaliação v31), R18 sem nota", `${SCORE(LUCIA, "normal")} = 6.0 and ${SRC(LUCIA, "normal")} = 'reused_existing' and ${SRC(LUCIA, "r18")} = 'not_rated'`)}
${confere("214 · category_scores, works e tags intactos", "not exists (select 1 from antes a join pg_temp.retrato() r using (k) where a.k in ('notas', 'works', 'work_tags') and a.h is distinct from r.h)")}
create temp table h214 as select ${HASH_EDICAO} as h, (select md5(string_agg(md5(evidence::text), ',' order by work_id)) from public.work_edition_state) as e;
\\i ${M214}
${confere("214 · idempotente (reaplicar não muda nada)", `(select h from h214) = ${HASH_EDICAO} and (select e from h214) = (select md5(string_agg(md5(evidence::text), ',' order by work_id)) from public.work_edition_state)`)}

-- ── força da procedência ──
savepoint forca;
update public.work_edition_scores set score = 4.0, source = 'ai_evaluated', status = 'rated', confidence = 'media', decided_by = 'ai' where edition = 'normal' and source = 'inferred_base' and work_id = (select work_id from public.work_edition_scores where source = 'inferred_base' order by work_id limit 1);
${confere("força · baseline → avaliação por edição é aceito (substituível)", `${CONTA("normal", "ai_evaluated")} = 1`)}
${recusa("força · avaliação → baseline é recusado (rebaixar)", "update public.work_edition_scores set score = 5.0, source = 'inferred_base', status = 'provisional', confidence = 'baixa', decided_by = 'audit' where source = 'ai_evaluated';", "recusado rebaixar")}
${recusa("força · R18 reaproveitada → sem nota é recusado", "update public.work_edition_scores set score = null, source = 'not_rated', status = 'not_rated', confidence = null where edition = 'r18' and source = 'reused_existing';", "recusado rebaixar")}
set local app.permitir_rebaixar_edicao = 'on';
update public.work_edition_scores set score = 5.0, source = 'inferred_base', status = 'provisional', confidence = 'baixa', decided_by = 'audit' where source = 'ai_evaluated';
${confere("força · com a chave de correção explícita, rebaixar passa", `${CONTA("normal", "ai_evaluated")} = 0 and ${CONTA("normal", "inferred_base")} = 127`)}
rollback to savepoint forca;
set local app.permitir_rebaixar_edicao = '';

-- ── 215 ──
\\i ${M215}
${confere("215 · 5 overrides liberados: override NULL, visíveis (is_adult = false), com histórico", "(select count(*) from public.works where edition_state = 'mixed' and adult_override) = 1 and (select count(*) from public.work_adult_override_log where evidence->>'mig' = '215' and old_value and new_value is null) = 5")}
${confere("215 · adultas 166 → 161 (só as 5)", `${ADULTAS} = 161`)}
${confere("215 · One Last Night continua oculto", `(select adult_override and is_adult from public.works where id = '${ONE_LAST_NIGHT}')`)}
${confere("215 · nenhuma nota tocada", "(select h from antes where k = 'notas') = (select h from pg_temp.retrato() where k = 'notas')")}
create temp table h215 as select md5(string_agg(concat_ws(':', id, adult_override, is_adult), ',' order by id)) h from public.works;
\\i ${M215}
${confere("215 · idempotente (sem 2º registro no log)", "(select h from h215) = (select md5(string_agg(concat_ws(':', id, adult_override, is_adult), ',' order by id)) from public.works) and (select count(*) from public.work_adult_override_log) = 5")}

-- ── rollbacks, na ordem inversa ──
\\i ${R215}
${confere("rollback 215 · 6 overrides de volta, log apagado", `(select count(*) from public.works where edition_state = 'mixed' and adult_override) = 6 and to_regclass('public.work_adult_override_log') is null and ${ADULTAS} = 166`)}
\\i ${R214}
${confere("rollback 214 · tabela vazia e as 3 marcas de extras desfeitas", "(select count(*) from public.work_edition_scores) = 0 and (select count(*) from public.work_edition_state where r18_extra_chapters) = 7")}
\\i ${R213}
${confere("rollbacks 215→213 devolvem o retrato EXATO", "not exists (select 1 from antes a full join pg_temp.retrato() r using (k) where a.h is distinct from r.h)")}
rollback;
`

const GUARDAS = [
  ["guarda 214 · sem a 213 aplicada aborta", "", [M214], "a 213 não está aplicada"],
  ["guarda 214 · nota legada mudou desde a auditoria aborta",
    `update public.category_scores set score = 8.5 where work_id = '${LUCIA}' and criterion_slug = 'adult_content';`, [M213, M214], "diferente do auditado"],
  ["guarda 214 · obra deixou de ser mixed aborta",
    `update public.work_edition_state set state = 'single', basis = 'reviews' where work_id = '${LUCIA}';`, [M213, M214], "não é o auditado"],
  ["guarda 214 · obra de extras já marcada por outro caminho aborta",
    `update public.work_edition_state set r18_extra_chapters = true where work_id = '${EXTRAS_NOVAS[0]}';`, [M213, M214], "obras de extras"],
  ["guarda 213 · sem a 210 (flags das tags) aborta",
    "alter table public.tags rename column enrichment_status to enrichment_status_x;", [M213], "a 210 (tags adultas) não está aplicada"],
  ["guarda 214 rollback · com a 215 aplicada recusa", "", [M213, M214, M215, R214], "rode o rollback da 215 antes"],
  ["guarda 213 rollback · com dado presente recusa", "", [M213, M214, R213], "rode os rollbacks 215 e 214 antes"],
  ["guarda 215 · normal sem nota aborta", "", [M213, M214, "__QUEBRA_215__", M215], "passam no critério"],
]

function psql(url, input) {
  return spawnSync("psql", [url, "-X", "-q"], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

const r = psql(RETRATO, CASOS)
const notices = (r.stderr ?? "").split("\n").filter((l) => l.includes("NOTICE:  ok · ")).map((l) => l.replace(/.*NOTICE:\s+ok · /, ""))
console.log(`\nMigrations 213–215 sobre o retrato de produção (${RETRATO_DB})`)
for (const n of notices) console.log(`  ✓ ${n}`)
if (r.error || r.status !== 0) {
  const erro = (r.stderr ?? "").split("\n").filter((l) => /ERROR|FALHOU|could not connect|Connection refused|does not exist/.test(l)).join("\n")
  console.error(`\n🔴 FALHOU (psql exit ${r.status ?? r.error?.message}).\n${erro}`)
  if (/could not connect|Connection refused/.test(erro)) console.error("   O stack local está de pé? (`supabase start`, a partir do diretório do projeto)")
  if (new RegExp(`database "${RETRATO_DB}" does not exist`).test(erro)) console.error("   Monte o retrato (ver o cabeçalho deste arquivo).")
  process.exit(1)
}

console.log("\nGuardas de entrada")
let falhas = 0
for (const [caso, quebra, arquivos, esperado] of GUARDAS) {
  const passos = arquivos.map((a) =>
    a === "__QUEBRA_215__"
      ? "set local app.permitir_rebaixar_edicao = 'on';\nupdate public.work_edition_scores set score = null, source = 'not_rated', status = 'not_rated', confidence = null where edition = 'normal' and work_id = 'b0fe0d03-55a9-4a62-a092-145eab2e58b1';\nset local app.permitir_rebaixar_edicao = '';"
      : `\\i ${a}`,
  )
  const g = psql(RETRATO, `\\set ON_ERROR_STOP 1\nbegin;\n${quebra}\n${passos.join("\n")}\nrollback;\n`)
  const abortou = g.status !== 0 && (g.stderr ?? "").includes(esperado)
  console.log(`  ${abortou ? "✓" : "✗"} ${caso}`)
  if (!abortou) {
    falhas++
    console.error(`    esperava abortar com "${esperado}"; psql exit ${g.status}\n${(g.stderr ?? "").split("\n").filter((l) => /ERROR/.test(l)).join("\n")}`)
  }
}
if (falhas > 0) process.exit(1)
console.log(`\n✓ ${notices.length + GUARDAS.length} casos · transações desfeitas (ROLLBACK): nada persistiu.`)

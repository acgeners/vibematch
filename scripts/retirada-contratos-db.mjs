#!/usr/bin/env node
/**
 * TESTE DE BANCO da migration 218 (retirada de `s9-fantasy-b-v1` e `s9-fantasy-b-edicao-v1` de
 * `canonical_contract.scoring_contracts`) e do rollback dela — ALVO: um RETRATO DE PRODUÇÃO no Postgres
 * LOCAL do stack, US$0, nada persiste.
 *
 *   npm run test:db-retirada-contratos
 *   RETRATO_DB=retrato_pos_recalc_v2 node scripts/retirada-contratos-db.mjs
 *
 * O retrato precisa estar no estado de produção DEPOIS do recálculo v2 (2026-10-13 03:42Z): 213–217
 * aplicadas, contratos {v1, edicao-v1, edicao-v2}, `enforce` ligado, prompt {v32}, 1.065 linhas
 * `edicao-v2` em `calculated_scores` e 1.065 em `user_calculated_scores`, 10 + 887 históricas sem
 * contrato, nenhuma v1/edicao-v1. Montado assim: `node scripts/retrato-local-de-backup.mjs
 * .backups/2026-10-13T03-35-22-353Z <banco> --tabelas=<as 76 do backup>` (todas menos `anime_list`,
 * `ranking_strategy_snapshots`, `works_owner` e as `*_snapshot_20260713`) + o recálculo LOCAL
 * (`scripts/recalculate-scores.ts --local` servido por um PostgREST próprio sobre o retrato), cujo
 * resultado bateu com o de produção em 0 linhas de `calculated_scores`/`user_calculated_scores`.
 *
 * 🔴 TUDO em transações que terminam em ROLLBACK. Sem o stack de pé isto FALHA (não pula calado).
 *
 * O que prova:
 *   · antes: v1, edicao-v1 e edicao-v2 aceitos; edicao-v3, inventado e ausente recusados;
 *   · a 218 escreve UMA linha (`canonical_contract`) e nada mais — nem catálogo, nem tabela de score;
 *   · depois: só edicao-v2 aceito; v1, edicao-v1, edicao-v3, inventado e ausente recusados, nas DUAS
 *     tabelas de score; `enforce` e prompt intactos; o histórico sem contrato continua legível e
 *     editável fora do scoring; idempotência;
 *   · rollback 218: devolve {v1, edicao-v1, edicao-v2} (v1 e edicao-v1 aceitos de novo), idempotente;
 *   · guardas de entrada abortam (sessões separadas): linha em v1, linha em edicao-v1, contrato
 *     inesperado em linha, v2 sem uso, lista diferente, enforce desligado, prompt diferente.
 */
import { spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
const RETRATO_DB = process.env.RETRATO_DB ?? "retrato_pos_recalc_v2"
if (!/^[a-z0-9_]+$/.test(RETRATO_DB) || RETRATO_DB === "postgres") {
  console.error(`🔴 RETRATO_DB inválido: ${RETRATO_DB}`)
  process.exit(1)
}
// URL FIXA no stack local: é o local por construção, nunca a nuvem.
const RETRATO = `postgresql://postgres:postgres@127.0.0.1:54322/${RETRATO_DB}`
const M218 = path.join(ROOT, "supabase/migrations/218_retira_contratos_antigos.sql")
const R218 = path.join(ROOT, "scripts/rollback/218_rollback.sql")

const V1 = "s9-fantasy-b-v1"
const E1 = "s9-fantasy-b-edicao-v1"
const V2 = "s9-fantasy-b-edicao-v2"
const LISTA_ANTES = `'{${V1},${E1},${V2}}'::text[]`
const ORDENADA = (expr) => `(select array_agg(x order by x) from unnest(${expr}) x)`
const LISTA = "(select scoring_contracts from public.canonical_contract where id = 1)"

const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`)
const confere = (caso, cond) => `
do $c$ begin
  if not (${cond}) then raise exception using errcode = 'P9999', message = 'FALHOU: ' || ${q(caso)}; end if;
  raise notice 'ok · %', ${q(caso)};
end $c$;`

/**
 * Sonda do gatilho da 202: um upsert de UMA linha que já existe (o caminho do recálculo: INSERT … ON
 * CONFLICT DO UPDATE com scoring_contract), num sub-bloco que SEMPRE se desfaz. Recusa só conta se vier
 * do gatilho; qualquer outro erro ABORTA. A linha tem de ficar idêntica.
 */
const FUNCOES = `
create or replace function pg_temp.sonda(tabela text, contrato text) returns text language plpgsql as $f$
declare w uuid; u uuid; v numeric; antes text; depois text; estado text;
begin
  if tabela = 'calculated_scores' then
    select c.work_id, c.expected_score into w, v from public.calculated_scores c where c.scoring_contract = '${V2}' order by c.work_id limit 1;
    select md5(to_jsonb(t)::text) into antes from public.calculated_scores t where t.work_id = w;
  else
    select c.user_id, c.work_id, c.expected_score into u, w, v from public.user_calculated_scores c where c.scoring_contract = '${V2}' order by c.user_id, c.work_id limit 1;
    select md5(to_jsonb(t)::text) into antes from public.user_calculated_scores t where t.user_id = u and t.work_id = w;
  end if;
  if antes is null then raise exception using errcode = 'P9999', message = 'FALHOU: sonda ' || tabela || ' sem linha v2 para testar'; end if;
  v := case when v = 7.77 then 7.78 else 7.77 end;
  begin
    if tabela = 'calculated_scores' then
      insert into public.calculated_scores (work_id, expected_score, scoring_contract) values (w, v, contrato)
        on conflict (work_id) do update set expected_score = excluded.expected_score, scoring_contract = excluded.scoring_contract;
    else
      insert into public.user_calculated_scores (user_id, work_id, expected_score, scoring_contract) values (u, w, v, contrato)
        on conflict (user_id, work_id) do update set expected_score = excluded.expected_score, scoring_contract = excluded.scoring_contract;
    end if;
    raise exception using errcode = 'P0001', message = 'sonda-aceita';
  exception when others then
    if sqlerrm = 'sonda-aceita' then estado := 'aceito';
    elsif sqlstate = 'P0001' and sqlerrm like 'scoring RECUSADO pelo contrato canônico em ' || tabela || ': scoring_contract %' then estado := 'recusado';
    else raise exception using errcode = 'P9999', message = 'FALHOU: sonda ' || tabela || '/' || coalesce(contrato, '<nulo>') || ' por motivo inesperado: ' || sqlerrm;
    end if;
  end;
  if tabela = 'calculated_scores' then select md5(to_jsonb(t)::text) into depois from public.calculated_scores t where t.work_id = w;
  else select md5(to_jsonb(t)::text) into depois from public.user_calculated_scores t where t.user_id = u and t.work_id = w; end if;
  if depois is distinct from antes then raise exception using errcode = 'P9999', message = 'FALHOU: a sonda deixou a linha diferente'; end if;
  return estado;
end $f$;

-- "aceito"/"recusado" do contrato nas DUAS tabelas de score; diverge ⇒ "misto".
create or replace function pg_temp.gate(contrato text) returns text language sql as $f$
  select case when a = b then a else 'misto(' || a || '/' || b || ')' end
    from (select pg_temp.sonda('calculated_scores', contrato) a, pg_temp.sonda('user_calculated_scores', contrato) b) x
$f$;

create or replace function pg_temp.retrato() returns table (k text, h text) language plpgsql as $f$
begin
  return query select 'calc'::text, md5(string_agg(to_jsonb(c)::text, ',' order by c.work_id)) from public.calculated_scores c;
  return query select 'ucalc', md5(string_agg(to_jsonb(c)::text, ',' order by c.user_id, c.work_id)) from public.user_calculated_scores c;
  return query select 'edicao', md5(string_agg(to_jsonb(e)::text, ',' order by e.work_id, e.edition, e.criterion_slug)) from public.work_edition_scores e;
  return query select 'vies', md5(string_agg(to_jsonb(b)::text, ',' order by b.user_id, b.attribute_slug)) from public.attribute_bias b;
  return query select 'uws', md5(string_agg(to_jsonb(u)::text, ',' order by u.user_id, u.work_id)) from public.user_work_state u;
  return query select 'notas', md5(string_agg(to_jsonb(s)::text, ',' order by s.work_id, s.criterion_slug)) from public.category_scores s;
  return query select 'works', md5(string_agg(to_jsonb(w)::text, ',' order by w.id)) from public.works w;
  return query select 'contrato_resto', (select (to_jsonb(c) - 'scoring_contracts' - 'updated_at')::text from public.canonical_contract c where id = 1);
end $f$;`

const ESTADO_ANTES = `${ORDENADA(LISTA)} = ${ORDENADA(LISTA_ANTES)} and cardinality(${LISTA}) = 3
  and (select enforce from public.canonical_contract where id = 1) and (select eval_prompt_versions from public.canonical_contract where id = 1) = '{v32}'::text[]`
const SEM_ANTIGAS = `not exists (select 1 from public.calculated_scores where scoring_contract in ('${V1}', '${E1}'))
  and not exists (select 1 from public.user_calculated_scores where scoring_contract in ('${V1}', '${E1}'))`
const NULAS = `(select count(*) from public.calculated_scores where scoring_contract is null) || '/' || (select count(*) from public.user_calculated_scores where scoring_contract is null)`

const CASOS = `
\\set ON_ERROR_STOP 1
begin;
${FUNCOES}
create temp table antes as select * from pg_temp.retrato();
create temp table nulas_antes as select ${NULAS} as n;
create temp table xact (relid oid, ins bigint, upd bigint, del bigint);

-- ── estado de produção pós-recálculo v2 ──
${confere("antes · lista {v1, edicao-v1, edicao-v2}, enforce ligado, prompt {v32}", ESTADO_ANTES)}
${confere("antes · edicao-v2 em uso nas duas tabelas e nenhuma linha v1/edicao-v1", `(select count(*) from public.calculated_scores where scoring_contract = '${V2}') > 0 and (select count(*) from public.user_calculated_scores where scoring_contract = '${V2}') > 0 and ${SEM_ANTIGAS}`)}
${confere("antes · há histórico sem contrato nas duas tabelas", "(select count(*) from public.calculated_scores where scoring_contract is null) > 0 and (select count(*) from public.user_calculated_scores where scoring_contract is null) > 0")}
${confere("antes · v1, edicao-v1 e edicao-v2 aceitos", `pg_temp.gate('${V1}') = 'aceito' and pg_temp.gate('${E1}') = 'aceito' and pg_temp.gate('${V2}') = 'aceito'`)}
${confere("antes · edicao-v3, inventado e ausente recusados", "pg_temp.gate('s9-fantasy-b-edicao-v3') = 'recusado' and pg_temp.gate('s9-x-inventado') = 'recusado' and pg_temp.gate(null) = 'recusado'")}

-- ── a 218 ──
insert into xact select relid, n_tup_ins, n_tup_upd, n_tup_del from pg_stat_xact_all_tables;
\\i ${M218}
${confere("218 · escreveu SÓ 1 linha de canonical_contract (nenhuma outra tabela, nenhum catálogo)", `(select string_agg(s.schemaname || '.' || s.relname || ':' || (s.n_tup_ins - coalesce(x.ins, 0)) || '/' || (s.n_tup_upd - coalesce(x.upd, 0)) || '/' || (s.n_tup_del - coalesce(x.del, 0)), ',')
    from pg_stat_xact_all_tables s left join xact x on x.relid = s.relid
   where s.schemaname not like 'pg_temp%' and (s.n_tup_ins, s.n_tup_upd, s.n_tup_del) is distinct from (coalesce(x.ins, 0), coalesce(x.upd, 0), coalesce(x.del, 0)))
  = 'public.canonical_contract:0/1/0'`)}
${confere("218 · lista = {edicao-v2}; enforce e prompt intactos", `${LISTA} = '{${V2}}'::text[] and (select enforce from public.canonical_contract where id = 1) and (select eval_prompt_versions from public.canonical_contract where id = 1) = '{v32}'::text[]`)}
${confere("218 · edicao-v2 aceito nas duas tabelas", `pg_temp.gate('${V2}') = 'aceito'`)}
${confere("218 · v1 recusado nas duas tabelas", `pg_temp.gate('${V1}') = 'recusado'`)}
${confere("218 · edicao-v1 recusado nas duas tabelas", `pg_temp.gate('${E1}') = 'recusado'`)}
${confere("218 · edicao-v3, inventado e ausente recusados", "pg_temp.gate('s9-fantasy-b-edicao-v3') = 'recusado' and pg_temp.gate('s9-x-inventado') = 'recusado' and pg_temp.gate(null) = 'recusado'")}
${confere("218 · histórico sem contrato intacto e legível", `${NULAS} = (select n from nulas_antes) and (select count(*) from public.calculated_scores c where c.scoring_contract is null and c.work_id is not null) > 0`)}
savepoint historico;
update public.calculated_scores set alignment_stale = not alignment_stale where work_id = (select work_id from public.calculated_scores where scoring_contract is null order by work_id limit 1);
${confere("218 · linha histórica sem contrato continua editável FORA do scoring (alignment_stale)", "true")}
rollback to savepoint historico;
${confere("218 · nenhuma tabela de score, edição, viés, estado, nota ou obra mudou", "not exists (select 1 from antes a full join pg_temp.retrato() r using (k) where a.h is distinct from r.h)")}

create temp table linha_218 as select to_jsonb(c) j from public.canonical_contract c where id = 1;
\\i ${M218}
${confere("218 · idempotente: rodar de novo não muda a linha do contrato", "(select j from linha_218) = (select to_jsonb(c) from public.canonical_contract c where id = 1)")}

-- ── rollback 218 ──
\\i ${R218}
${confere("rollback 218 · lista de volta a {v1, edicao-v1, edicao-v2}; enforce e prompt intactos", ESTADO_ANTES)}
${confere("rollback 218 · v1, edicao-v1 e edicao-v2 aceitos de novo; inventado recusado", `pg_temp.gate('${V1}') = 'aceito' and pg_temp.gate('${E1}') = 'aceito' and pg_temp.gate('${V2}') = 'aceito' and pg_temp.gate('s9-x-inventado') = 'recusado'`)}
create temp table linha_rb as select to_jsonb(c) j from public.canonical_contract c where id = 1;
\\i ${R218}
${confere("rollback 218 · idempotente", "(select j from linha_rb) = (select to_jsonb(c) from public.canonical_contract c where id = 1)")}
${confere("rollback 218 · nada de dado mexido", "not exists (select 1 from antes a full join pg_temp.retrato() r using (k) where a.h is distinct from r.h)")}
rollback;
`

const UMA_V2_CALC = `(select work_id from public.calculated_scores where scoring_contract = '${V2}' order by work_id limit 1)`
const GUARDAS = [
  ["linha de calculated_scores em v1 aborta",
    `update public.calculated_scores set scoring_contract = '${V1}' where work_id = ${UMA_V2_CALC};`, [M218], "ainda gravadas com s9-fantasy-b-v1/s9-fantasy-b-edicao-v1"],
  ["linha de user_calculated_scores em edicao-v1 aborta",
    `update public.user_calculated_scores set scoring_contract = '${E1}' where (user_id, work_id) = (select user_id, work_id from public.user_calculated_scores where scoring_contract = '${V2}' order by user_id, work_id limit 1);`,
    [M218], "ainda gravadas com s9-fantasy-b-v1/s9-fantasy-b-edicao-v1"],
  ["linha com contrato inesperado aborta",
    `update public.calculated_scores set scoring_contract = 's9-x-inventado' where work_id = ${UMA_V2_CALC};`, [M218], "contrato inesperado"],
  ["edicao-v2 sem uso (recálculo v2 não rodou) aborta",
    `update public.calculated_scores set scoring_contract = null where scoring_contract = '${V2}';`, [M218], "o recálculo v2 não rodou"],
  ["lista anterior à 217 aborta",
    `update public.canonical_contract set scoring_contracts = '{${V1},${E1}}' where id = 1;`, [M218], "não é o esperado"],
  ["lista com um contrato a mais aborta",
    `update public.canonical_contract set scoring_contracts = '{${V1},${E1},${V2},s9-fantasy-b-edicao-v3}' where id = 1;`, [M218], "não é o esperado"],
  ["enforce desligado aborta",
    "update public.canonical_contract set enforce = false where id = 1;", [M218], "enforce não está ligado"],
  ["prompt diferente aborta",
    "update public.canonical_contract set eval_prompt_versions = '{v32,v33}' where id = 1;", [M218], "versões de prompt"],
  ["rollback 218 sobre estado que não é o da 218 aborta",
    `update public.canonical_contract set scoring_contracts = '{${V2},s9-fantasy-b-edicao-v3}' where id = 1;`, [R218], "não é o estado da 218"],
]

function psql(url, input) {
  return spawnSync("psql", [url, "-X", "-q"], { input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
}

const r = psql(RETRATO, CASOS)
const notices = (r.stderr ?? "").split("\n").filter((l) => l.includes("NOTICE:  ok · ")).map((l) => l.replace(/.*NOTICE:\s+ok · /, ""))
console.log(`\nMigration 218 e rollback sobre o retrato de produção pós-recálculo v2 (${RETRATO_DB})`)
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
  const g = psql(RETRATO, `\\set ON_ERROR_STOP 1\nbegin;\n${quebra}\n${arquivos.map((a) => `\\i ${a}`).join("\n")}\nrollback;\n`)
  const abortou = g.status !== 0 && (g.stderr ?? "").includes(esperado)
  console.log(`  ${abortou ? "✓" : "✗"} ${caso}`)
  if (!abortou) {
    falhas++
    console.error(`    esperava abortar com "${esperado}"; psql exit ${g.status}\n${(g.stderr ?? "").split("\n").filter((l) => /ERROR|NOTICE/.test(l)).join("\n")}`)
  }
}
if (falhas > 0) process.exit(1)
console.log(`\n✓ ${notices.length + GUARDAS.length} casos · transações desfeitas (ROLLBACK): nada persistiu.`)

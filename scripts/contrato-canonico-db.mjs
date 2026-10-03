#!/usr/bin/env node
/**
 * TESTE DE BANCO do contrato canônico (migration 202) — ALVO: o Postgres LOCAL do stack, US$0,
 * nada persiste.
 *
 *   npm run test:db-contract
 *   node scripts/contrato-canonico-db.mjs
 *
 * Os triggers da 202 são a barreira final contra um checkout defasado gravando avaliação ou
 * scoring na nuvem (o incidente de 02–03/10/2026). O vitest não tem Postgres, e um teste que
 * "pula quando não alcança o banco" sumiria da suíte calado — por isso isto é script (mesma
 * escolha do `npm run contracts`): sem o stack de pé ele FALHA, com a linha de comando.
 *
 * 🔴 TUDO numa transação que termina em ROLLBACK: aplica a migration do REPO sobre o schema REAL
 * da réplica (idempotente — vale também quando a réplica já veio com a 202), liga `enforce`, roda
 * as asserções e desfaz. Nenhuma linha, coluna, função ou trigger sobra. Os locks duram o tempo do
 * teste (segundos); com o app local escrevendo nessas tabelas ao mesmo tempo, ele espera.
 *
 * Os upserts reproduzem o SQL que o PostgREST gera para `.upsert(rows, { onConflict })`:
 * `INSERT (colunas enviadas) … ON CONFLICT DO UPDATE SET <só as colunas enviadas>` — conferido no
 * log do Postgres com o PostgREST real em 2026-10-03. O writer ANTIGO é a mesma linha sem
 * `scoring_contract`.
 *
 * Cobre o mínimo que impede o incidente de voltar — não as sondas exploratórias (essas ficaram
 * registradas na migration).
 */
import { spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
// A mesma URL fixa de `db-diff.mjs` / `db-local-backup.mjs`: é o stack local por construção, nunca a nuvem.
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const MIGRATION = path.join(ROOT, "supabase/migrations/202_canonical_contract.sql")

// Linha que o recalc grava (rowsComArte de `server/actions/calculations.ts`), SEM o contrato.
const COLS_RECALC = [
  "total_votes", "platform_avg", "ia_eval", "ia_eval_normalized", "chapters_normalized", "calc_score",
  "expected_score", "expected_baseline", "expected_quality_adj", "expected_is_stub", "mae_calc", "rmse_calc",
  "personal_fit", "personal_fit_percentile", "chance_score", "chance_is_stub", "tag_overlap_net",
  "formula_version", "calculated_at", "art_estimate", "art_percentile",
]
const VALS_RECALC = (exp) =>
  `100, 7.1, 6.2, 6.4, 0.5, 6.9, ${exp}, 7, 0, false, 0.6, 0.8, 0.5, 50, 55, false, 1, 'v15', now(), null, null`
const upsertCs = (w, exp, contrato) => {
  const cols = [...COLS_RECALC, ...(contrato ? ["scoring_contract"] : [])]
  const vals = `${VALS_RECALC(exp)}${contrato ? `, '${contrato}'` : ""}`
  return `insert into public.calculated_scores (work_id, ${cols.join(", ")}) values (${w}, ${vals})
    on conflict (work_id) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`
}
// Espelho per-user (`mirrorOwnerScores`): colunas pessoais, SEM o contrato no writer antigo.
const upsertUcs = (u, w, exp, contrato) => {
  const cols = ["updated_at", "expected_score", "calc_score", "personal_fit", "personal_fit_percentile", ...(contrato ? ["scoring_contract"] : [])]
  const vals = `now(), ${exp}, 6.9, 0.5, 50${contrato ? `, '${contrato}'` : ""}`
  return `insert into public.user_calculated_scores (user_id, work_id, ${cols.join(", ")}) values (${u}, ${w}, ${vals})
    on conflict (user_id, work_id) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`
}

const OK = "s9-fantasy-b-v1"

/** `stmt` TEM de ser recusado pela guarda da 202 (P0001 com "contrato canônico" na mensagem). */
const recusa = (caso, stmt) => `
  begin
    ${stmt};
    raise exception using errcode = 'P9999', message = 'FALHOU: ' || ${q(caso)} || ' — esperava RECUSA e foi aceito';
  exception when sqlstate 'P0001' then
    if sqlerrm not like '%contrato canônico%' then raise; end if;
    raise notice 'ok · %', ${q(caso)};
  end;`
/** `stmt` TEM de passar. */
const aceita = (caso, stmt) => `
  ${stmt};
  raise notice 'ok · %', ${q(caso)};`
function q(s) {
  return `'${s.replace(/'/g, "''")}'`
}

const sql = `
\\set ON_ERROR_STOP 1
begin;
\\i ${MIGRATION}
do $teste$
declare
  w1 uuid; w2 uuid; wn uuid; u uuid; wu uuid; ev uuid;
begin
  select work_id into w1 from public.calculated_scores order by work_id limit 1;
  select work_id into w2 from public.calculated_scores order by work_id offset 1 limit 1;
  select work_id into wn from public.calculated_scores order by work_id offset 2 limit 1;
  select user_id, work_id into u, wu from public.user_calculated_scores order by user_id, work_id limit 1;
  if w1 is null or w2 is null or wn is null or u is null then
    raise exception using errcode = 'P9999', message = 'FALHOU: a réplica local não tem linhas de score para testar (rode npm run db:pull)';
  end if;
  -- "linha nova" sem criar obra: some com a linha de score dela (dentro da transação).
  delete from public.calculated_scores where work_id = wn;

  -- ── enforce = false: o comportamento antigo continua permitido ──
  update public.canonical_contract set enforce = false where id = 1;
  ${aceita("enforce OFF · writer antigo grava scoring", upsertCs("w1", "7.5", null))}
  insert into public.ai_evaluations (work_id, status, prompt_version) values (w1, 'completed', 'v31') returning id into ev;
  raise notice 'ok · enforce OFF · grava avaliação v31';

  -- ── enforce = true ──
  update public.canonical_contract set enforce = true where id = 1;

  -- scoring: calculated_scores
  ${recusa("antigo sem scoring_contract · linha nova", upsertCs("wn", "7.5", null))}
  ${aceita("novo com contrato correto", upsertCs("w2", "7.2", OK))}
  if (select scoring_contract from public.calculated_scores where work_id = w2) is distinct from ${q(OK)} then
    raise exception using errcode = 'P9999', message = 'FALHOU: o contrato não ficou gravado na linha';
  end if;
  ${recusa("antigo sem scoring_contract · linha existente já canônica", upsertCs("w2", "6.1", null))}
  ${recusa("novo com contrato incorreto", upsertCs("w1", "7.2", "s9-sem-strategy-b"))}
  ${recusa("UPDATE puro de scoring sem contrato validado", "update public.calculated_scores set expected_score = 1.0 where work_id = w2")}
  ${aceita("UPDATE fora do scoring: alignment_stale", "update public.calculated_scores set alignment_stale = true where work_id = w2")}
  ${aceita("UPDATE fora do scoring: art_estimate", "update public.calculated_scores set art_estimate = 6.5, art_percentile = 70 where work_id = w2")}
  -- O upsert do Veredito (só alignment_*) passa pelo BEFORE INSERT com os DEFAULTs da tabela
  -- (mae_calc, *_is_stub) na linha proposta — que não podem contar como "trouxe scoring".
  ${aceita("upsert do Veredito (só alignment_*)", "insert into public.calculated_scores (work_id, alignment_score, alignment_at) values (w2, 61, now()) on conflict (work_id) do update set alignment_score = excluded.alignment_score, alignment_at = excluded.alignment_at")}
  if (select expected_score from public.calculated_scores where work_id = w2) <> 7.2 then
    raise exception using errcode = 'P9999', message = 'FALHOU: uma escrita recusada alterou a linha canônica';
  end if;

  -- scoring: user_calculated_scores (o espelho per-user)
  ${aceita("espelho · novo com contrato correto", upsertUcs("u", "wu", "7.3", OK))}
  ${recusa("espelho · antigo sem scoring_contract · linha existente já canônica", upsertUcs("u", "wu", "6.0", null))}
  ${aceita("espelho · upsert do Veredito (só alignment_*)", "insert into public.user_calculated_scores (user_id, work_id, alignment_score, updated_at) values (u, wu, 61, now()) on conflict (user_id, work_id) do update set alignment_score = excluded.alignment_score, updated_at = excluded.updated_at")}

  -- avaliação
  ${aceita("avaliação · prompt_version v32", "insert into public.ai_evaluations (work_id, status, prompt_version) values (w1, 'completed', 'v32')")}
  ${recusa("avaliação · prompt_version incompatível (v31)", "insert into public.ai_evaluations (work_id, status, prompt_version) values (w1, 'completed', 'v31')")}
  ${aceita("avaliação · update de status de v31 histórica", "update public.ai_evaluations set status = 'failed' where id = ev")}
end
$teste$;
rollback;
`

const r = spawnSync("psql", [LOCAL, "-X", "-q"], { input: sql, encoding: "utf8" })
const notices = (r.stderr ?? "").split("\n").filter((l) => l.includes("NOTICE:  ok · ")).map((l) => l.replace(/.*NOTICE:\s+/, ""))
for (const n of notices) console.log(`  ✓ ${n.replace(/^ok · /, "")}`)
if (r.error || r.status !== 0) {
  const erro = (r.stderr ?? "").split("\n").filter((l) => /ERROR|FALHOU|could not connect|Connection refused/.test(l)).join("\n")
  console.error(`\n🔴 teste de banco do contrato canônico FALHOU (psql exit ${r.status ?? r.error?.message}).\n${erro}`)
  if (/could not connect|Connection refused/.test(erro)) console.error("   O stack local está de pé? (`supabase start`, a partir do diretório do projeto)")
  process.exit(1)
}
console.log(`\n✓ ${notices.length} casos · transação desfeita (ROLLBACK): nada persistiu no banco local.`)

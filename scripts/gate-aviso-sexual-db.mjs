#!/usr/bin/env node
/**
 * TESTE DE BANCO da migration 203 (aviso de violência/abuso sexual não liga o gate 18+) —
 * ALVO: o Postgres LOCAL do stack, US$0, nada persiste.
 *
 *   npm run test:db-gate-aviso-sexual
 *   node scripts/gate-aviso-sexual-db.mjs
 *
 * Mesma escolha do `npm run test:db-contract`: o vitest não tem Postgres, e um teste que "pula
 * quando não alcança o banco" sumiria calado — sem o stack de pé isto FALHA, com a linha de comando.
 *
 * 🔴 TUDO numa transação que termina em ROLLBACK. Aplica a migration do REPO sobre o schema REAL da
 * réplica, com 12 cenários montados em obras reais (estado sintético, desfeito no fim):
 *   · o recálculo de `adult_auto`/`adult_reason` (só quem dependia do conjunto);
 *   · override, r19_edition, nota e `adult_score_tier` intocados;
 *   · nenhuma obra passa a 18+; nada fora do conjunto causal muda;
 *   · idempotência (2ª aplicação não muda nada) e rollback (`scripts/rollback/203_rollback.sql`
 *     devolve o estado exato de antes).
 * E três sessões separadas provam que as guardas de ENTRADA abortam.
 *
 * ⚠️ A réplica local é de 2026-08-23: falta a tag `drugging-roofing` (criada na nuvem em 27/09). O
 * preparo a cria DENTRO da transação. Os NÚMEROS da nuvem (63 · 34 → 29) não são verificáveis aqui —
 * a réplica é outra — e são conferidos à parte, sobre um retrato da nuvem.
 */
import { spawnSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
// A mesma URL fixa de `contrato-canonico-db.mjs`: é o stack local por construção, nunca a nuvem.
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const MIGRATION = path.join(ROOT, "supabase/migrations/203_aviso_sexual_nao_liga_gate_18.sql")
const ROLLBACK = path.join(ROOT, "scripts/rollback/203_rollback.sql")
const CONTENT_INDICATOR = "90edf1bb-a80e-459e-b421-ebca4e493128"

/** Garante as 13 tags no estado ORIGINAL (a réplica pode não ter alguma). Roda dentro da transação. */
const PREPARO_TAGS = `
do $prep$
begin
  insert into public.tags (slug, name, tag_group_id, adult_indicator, adult_indicator_strong)
  values ('drugging-roofing', 'Drugging/Roofing', '${CONTENT_INDICATOR}', true, true)
  on conflict (slug) do nothing;
  update public.tags set adult_indicator = true, adult_indicator_strong = (slug <> 'non-consensual-relationship'), adult_score_tier = null
   where slug in ('rape-as-a-start-of-relationship','gang-rape','pedophilia','reverse-rape','drugging-roofing',
                  'attempted-gang-rape','attempted-reverse-rape','rape-by-lover','child-sexual-abuse',
                  'sleep-molestation','groping','chikan','non-consensual-relationship');
end
$prep$;`

/** Os 12 cenários: (obra, tags, nota, adult_auto, motivo, override) → o que a 203 tem de deixar. */
const CENARIOS = [
  // id, tags (slugs), nota, auto, motivo, override, esperado {auto, motivo, is_adult}, descrição
  ["s1", ["gang-rape"], 6, true, "tag_explicit", null, { auto: false, motivo: null, adult: false }, "só a tag do conjunto ⇒ sai do 18+"],
  ["s2", ["gang-rape", "r19"], 6, true, "tag_explicit", null, { auto: true, motivo: "tag_explicit", adult: true }, "conjunto + outra strong (R19) ⇒ continua 18+"],
  ["s3", ["gang-rape", "sexual-content"], 8, true, "tag_explicit", null, { auto: true, motivo: "tag_soft_score", adult: true }, "conjunto + soft com nota 8 ⇒ continua, motivo vira tag_soft_score"],
  ["s4", ["gang-rape", "sexual-content"], 5, true, "tag_explicit", null, { auto: false, motivo: null, adult: false }, "conjunto + soft com nota 5 ⇒ sai"],
  ["s5", ["pedophilia"], 6, true, "tag_explicit", true, { auto: false, motivo: null, adult: true }, "override = true continua vencendo"],
  ["s6", ["reverse-rape"], 5, true, "tag_explicit", false, { auto: false, motivo: null, adult: false }, "override = false continua vencendo"],
  ["s7", ["groping", "r19-disponivel"], 7, true, "tag_explicit", null, { auto: false, motivo: null, adult: false, r19: true }, "r19_edition intocado"],
  ["s8", ["chikan"], 9, true, "ai_review", null, { auto: true, motivo: "ai_review", adult: true }, "ai_review (evidência independente) intocado"],
  ["s9", ["non-consensual-relationship", "sexual-content"], 9, false, null, null, { auto: false, motivo: null, adult: false }, "adult_auto = false NUNCA sobe"],
  ["s10", ["non-consensual-relationship"], 8, true, "tag_soft_score", null, { auto: false, motivo: null, adult: false }, "NCR (soft) + nota 8 sozinha ⇒ sai"],
  ["s11", [], 9, true, "tag_explicit", null, { auto: true, motivo: "tag_explicit", adult: true }, "legado sem tag do conjunto: fora do escopo"],
  ["s12", ["non-consensual-relationship"], 3, true, "tag_explicit", null, { auto: true, motivo: "tag_explicit", adult: true }, "já não se sustentava NEM com o conjunto: fora do escopo"],
]

const q = (s) => (s == null ? "null" : `'${String(s).replace(/'/g, "''")}'`)

const MONTA = `
do $monta$
declare ids uuid[];
begin
  -- 12 obras reais sem nenhuma tag adulta e sem edição R19: o estado sintético é montado nelas.
  select array_agg(id order by id) into ids from (
    select w.id from public.works w
     where not w.is_archived and w.adult_override is null and not w.r19_edition
       and not exists (select 1 from public.work_tags wt join public.tags t on t.id = wt.tag_id
                        where wt.work_id = w.id and (t.adult_indicator or t.marks_r19_edition))
     order by w.id limit ${CENARIOS.length}) x;
  if coalesce(array_length(ids, 1), 0) < ${CENARIOS.length} then
    raise exception using errcode = 'P9999', message = 'FALHOU: a réplica local não tem obras limpas suficientes (rode npm run db:pull)';
  end if;
  create temp table t_cenario (cen text primary key, work_id uuid not null) on commit drop;
  ${CENARIOS.map(([cen], i) => `insert into t_cenario values (${q(cen)}, ids[${i + 1}]);`).join("\n  ")}
${CENARIOS.map(([cen, tags, nota, auto, motivo, override]) => `
  ${tags.map((t) => `insert into public.work_tags (work_id, tag_id, source) select (select work_id from t_cenario where cen = ${q(cen)}), id, 'teste-203' from public.tags where slug = ${q(t)} on conflict do nothing;`).join("\n  ")}
  insert into public.category_scores (work_id, criterion_slug, score, source)
    values ((select work_id from t_cenario where cen = ${q(cen)}), 'adult_content', ${nota}, 'manual')
    on conflict (work_id, criterion_slug) do update set score = excluded.score;
  update public.works set adult_auto = ${auto}, adult_reason = ${q(motivo)}, adult_override = ${override == null ? "null" : override}
   where id = (select work_id from t_cenario where cen = ${q(cen)});`).join("")}
end
$monta$;

-- Retratos de ANTES da migration (o rollback tem de voltar exatamente a eles).
create temp table t_works_pre on commit drop as select id, adult_auto, adult_reason, adult_override, r19_edition, is_adult from public.works;
create temp table t_tags_pre on commit drop as select slug, adult_indicator, adult_indicator_strong, adult_score_tier from public.tags;
create temp table t_notas_pre on commit drop as select work_id, score from public.category_scores where criterion_slug = 'adult_content';`

const confere = (caso, cond) => `
  if not (${cond}) then raise exception using errcode = 'P9999', message = 'FALHOU: ' || ${q(caso)}; end if;
  raise notice 'ok · %', ${q(caso)};`

const ASSERCOES = `
do $teste$
declare r record;
begin
${CENARIOS.map(([cen, , , , , override, esp, desc]) => `
  select w.adult_auto, w.adult_reason, w.is_adult, w.adult_override, w.r19_edition into r
    from public.works w where w.id = (select work_id from t_cenario where cen = ${q(cen)});
  ${confere(`${cen} · ${desc}`, `r.adult_auto = ${esp.auto} and r.adult_reason is not distinct from ${q(esp.motivo)} and r.is_adult = ${esp.adult} and r.adult_override is not distinct from ${override == null ? "null::boolean" : override}${esp.r19 ? " and r.r19_edition" : ""}`)}`).join("")}

  ${confere("as 13 tags não ligam mais o gate", "(select count(*) from public.tags where slug in (select slug from mig203_conjunto) and (adult_indicator or adult_indicator_strong)) = 0")}
  ${confere("adult_score_tier intocado em TODAS as tags", "not exists (select 1 from public.tags t join t_tags_pre p using (slug) where t.adult_score_tier is distinct from p.adult_score_tier)")}
  ${confere("flags das tags FORA do conjunto intocadas", "not exists (select 1 from public.tags t join t_tags_pre p using (slug) where t.slug not in (select slug from mig203_conjunto) and (t.adult_indicator, t.adult_indicator_strong) is distinct from (p.adult_indicator, p.adult_indicator_strong))")}
  ${confere("nenhuma nota adult_content mudou", "not exists (select 1 from public.category_scores c join t_notas_pre p using (work_id) where c.criterion_slug = 'adult_content' and c.score is distinct from p.score)")}
  ${confere("override e r19_edition intocados em TODAS as obras", "not exists (select 1 from public.works w join t_works_pre p using (id) where (w.adult_override, w.r19_edition) is distinct from (p.adult_override, p.r19_edition))")}
  ${confere("nenhuma obra passou a 18+", "not exists (select 1 from public.works w join t_works_pre p using (id) where w.is_adult and not p.is_adult)")}
  ${confere("só obras do plano mudaram", "not exists (select 1 from public.works w join t_works_pre p using (id) where (w.adult_auto, w.adult_reason) is distinct from (p.adult_auto, p.adult_reason) and w.id not in (select work_id from bkp.mig203_works_antes))")}
  ${confere("o backup guardou as 13 tags no estado original", "(select count(*) from bkp.mig203_tags_antes where adult_indicator) = 13")}
end
$teste$;

create temp table t_works_pos1 on commit drop as select id, adult_auto, adult_reason from public.works;`

const IDEMPOTENTE = `
do $teste$
begin
  ${confere("idempotente: a 2ª aplicação não muda nenhuma obra", "not exists (select 1 from public.works w join t_works_pos1 p using (id) where (w.adult_auto, w.adult_reason) is distinct from (p.adult_auto, p.adult_reason))")}
end
$teste$;`

const VOLTOU = `
do $teste$
begin
  ${confere("rollback: obras de volta ao estado de antes", "not exists (select 1 from public.works w join t_works_pre p using (id) where (w.adult_auto, w.adult_reason, w.is_adult) is distinct from (p.adult_auto, p.adult_reason, p.is_adult))")}
  ${confere("rollback: flags das tags de volta", "not exists (select 1 from public.tags t join t_tags_pre p using (slug) where (t.adult_indicator, t.adult_indicator_strong) is distinct from (p.adult_indicator, p.adult_indicator_strong))")}
end
$teste$;`

const principal = `
\\set ON_ERROR_STOP 1
begin;
${PREPARO_TAGS}
${MONTA}
\\i ${MIGRATION}
${ASSERCOES}
\\i ${MIGRATION}
${IDEMPOTENTE}
\\i ${ROLLBACK}
${VOLTOU}
rollback;
`

/** As guardas de ENTRADA: cada sessão quebra uma premissa e a migration tem de ABORTAR. */
const GUARDAS = [
  ["guarda · tag renomeada aborta", "update public.tags set name = 'Gang Rape (renomeada)' where slug = 'gang-rape';", "esperava as 13 tags"],
  ["guarda · estado misto aborta", "update public.tags set adult_indicator = false, adult_indicator_strong = false where slug = 'groping';", "estado misto"],
  ["guarda · piso de nota numa tag do conjunto aborta", "update public.tags set adult_score_tier = 'label' where slug = 'chikan';", "adult_score_tier"],
]

function psql(input) {
  return spawnSync("psql", [LOCAL, "-X", "-q"], { input, encoding: "utf8" })
}

const r = psql(principal)
const notices = (r.stderr ?? "").split("\n").filter((l) => l.includes("NOTICE:  ok · ")).map((l) => l.replace(/.*NOTICE:\s+/, ""))
const resumo = (r.stderr ?? "").split("\n").filter((l) => /NOTICE:  (mig 203|rollback 203)/.test(l)).map((l) => l.replace(/.*NOTICE:\s+/, ""))
for (const n of notices) console.log(`  ✓ ${n.replace(/^ok · /, "")}`)
for (const n of resumo) console.log(`    · ${n}`)
if (r.error || r.status !== 0) {
  const erro = (r.stderr ?? "").split("\n").filter((l) => /ERROR|FALHOU|could not connect|Connection refused/.test(l)).join("\n")
  console.error(`\n🔴 teste de banco da migration 203 FALHOU (psql exit ${r.status ?? r.error?.message}).\n${erro}`)
  if (/could not connect|Connection refused/.test(erro)) console.error("   O stack local está de pé? (`supabase start`, a partir do diretório do projeto)")
  process.exit(1)
}

let falhas = 0
for (const [caso, quebra, esperado] of GUARDAS) {
  const g = psql(`\\set ON_ERROR_STOP 1\nbegin;\n${PREPARO_TAGS}\n${quebra}\n\\i ${MIGRATION}\nrollback;\n`)
  const abortou = g.status !== 0 && (g.stderr ?? "").includes(esperado)
  console.log(`  ${abortou ? "✓" : "✗"} ${caso}`)
  if (!abortou) {
    falhas++
    console.error(`    esperava abortar com "${esperado}"; psql exit ${g.status}\n${(g.stderr ?? "").split("\n").filter((l) => /ERROR/.test(l)).join("\n")}`)
  }
}
if (falhas > 0) process.exit(1)

console.log(`\n✓ ${notices.length + GUARDAS.length} casos · transações desfeitas (ROLLBACK): nada persistiu no banco local.`)

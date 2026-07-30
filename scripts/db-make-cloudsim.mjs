#!/usr/bin/env node
/**
 * Monta o `cloudsim`: um clone DESCARTÁVEL da nuvem, no Postgres local, para ensaiar
 * pushes de verdade (com COMMIT) antes de tocar a produção.
 *
 *   node scripts/db-make-cloudsim.mjs          (recria do zero)
 *
 * Por que existe: `--dry-run` dá rollback e **sai antes da conferência** — ou seja, o
 * caminho do COMMIT e todo o código de verificação do pusher ficam sem execução. Um push
 * que "passou no dry-run" pode falhar na hora H por causa de algo que só acontece no
 * commit (constraint DEFERRED, trigger de AFTER, checagem pós-escrita).
 *
 * Fonte: o dump que o `db:pull` já gravou em `.backups/pull-*` — não bate na nuvem.
 *
 * O `auth` é um STUB (só `auth.users(id)` + `auth.uid()`): as 47 policies do `public`
 * chamam `auth.uid()` e `user_settings` tem FK pra `auth.users`. Sem isso o restore perde
 * policies e uma FK, em silêncio.
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname, "..")
const DB_NAME = "cloudsim"

const die = (msg) => {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

const LOCAL = (() => {
  try {
    const raw = execFileSync("supabase", ["--workdir", ROOT, "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return raw.match(/^DB_URL="(.+)"$/m)?.[1] ?? die("`supabase status` não trouxe DB_URL")
  } catch {
    return die("`supabase status` falhou — o stack local está de pé?")
  }
})()
const SIM = LOCAL.replace(/\/postgres(\?|$)/, `/${DB_NAME}$1`)

const dir = path.join(ROOT, ".backups")
const pulls = fs.existsSync(dir) ? fs.readdirSync(dir).filter((d) => d.startsWith("pull-")).sort() : []
if (!pulls.length) die("não achei `.backups/pull-*` — rode `npm run db:pull` primeiro")
const pullDir = path.join(dir, pulls[pulls.length - 1])
const dataFile = path.join(pullDir, "cloud-data.sql")
const postFile = path.join(pullDir, "cloud-post.sql")
for (const f of [dataFile, postFile]) if (!fs.existsSync(f)) die(`falta ${path.relative(ROOT, f)}`)

const run = (url, sql, label) => {
  const r = spawnSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" })
  if (r.status !== 0) die(`${label} falhou:\n${(r.stderr || "").trim()}`)
  return (r.stdout || "").trim()
}
const runFile = (url, file, label) => {
  // ON_ERROR_STOP=0: o dump tem comandos que falham de forma benigna (extension já existe).
  // Quem julga o restore é a CONFERÊNCIA no fim, não o exit code — psql sai 0 mesmo cuspindo erro.
  const r = spawnSync("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=0", "-f", file], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  })
  const errs = (r.stderr || "").split("\n").filter((l) => l.startsWith("ERROR"))
  console.log(`  ${label}: ${errs.length} erro(s)`)
  return errs
}
const q = (url, sql) =>
  execFileSync("psql", [url, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8" }).trim()

console.log(`origem do dump: ${path.relative(ROOT, pullDir)}`)
console.log(`destino       : ${DB_NAME} (no Postgres local)\n`)

console.log(`→ recriando o database`)
run(LOCAL, `drop database if exists ${DB_NAME} with (force)`, "drop database")
run(LOCAL, `create database ${DB_NAME}`, "create database")

console.log(`→ extensions + stub de auth`)
// pg_dump --schema NÃO leva as extensions de que o schema depende: `vector` e `pg_trgm`
// moram dentro do `public` na nuvem, e sem elas a coluna `embedding vector` quebra.
run(SIM, `create extension if not exists vector; create extension if not exists pg_trgm;`, "extensions")
run(
  SIM,
  `create schema if not exists auth;
   create table if not exists auth.users (id uuid primary key);
   create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`,
  "stub de auth",
)

// Os uuids reais dos usuários: sem eles a FK user_settings.auth_user_id → auth.users não
// valida e SOME do banco, e o cloudsim deixa de reproduzir a produção justamente na parte
// que o pusher toca (user_work_state é per-user).
const users = q(LOCAL, `select id from auth.users`).split("\n").filter(Boolean)
for (const id of users) run(SIM, `insert into auth.users (id) values ('${id}') on conflict do nothing`, "auth.users")
console.log(`  ${users.length} usuário(s) no stub`)

console.log(`→ carregando dado (pre-data + data)`)
runFile(SIM, dataFile, "cloud-data.sql")

console.log(`→ zerando referências órfãs antes das constraints`)
// A nuvem tem 2.100 linhas órfãs sob FKs marcadas como VALIDADAS — estado só alcançável
// apagando linhas com a checagem desligada. O `ADD CONSTRAINT` do post-data falha na
// validação e a constraint some em silêncio. Zeramos a referência pendurada (as FKs são
// ON DELETE SET NULL, então NULL é o valor que um delete normal teria deixado).
for (const [table, col] of [
  ["synopsis_quality_predictions", "ai_api_call_id"],
  ["recommendation_runs", "ai_api_call_id"],
  ["deep_dive_results", "ai_api_call_id"],
]) {
  const n = q(
    SIM,
    `update public.${table} set ${col} = null
     where ${col} is not null and not exists (select 1 from public.ai_api_calls c where c.id = ${table}.${col});
     select 1`,
  )
  void n
}
console.log(`  3 tabelas conferidas`)

console.log(`→ constraints, índices e policies`)
const postErrs = runFile(SIM, postFile, "cloud-post.sql")

console.log(`\n→ conferindo cloudsim contra o banco local`)
const metrics = {
  tabelas: `select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'`,
  fks: `select count(*) from information_schema.table_constraints where table_schema='public' and constraint_type='FOREIGN KEY'`,
  uniques: `select count(*) from information_schema.table_constraints where table_schema='public' and constraint_type='UNIQUE'`,
  indexes: `select count(*) from pg_indexes where schemaname='public'`,
  policies: `select count(*) from pg_policies where schemaname='public'`,
  functions: `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`,
  linhas: `select coalesce(sum(n_live_tup),0)::bigint from pg_stat_user_tables where schemaname='public'`,
}
run(SIM, "analyze", "analyze")
run(LOCAL, "analyze", "analyze")
const problems = []
for (const [label, sql] of Object.entries(metrics)) {
  const here = q(LOCAL, sql)
  const there = q(SIM, sql)
  const ok = label === "linhas" ? Math.abs(Number(here) - Number(there)) / Math.max(1, Number(here)) < 0.01 : here === there
  console.log(`  ${label.padEnd(12)} local ${String(here).padStart(8)}  cloudsim ${String(there).padStart(8)}  ${ok ? "ok" : "✗"}`)
  if (!ok) problems.push(`${label}: local ${here} × cloudsim ${there}`)
}

if (problems.length) {
  console.error(`\n✗ o cloudsim NÃO reproduz o local:`)
  for (const p of problems) console.error(`   • ${p}`)
  if (postErrs.length) console.error(`   (${postErrs.length} erro(s) no post-data — ver acima)`)
  process.exit(1)
}

console.log(`\n✓ cloudsim pronto e fiel.`)
console.log(`\nEnsaie o push COM COMMIT (e a conferência, que o --dry-run nunca executa):`)
console.log(`  node scripts/db-push-curation.mjs --target='${SIM}'`)

#!/usr/bin/env node
/**
 * Monta um RETRATO DESCARTÁVEL da nuvem no Postgres LOCAL a partir de um backup do
 * `scripts/backup-db.mjs` (schema.sql.gz + NDJSON gzipado por tabela) — para ensaiar migration de
 * DADO sobre o catálogo real sem tocar a nuvem. US$0, sem rede.
 *
 *   node scripts/retrato-local-de-backup.mjs .backups/2026-10-10T02-32-44-165Z retrato_mixed --aplicar=203
 *
 * ALVO: o Postgres LOCAL do stack (URL fixa em 127.0.0.1:54322). 🔴 DESTRUTIVO só para o banco
 * nomeado: ele é recriado (`drop database … with (force)`). Recusa `postgres` (o banco do app local)
 * e nomes fora de `[a-z0-9_]`.
 *
 * Por que existe: a 203 foi ensaiada num retrato montado à mão com `\copy`; a 204/205 precisam do
 * schema REAL (gatilhos, coluna gerada `is_adult`, aliases). O schema vem do `schema.sql.gz` do
 * próprio backup; o dado, só das tabelas que a migration lê/escreve (`--tabelas=`), carregado com
 * `session_replication_role = replica` (sem gatilho e sem FK, porque o recorte não traz todas as
 * tabelas referenciadas).
 *
 * `--aplicar=203,…` aplica migrations do repo POR CIMA, para chegar ao estado de agora quando o
 * backup é anterior a elas. ⚠️ Confira o retrato contra a nuvem (hash por tabela, só leitura) antes de
 * tratá-lo como "a nuvem": o backup é uma foto, e a nuvem continua mudando.
 */
import fs from "node:fs"
import path from "node:path"
import { spawnSync, execFileSync } from "node:child_process"
import zlib from "node:zlib"

const ROOT = path.resolve(import.meta.dirname, "..")
const HOST = "host=127.0.0.1 port=54322 user=postgres"
const args = process.argv.slice(2)
const positional = args.filter((a) => !a.startsWith("--"))
const [backupArg, db] = positional
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1]
const TABELAS_PADRAO = [
  "works", "tags", "tag_group", "tag_alias", "work_tags", "work_synopses", "category_scores",
  "criteria", "publication_status", "personal_status", "source", "genres",
]
const tabelas = (flag("tabelas")?.split(",") ?? TABELAS_PADRAO).filter(Boolean)
const aplicar = (flag("aplicar")?.split(",") ?? []).filter(Boolean)

const die = (msg) => {
  console.error(`\n🔴 ${msg}\n`)
  process.exit(1)
}
if (!backupArg || !db) die("uso: node scripts/retrato-local-de-backup.mjs <dir-do-backup> <banco> [--aplicar=203] [--tabelas=a,b]")
if (!/^[a-z0-9_]+$/.test(db) || db === "postgres" || db.startsWith("template")) die(`nome de banco recusado: ${db}`)
const dir = path.resolve(ROOT, backupArg)
const schemaFile = path.join(dir, "schema.sql.gz")
if (!fs.existsSync(schemaFile)) die(`${dir} não parece um backup do backup-db.mjs (falta schema.sql.gz)`)
for (const t of tabelas) {
  if (!/^[a-z0-9_]+$/.test(t)) die(`tabela inválida: ${t}`)
  if (!fs.existsSync(path.join(dir, `${t}.ndjson.gz`))) die(`o backup não tem ${t}.ndjson.gz`)
}
const migrations = aplicar.map((n) => {
  const f = fs.readdirSync(path.join(ROOT, "supabase/migrations")).find((x) => x.startsWith(`${n}_`))
  if (!f) die(`migration ${n} não encontrada`)
  return path.join(ROOT, "supabase/migrations", f)
})

const env = { ...process.env, PGPASSWORD: "postgres" }
const psql = (database, input, extra = []) => {
  const r = spawnSync("psql", [`${HOST} dbname=${database}`, "-X", "-q", ...extra], { input, encoding: "utf8", env, maxBuffer: 256 * 1024 * 1024 })
  return r
}
const ok = (r, label) => {
  if (r.status !== 0) die(`${label} falhou:\n${(r.stderr ?? "").split("\n").filter((l) => /ERROR/.test(l)).join("\n")}`)
  return r
}

console.log(`▶ retrato ${db} ← ${path.relative(ROOT, dir)}`)
ok(psql("postgres", `drop database if exists ${db} with (force);\ncreate database ${db};\n`, ["-v", "ON_ERROR_STOP=1"]), "recriar o banco")

// Extensions + stub de auth (o mesmo do db:cloudsim): o dump do `public` não traz CREATE EXTENSION, e
// as policies chamam auth.uid().
ok(psql(db, `
create extension if not exists vector with schema public;
create extension if not exists pg_trgm with schema public;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select null::text $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select null::jsonb $$;
`, ["-v", "ON_ERROR_STOP=1"]), "extensions + auth")

// O dump traz o próprio CREATE SCHEMA public, que colide com o banco novo — sai só essa linha.
const schema = zlib.gunzipSync(fs.readFileSync(schemaFile)).toString("utf8")
  .split("\n").filter((l) => l.trim() !== 'CREATE SCHEMA "public";' && l.trim() !== "CREATE SCHEMA public;").join("\n")
const rs = psql(db, schema, ["-v", "ON_ERROR_STOP=0"])
const errosSchema = (rs.stderr ?? "").split("\n").filter((l) => l.includes("ERROR"))
console.log(`  schema: ${errosSchema.length} erro(s)`)
if (errosSchema.length) die(`o schema não restaurou limpo:\n${errosSchema.slice(0, 10).join("\n")}`)

// Dado: NDJSON → staging jsonb → jsonb_populate_record, sem colunas geradas.
ok(psql(db, "create table public._stg (t text, j jsonb);", ["-v", "ON_ERROR_STOP=1"]), "staging")
for (const t of tabelas) {
  const linhas = zlib.gunzipSync(fs.readFileSync(path.join(dir, `${t}.ndjson.gz`))).toString("utf8").split("\n").filter(Boolean)
  const csv = linhas.map((l) => `${t}\x02${l.replace(/\x01/g, "")}`).join("\n") + "\n"
  ok(psql(db, csv, ["-v", "ON_ERROR_STOP=1", "-c", "\\copy public._stg (t, j) from stdin with (format csv, delimiter e'\\x02', quote e'\\x01')"]), `carga ${t}`)
}
const carga = ok(psql(db, `
set session_replication_role = replica;
do $$
declare r record; cols text; n bigint;
begin
  for r in select distinct t from public._stg order by t loop
    select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
      from information_schema.columns
     where table_schema = 'public' and table_name = r.t and is_generated = 'NEVER';
    execute format('insert into public.%I (%s) select %s from public._stg s, jsonb_populate_record(null::public.%I, s.j) x where s.t = %L',
                   r.t, cols, (select string_agg('x.' || c, ', ') from unnest(string_to_array(cols, ', ')) c), r.t, r.t);
    get diagnostics n = row_count;
    raise notice '% → % linhas', r.t, n;
  end loop;
end $$;
drop table public._stg;
`, ["-v", "ON_ERROR_STOP=1"]), "inserção")
for (const l of (carga.stderr ?? "").split("\n").filter((x) => x.includes("→"))) console.log(`  ${l.replace(/.*NOTICE:\s+/, "")}`)

for (const m of migrations) {
  const r = ok(psql(db, `\\set ON_ERROR_STOP 1\nbegin;\n\\i ${m}\ncommit;\n`), `migration ${path.basename(m)}`)
  const resumo = (r.stderr ?? "").split("\n").filter((l) => /NOTICE:\s+mig \d+:/.test(l)).map((l) => l.replace(/.*NOTICE:\s+/, ""))
  console.log(`  aplicada ${path.basename(m)}${resumo.length ? ` · ${resumo.join(" · ")}` : ""}`)
}

const n = execFileSync("psql", [`${HOST} dbname=${db}`, "-XAtc", "select count(*) from public.works"], { encoding: "utf8", env }).trim()
console.log(`\n✓ retrato ${db}: ${n} obras · ${tabelas.length} tabelas · ${migrations.length} migration(s) por cima`)

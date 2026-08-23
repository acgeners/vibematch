#!/usr/bin/env node
/**
 * Restaura o banco LOCAL a partir de um backup de `db:local:backup`.
 *
 *   npm run db:local:restore -- .backups/local-primary-<stamp>
 *   node --env-file=.env.local --env-file=.env.analysis scripts/db-local-restore.mjs
 *   npm run db:local:restore -- <dir> --sim-eu-quero-restaurar
 *
 * ALVO: LOCAL. 🔴 DESTRUTIVO: dropa o schema `public` e o recria a partir do dump.
 *
 * Por isso exige intenção explícita: sob LOCAL PRIMARY, restaurar um backup ANTIGO por cima do
 * banco vivo descarta tudo que foi feito desde ele — é a mesma classe de estrago que a guarda
 * do `db:pull` existe para impedir, só que pela porta de dentro.
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { ehLocal } from "./lib/local-primary.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
const args = process.argv.slice(2)
const dir = path.resolve(ROOT, args.find((a) => !a.startsWith("--")) ?? "")

if (!ehLocal(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
  console.error(`\n🔴 RECUSADO — alvo não é local.\n`); process.exit(1)
}
if (!fs.existsSync(path.join(dir, "public.sql"))) {
  console.error(`\n🔴 ${dir} não parece um backup (falta public.sql).\n`); process.exit(1)
}
const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"))

if (!args.includes("--sim-eu-quero-restaurar")) {
  console.error(`\n🔴 RESTORE é DESTRUTIVO — dropa o schema \`public\` do banco LOCAL.`)
  console.error(`\n   backup:  ${path.relative(ROOT, dir)}`)
  console.error(`   criado:  ${manifest.criadoEm}`)
  console.error(`\n   Tudo que foi feito no local DEPOIS dessa data será descartado.`)
  console.error(`\n   Se é isso mesmo:`)
  console.error(`     npm run db:local:restore -- ${path.relative(ROOT, dir)} --sim-eu-quero-restaurar\n`)
  process.exit(1)
}

const psql = (a) => execFileSync("psql", [DB, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...a], { encoding: "utf8" })
console.log(`\n▶ restore de ${path.relative(ROOT, dir)}`)
// 🔴 DROP sem CREATE: o próprio dump traz `CREATE SCHEMA public`. Criar antes fazia o
// restore abortar em `ERROR: schema "public" already exists` — falha limpa (ON_ERROR_STOP=1
// para no primeiro erro), mas falha. Medido na primeira execução do ciclo de prova.
// 🔴 A ORDEM AQUI CUSTOU DUAS TENTATIVAS, e as duas falhas estão documentadas porque
// nenhuma delas é adivinhável lendo o dump:
//
//  1. `create schema public` ANTES do dump ⇒ o dump aborta em "schema public already exists"
//     (ele traz o próprio CREATE SCHEMA).
//  2. dropar `public` CASCADE leva junto as EXTENSIONS `vector` e `pg_trgm`, que moram lá
//     dentro — e `pg_dump --schema=public` NÃO emite `CREATE EXTENSION`. Sem recriá-las, o
//     load morre em `type "public.vector" does not exist` na primeira tabela de embeddings.
//
// As duas exigências se contradizem, e a saída é criar o schema + extensions e REMOVER do
// dump a única linha que colide. Filtrar é determinístico: casa a linha inteira, não um trecho.
psql(["-c", `drop schema if exists public cascade;
              create schema public;
              create extension if not exists vector with schema public;
              create extension if not exists pg_trgm with schema public;`])
console.log("  ✓ schema recriado + extensions vector/pg_trgm (o dump não as traz)")

const bruto = fs.readFileSync(path.join(dir, "public.sql"), "utf8")
const semCreateSchema = bruto.split("\n").filter((l) => l.trim() !== "CREATE SCHEMA public;").join("\n")
const tmp = path.join(dir, ".restore-tmp.sql")
fs.writeFileSync(tmp, semCreateSchema)
try {
  psql(["-f", tmp])
} finally {
  fs.unlinkSync(tmp)
}
console.log("  ✓ dump carregado")

// auth: recria os usuários com os MESMOS UUIDs. A senha vem do bootstrap (é local).
const users = JSON.parse(fs.readFileSync(path.join(dir, "auth-users.json"), "utf8"))
console.log(`  ✓ ${users.length} usuários no manifesto — rode \`npm run db:local:auth\` para semear a senha`)
console.log(`\n  conferência:  npm run db:local:verify -- ${path.relative(ROOT, dir)}\n`)

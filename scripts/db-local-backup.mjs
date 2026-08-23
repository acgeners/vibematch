#!/usr/bin/env node
/**
 * Backup do banco LOCAL enquanto ele é a fonte da verdade temporária (LOCAL PRIMARY).
 *
 *   npm run db:local:backup
 *   node --env-file=.env.local --env-file=.env.analysis scripts/db-local-backup.mjs
 *
 * ALVO: LOCAL. Guarda dura em `exigirAlvoLocal` — este script não fala com a nuvem.
 *
 * 🔴 Por que não reusar `backup-db.mjs`: aquele grava NDJSON **só de dado**, pelo PostgREST, e
 * NÃO tem restore. Enquanto o local era descartável isso bastava (a nuvem era a verdade e o
 * `db:pull` reconstruía tudo). Com LOCAL PRIMARY o original não existe em outro lugar, então o
 * backup precisa de duas coisas que aquele não dá: **schema junto do dado** e um **caminho de
 * volta provado**. `pg_dump` dá as duas, e é o mesmo mecanismo que o `db:pull` já usa.
 *
 * O que entra:
 *   - schema `public` COMPLETO (schema + dado + policies + functions + triggers)
 *   - os UUIDs de `auth.users` — só `id` e `email`, o mínimo para o `db:local:auth` recriar
 *     as contas. Senha NÃO é preservada de propósito: ela é local e descartável, e o bootstrap
 *     a regrava.
 *
 * ⚠️ Storage local NÃO entra: hoje o bucket local está vazio (os 19 ícones de critério vivem
 * na nuvem e estão inacessíveis por 402). No dia em que houver objeto local relevante, isto
 * precisa crescer — e o aviso é impresso ao fim de toda execução para não virar omissão calada.
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { exigirAlvoLocal, ehLocal, registrarBackup } from "./lib/local-primary.mjs"
import { podar } from "./lib/backups-retencao.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")
const DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

if (!ehLocal(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
  console.error(`\n🔴 RECUSADO — alvo ${process.env.NEXT_PUBLIC_SUPABASE_URL || "(vazio)"} não é local.`)
  console.error("   Rode `npm run db:local` antes.\n")
  process.exit(1)
}
exigirAlvoLocal({ contexto: "db-local-backup" })

const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const dir = path.join(ROOT, ".backups", `local-primary-${stamp}`)
fs.mkdirSync(dir, { recursive: true })

console.log(`\n▶ backup do LOCAL → ${path.relative(ROOT, dir)}`)

// 1. schema public completo
execFileSync("pg_dump", [DB, "--schema=public", "--no-owner", "--no-privileges", "-f", path.join(dir, "public.sql")], { stdio: "inherit" })
// 2. os UUIDs do auth (o bootstrap recria o resto)
const users = execFileSync("psql", [DB, "-X", "-A", "-t", "-q", "-c",
  "select coalesce(json_agg(json_build_object('id',id,'email',email)),'[]') from auth.users"], { encoding: "utf8" }).trim()
fs.writeFileSync(path.join(dir, "auth-users.json"), users + "\n")

// 3. as contagens que o restore vai ter que reproduzir
const counts = execFileSync("psql", [DB, "-X", "-A", "-t", "-q", "-c",
  `select coalesce(json_object_agg(relname, n_live_tup),'{}') from pg_stat_user_tables where schemaname='public'`],
  { encoding: "utf8" }).trim()
fs.writeFileSync(path.join(dir, "counts.json"), counts + "\n")

const bytes = fs.statSync(path.join(dir, "public.sql")).size
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
  criadoEm: new Date().toISOString(), origem: "local", schemas: ["public", "auth.users(id,email)"],
  bytesPublicSql: bytes, storageIncluido: false,
}, null, 2) + "\n")

console.log(`  ✓ public.sql        ${(bytes / 1048576).toFixed(1)} MB`)
console.log(`  ✓ auth-users.json   ${JSON.parse(users).length} usuários (id + email)`)
console.log(`  ✓ counts.json       ${Object.keys(JSON.parse(counts)).length} tabelas`)
console.log("  ⚠️ Storage NÃO incluído (bucket local vazio hoje). Reveja quando houver objeto local.")

podar("local-primary")
registrarBackup(path.relative(ROOT, dir))
console.log(`\n  restore:  npm run db:local:restore -- ${path.relative(ROOT, dir)}\n`)

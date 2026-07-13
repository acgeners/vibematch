#!/usr/bin/env node
/**
 * Aplica um arquivo de migration no Supabase via **Management API**
 * (`POST /v1/projects/{ref}/database/query`), sem SQL editor.
 *
 *   node scripts/apply-migration.mjs supabase/migrations/144_snapshot_pre_fatia2c.sql
 *   node scripts/apply-migration.mjs <arquivo> --dry-run    → só imprime o SQL
 *
 * Precisa de `SUPABASE_ACCESS_TOKEN` no .env.local (token pessoal da conta Supabase).
 *
 * ⚠️ Isto roda SQL ARBITRÁRIO com privilégio total — inclusive `drop`. Antes de usar:
 *   - Rode `node scripts/backup-db.mjs` se a migration mexe em dado.
 *   - `create/drop policy` e `alter table` pegam AccessExclusiveLock e podem DAR DEADLOCK
 *     com o app rodando (aconteceu na mig 142). Pare o dev server antes.
 *
 * A API roda o script inteiro numa transação. Se qualquer statement falhar, nada é aplicado.
 */
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
if (!TOKEN || !URL_) {
  console.error("faltam SUPABASE_ACCESS_TOKEN / NEXT_PUBLIC_SUPABASE_URL no .env.local")
  process.exit(1)
}
const REF = URL_.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (!REF) {
  console.error(`não consegui extrair o ref do projeto de ${URL_}`)
  process.exit(1)
}

const file = process.argv[2]
const dry = process.argv.includes("--dry-run")
if (!file) {
  console.error("uso: node scripts/apply-migration.mjs <arquivo.sql> [--dry-run]")
  process.exit(1)
}

const sql = fs.readFileSync(path.resolve(ROOT, file), "utf8")

/** Roda SQL e devolve as linhas. Exportado pra outros scripts (ex.: verificação pós-migration). */
export async function runSql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

console.log(`projeto: ${REF}`)
console.log(`arquivo: ${file} (${sql.split("\n").length} linhas)`)

if (dry) {
  console.log("\n[dry-run] SQL que seria enviado:\n")
  console.log(sql)
  process.exit(0)
}

const out = await runSql(sql)
console.log("\n✅ aplicada.")
if (Array.isArray(out) && out.length > 0) console.log(JSON.stringify(out, null, 1).slice(0, 500))

#!/usr/bin/env node
/**
 * Backup lógico do Supabase — a rede que o projeto NÃO tem.
 *
 * Conferido em 2026-07-13 via Management API: `pitr_enabled: false` e **zero backups
 * disponíveis**. Não existe de onde restaurar. E parte do dado é caro de refazer:
 * ~2.100 avaliações de IA (≈US$60 em tokens) e ~14 mil reviews raspadas de 8 fontes.
 *
 * Roda ANTES de qualquer mudança grande (a partição da Fase 2, um backfill em massa).
 *
 *   node scripts/backup-db.mjs            → .backups/<timestamp>/
 *   node scripts/backup-db.mjs /caminho   → /caminho/<timestamp>/
 *
 * ⚠️ O `select` do Supabase corta em 1000 linhas SEM AVISAR — um backup truncado é a pior
 * forma possível desse bug: ele "funciona", você confia, e o dado só some quando você
 * precisa dele. Por isso aqui tudo é paginado E conferido contra `count: "exact"`: se um
 * único registro faltar, o script FALHA em vez de gravar um backup mentiroso.
 */
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const { createClient } = require("@supabase/supabase-js")

const ROOT = path.resolve(import.meta.dirname, "..")
for (const line of fs.readFileSync(path.join(ROOT, ".env.local"), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) {
  console.error("faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local")
  process.exit(1)
}
const sb = createClient(URL_, KEY, { auth: { persistSession: false } })

// Views: não têm o que restaurar (derivam de tabelas). Pular evita backup redundante.
const VIEWS = new Set(["latest_ai_evaluation_per_work"])

const PAGE = 1000

async function listTables() {
  const r = await fetch(`${URL_}/rest/v1/`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  })
  const spec = await r.json()
  const defs = spec.definitions ?? spec.components?.schemas ?? {}
  return Object.keys(defs).filter((t) => !VIEWS.has(t)).sort()
}

async function dumpTable(table, outDir) {
  const { count, error: cErr } = await sb.from(table).select("*", { count: "exact", head: true })
  if (cErr) throw new Error(`${table}: contagem falhou — ${cErr.message}`)

  const file = path.join(outDir, `${table}.ndjson.gz`)
  const gzip = zlib.createGzip()
  const out = fs.createWriteStream(file)
  gzip.pipe(out)

  let written = 0
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select("*").range(from, from + PAGE - 1)
    if (error) throw new Error(`${table}: página ${from} falhou — ${error.message}`)
    if (!data?.length) break
    for (const row of data) gzip.write(JSON.stringify(row) + "\n")
    written += data.length
    if (data.length < PAGE) break
  }

  await new Promise((res, rej) => {
    gzip.end()
    out.on("finish", res)
    out.on("error", rej)
  })

  // A conferência que torna o backup confiável. Sem ela, truncar não daria erro.
  if (written !== (count ?? 0)) {
    throw new Error(`${table}: BACKUP INCOMPLETO — ${written} linhas gravadas, ${count} no banco`)
  }
  return { table, rows: written, bytes: fs.statSync(file).size }
}

const base = process.argv[2] ?? path.join(ROOT, ".backups")
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
const outDir = path.join(base, stamp)
fs.mkdirSync(outDir, { recursive: true })

const tables = await listTables()
console.log(`backup de ${tables.length} tabelas → ${outDir}\n`)

const manifest = []
let totalRows = 0
let totalBytes = 0
for (const t of tables) {
  const r = await dumpTable(t, outDir)
  manifest.push(r)
  totalRows += r.rows
  totalBytes += r.bytes
  if (r.rows > 0) {
    console.log(`  ${t.padEnd(34)} ${String(r.rows).padStart(7)} linhas  ${(r.bytes / 1024).toFixed(0).padStart(6)} KB`)
  }
}

fs.writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify(
    { takenAt: new Date().toISOString(), project: URL_, tables: manifest, totalRows },
    null,
    2,
  ),
)

console.log(`\n✅ ${totalRows} linhas em ${tables.length} tabelas · ${(totalBytes / 1024 / 1024).toFixed(1)} MB`)
console.log(`   manifest: ${path.join(outDir, "manifest.json")}`)
console.log(`\n   Cada tabela é um NDJSON gzipado (1 linha = 1 registro JSON). Pra restaurar:`)
console.log(`   zcat <tabela>.ndjson.gz | ... → upsert via service role (a ordem importa: FKs).`)

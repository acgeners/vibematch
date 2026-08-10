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
import { podar } from "./lib/backups-retencao.mjs"

const require = createRequire(import.meta.url)
const { createClient } = require("@supabase/supabase-js")

const ROOT = path.resolve(import.meta.dirname, "..")
// Qual .env ler. O `.env.local` alterna entre nuvem e LOCAL (`npm run db:local`), então
// quando o alvo é o stack local este script faria um backup do BANCO ERRADO — e passaria
// na conferência de linhas, porque o local também é consistente consigo mesmo. Daí a
// guarda abaixo e a possibilidade de mirar direto na cópia da nuvem:
//   BACKUP_ENV_FILE=.env.supabase-cloud node scripts/backup-db.mjs
const ENV_FILE = process.env.BACKUP_ENV_FILE ?? ".env.local"
for (const line of fs.readFileSync(path.join(ROOT, ENV_FILE), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_ || !KEY) {
  console.error(`faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no ${ENV_FILE}`)
  process.exit(1)
}
if (/127\.0\.0\.1|localhost/.test(URL_)) {
  console.error(`✗ ${ENV_FILE} aponta pro Supabase LOCAL (${URL_}) — isto seria um backup do banco errado.`)
  console.error(`  Pra salvar a NUVEM:  BACKUP_ENV_FILE=.env.supabase-cloud node scripts/backup-db.mjs`)
  console.error(`  Se você QUER mesmo o local, rode com BACKUP_ALLOW_LOCAL=1.`)
  if (process.env.BACKUP_ALLOW_LOCAL !== "1") process.exit(1)
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

// ── schema ──────────────────────────────────────────────────────────────────────────────
/**
 * 🔴 O NDJSON acima é SÓ DADO. Sem esta seção, restaurar exigia um banco que já tivesse as
 * tabelas, as 67 policies, os 13 triggers/functions do projeto e as 2 views — e o único lugar
 * onde isso existia era o `pg_dump` do `db:pull`, rodado à mão. Medido em 2026-08-10: o backup
 * de DADO tinha 1 dia (o agente semanal do launchd) e o de SCHEMA tinha **11**. E com o local
 * deixando de ser fonte de verdade, o `db:pull` para de ser rodado por hábito — a metade de
 * schema envelheceria ainda mais, justamente quando vira a única rede.
 *
 * Custa 259 KB (37 KB gzipado) e ~3 s: 0,24% do dump completo de 108 MB. Roda toda vez.
 *
 * ⚠️ `--schema public` NÃO leva `CREATE EXTENSION`, e `vector`/`pg_trgm` moram dentro do
 * public — restaurar exige criá-las antes, como o `db-pull-to-local.mjs` já faz no passo 4.
 *
 * ⚠️ As 162 funções que o `pg_proc` acusa no public NÃO são do projeto: 149 vêm dessas duas
 * extensions, e o pg_dump as omite de propósito (voltam com a extension). As 13 restantes são
 * as nossas, e são as que aparecem aqui.
 *
 * Fail-SOFT de propósito: sem `pg_dump` no PATH ou sem `SUPABASE_DB_PASSWORD`, o backup de
 * dado já está gravado e conferido — abortar agora jogaria fora o que deu certo.
 */
{
  const senha = process.env.SUPABASE_DB_PASSWORD
  const ref = (URL_ ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
  if (!senha || !ref) {
    console.log(`\n⚠️  schema NÃO salvo: falta ${!ref ? "um alvo de nuvem" : "SUPABASE_DB_PASSWORD"}.`)
    console.log(`   O backup é só de DADO — restaurar vai exigir um banco com o schema já criado.`)
  } else {
    const arquivo = path.join(outDir, "schema.sql")
    try {
      const conn = `postgresql://postgres:${encodeURIComponent(senha)}@db.${ref}.supabase.co:5432/postgres?sslmode=require`
      const { execFileSync } = require("node:child_process")
      execFileSync(
        "pg_dump",
        [conn, "--no-owner", "--quote-all-identifiers", "--schema-only",
         "--schema", "public", "--schema", "bkp", "-f", arquivo],
        { stdio: ["ignore", "ignore", "pipe"] },
      )
      const sql = fs.readFileSync(arquivo)
      fs.writeFileSync(`${arquivo}.gz`, zlib.gzipSync(sql, { level: 9 }))
      fs.rmSync(arquivo)
      const conta = (re) => (sql.toString().match(re) ?? []).length
      console.log(`\n✅ schema: ${(fs.statSync(`${arquivo}.gz`).size / 1024).toFixed(0)} KB gzipado` +
        ` · ${conta(/CREATE POLICY/g)} policies · ${conta(/CREATE FUNCTION/g)} functions` +
        ` · ${conta(/CREATE TRIGGER/g)} triggers`)
    } catch (e) {
      console.log(`\n⚠️  schema NÃO salvo: ${String(e.stderr ?? e.message).trim().split("\n")[0].slice(0, 120)}`)
      console.log(`   O backup de dado acima está íntegro. Rode \`npm run db:pull\` para um dump com schema.`)
    }
  }
}

// Retenção: mantém os BACKUP_KEEP mais recentes (default 5). A política mora em
// `lib/backups-retencao.mjs`, que é o dono ÚNICO — cada script ter a sua foi o que deixou 3
// famílias sem poda nenhuma e o `.backups` chegar a 1,9 GB.
//
// 🔴 Aqui, e SÓ aqui, a poda é no FIM de propósito: o script dá throw acima se qualquer tabela
// truncar, então chegar até esta linha é a prova de que o backup novo presta. Podar antes
// descartaria um backup bom por causa de um novo que falhou. Nos scripts de STAGING é o
// contrário — lá se poda no começo, porque ensaio interrompido também deixa lixo.
podar("backup", { base })

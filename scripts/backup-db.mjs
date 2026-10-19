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
 * Saída, e o que cada nome quer dizer (régua: `lib/backup-integridade.mjs`):
 *   <timestamp>/             COMPLETO — tabelas + schema conferidos no disco      (exit 0)
 *   <timestamp>.sem-schema/  só dado: conferido, mas não restaura sozinho         (exit 2)
 *   <timestamp>.incompleto/  em andamento, ou interrompido (motivo em FALHA.json) (exit 1)
 *
 * 🔴 ALVO: NUVEM — e aqui a palavra tem sentido inverso ao dos outros scripts. Ele não GRAVA
 * no banco; o que ele grava é o BACKUP, e um backup do banco errado é pior que backup nenhum,
 * porque reporta sucesso. O alvo sai de `BACKUP_ENV_FILE` (default `.env.local`), não de
 * `--env-file`, então o `.env.analysis` não o alcança — mandá-lo pro clone descartável
 * salvaria a réplica no lugar da produção, com a mesma mensagem de "ok" no fim.
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
import { listarFamilia, podar } from "./lib/backups-retencao.mjs"
import { ordemDePaginacao, paginasOrdenadas } from "./lib/backup-ordem.mjs"
import { FALHA, SCHEMA, SUFIXO_INCOMPLETO } from "./lib/backup-integridade.mjs"
import { escreverNdjsonGz, gravarBackup } from "./lib/backup-gravacao.mjs"

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
  // ⚠️ Rede/DNS caindo aqui é o caso COMUM (projeto pausado perde o DNS), não a exceção.
  // Sem este catch o script morre com stack trace do `getaddrinfo`, que não diz o que fazer.
  let r
  try {
    r = await fetch(`${URL_}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } })
  } catch (e) {
    console.error(`\n🔴 BACKUP FALHOU — não consegui alcançar ${URL_}`)
    console.error(`   ${e.cause?.code ?? e.message}${e.cause?.code === "ENOTFOUND" ? "  (DNS sumiu: projeto PAUSADO no free tier?)" : ""}`)
    console.error(`   Nada foi gravado.\n`)
    process.exit(1)
  }
  const spec = await r.json().catch(() => ({}))
  const defs = spec.definitions ?? spec.components?.schemas ?? {}
  // As definições voltam junto: a chave primária de cada tabela, que ordena a paginação, sai daqui.
  return { tables: Object.keys(defs).filter((t) => !VIEWS.has(t)).sort(), defs }
}

async function dumpTable(table, definicao, outDir) {
  const { count, error: cErr } = await sb.from(table).select("*", { count: "exact", head: true })
  if (cErr) throw new Error(`${table}: contagem falhou — ${cErr.message}`)

  // 🔴 Ordem TOTAL antes do `.range()` — sem ela, páginas repetem e perdem linhas e a contagem
  // abaixo não percebe. A regra e o porquê moram em `lib/backup-ordem.mjs`.
  const ordem = ordemDePaginacao(table, definicao, count, PAGE)

  // Escreve, fecha e confere contra `count` — e, se cair no meio, o arquivo vira `.parcial`.
  const file = path.join(outDir, `${table}.ndjson.gz`)
  const paginas = paginasOrdenadas(() => sb.from(table).select("*"), ordem, PAGE, table)
  const { rows, bytes } = await escreverNdjsonGz(file, paginas, { esperado: count ?? 0, rotulo: table })
  return { table, rows, bytes }
}

const base = process.argv[2] ?? path.join(ROOT, ".backups")
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
// 🔴 O backup é escrito em `<stamp>.incompleto/` e só vira `<stamp>/` por RENOMEAÇÃO, depois de
// conferido no disco. Até 2026-10-19 a pasta nascia com o nome final: a queda de 18/10 deixou um
// diretório com nome de backup bom e 68 de 82 tabelas, e a retenção (que ordenava por nome) o
// contaria entre os 5 mais recentes. `renameSync` na mesma pasta é atômico: não existe instante
// em que `<stamp>/` exista pela metade. Régua dos estados: `lib/backup-integridade.mjs`.
const finalDir = path.join(base, stamp)
const outDir = finalDir + SUFIXO_INCOMPLETO

// 🔴 O mkdir vem DEPOIS da descoberta, de propósito. Criado antes, todo backup falho deixava
// um diretório vazio em `.backups/` — indistinguível, na listagem, de um backup que rodou e
// não achou nada. Foram 3 desses que mascararam a falha entre 23/08 e 06/09.
const { tables, defs } = await listTables()

// 🔴 FAIL-CLOSED. Esta linha existe porque a ausência dela custou 3 semanas de backup vazio:
// `listTables()` lê o OpenAPI do PostgREST; com o projeto pausado/restrito o corpo não traz
// `definitions`, o filtro devolve [], o laço abaixo NÃO EXECUTA e o script imprimia ✅ com
// zero linha. A guarda de integridade por tabela (`written !== count`) vive DENTRO do laço,
// então ela protege contra backup TRUNCADO e nunca teve como pegar um backup VAZIO.
if (tables.length === 0) {
  console.error(`\n🔴 BACKUP FALHOU — nenhuma tabela descoberta em ${URL_}.`)
  console.error(`   Isto NÃO é "o banco está vazio": é o PostgREST não ter devolvido o schema.`)
  console.error(`   Causas conhecidas: projeto PAUSADO (free tier), restrito por quota (402),`)
  console.error(`   URL/chave erradas, ou o alvo não ser um Supabase.\n`)
  process.exit(1)
}
fs.mkdirSync(outDir, { recursive: true })
console.log(`backup de ${tables.length} tabelas → ${outDir}`)
console.log(`   (vira ${stamp}/ só depois de conferido)\n`)

// ── schema ──────────────────────────────────────────────────────────────────────────────
/**
 * 🔴 O NDJSON é SÓ DADO. Sem o schema, restaurar exige um banco que já tenha as tabelas, as
 * policies, os triggers/functions do projeto e as views. Custa ~45 KB gzipado e ~3 s.
 *
 * ⚠️ `--schema public` NÃO leva `CREATE EXTENSION`, e `vector`/`pg_trgm` moram dentro do
 * public — restaurar exige criá-las antes, como o `db-pull-to-local.mjs` já faz no passo 4.
 *
 * ⚠️ As ~160 funções que o `pg_proc` acusa no public NÃO são do projeto: vêm dessas duas
 * extensions, e o pg_dump as omite de propósito (voltam com a extension).
 *
 * Sem schema o backup NÃO é descartado (os dados conferidos valem), mas também não é COMPLETO:
 * a pasta termina como `<stamp>.sem-schema/` e o script sai com código 2. Até 2026-10-19 isto
 * era um aviso e o backup seguia como bem-sucedido — foi assim que os automáticos passaram 8 dias
 * de agosto salvando só dado sem nada acusar.
 */
function salvarSchema(dir) {
  const senha = process.env.SUPABASE_DB_PASSWORD
  const ref = (URL_ ?? "").match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
  if (!senha || !ref) {
    return { status: "ausente", motivo: `falta ${!ref ? "um alvo de nuvem" : "SUPABASE_DB_PASSWORD"} no ${ENV_FILE}` }
  }
  const arquivo = path.join(dir, "schema.sql")
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
    fs.writeFileSync(path.join(dir, SCHEMA), zlib.gzipSync(sql, { level: 9 }))
    fs.rmSync(arquivo)
    const conta = (re) => (sql.toString().match(re) ?? []).length
    return {
      status: "ok",
      bytes: fs.statSync(path.join(dir, SCHEMA)).size,
      policies: conta(/CREATE POLICY/g),
      functions: conta(/CREATE FUNCTION/g),
      triggers: conta(/CREATE TRIGGER/g),
    }
  } catch (e) {
    // Saída pela metade deste mesmo pg_dump não é schema — não pode ficar parecendo um.
    fs.rmSync(arquivo, { force: true })
    fs.rmSync(path.join(dir, SCHEMA), { force: true })
    return { status: "ausente", motivo: String(e.stderr ?? e.message).trim().split("\n")[0].slice(0, 160) }
  }
}

const r = await gravarBackup({
  dir: outDir,
  destinoFinal: finalDir,
  tabelas: tables,
  despejar: (t, dir) => dumpTable(t, defs[t], dir),
  salvarSchema,
  project: URL_,
  log: (linha) => console.log(linha),
})

if (r.estado === "vazio") {
  // 🔴 FAIL-CLOSED nº 2: um catálogo real nunca fica vazio. A pasta desta execução não tinha dado
  // nenhum e foi removida.
  console.error(`\n🔴 BACKUP FALHOU — ${r.tabelas} tabelas descobertas e ZERO linhas lidas.`)
  console.error(`   Um catálogo real nunca fica vazio; isto é falha de acesso, não estado.\n`)
  process.exit(1)
}

if (r.estado === "falhou") {
  console.error(`\n🔴 BACKUP FALHOU na etapa ${r.etapa}${r.tabela ? ` (tabela ${r.tabela})` : ""}: ${r.erro}`)
  console.error(`   A pasta ficou como ${path.basename(r.dir)}/ (motivo em ${FALHA}). Ela NÃO é um backup`)
  console.error(`   restaurável e não conta na retenção. Nenhum backup anterior foi apagado.`)
  console.error(`   Rode de novo. Depois de um backup completo, a pasta .incompleto pode ser apagada à mão.\n`)
  process.exit(1)
}

const { schema, dir: destino, totalRows, totalBytes } = r
console.log(`\n   dados: ${totalRows} linhas em ${r.tabelas} tabelas · ${(totalBytes / 1024 / 1024).toFixed(1)} MB, conferidos no disco`)

if (schema.status !== "ok") {
  console.log(`\n⚠️  BACKUP SÓ DE DADOS — schema NÃO salvo: ${schema.motivo}`)
  console.log(`   ${destino}`)
  console.log(`   Os dados estão conferidos e preservados, mas isto NÃO restaura um banco sozinho`)
  console.log(`   (faltam tabelas, policies, triggers) e não conta como backup na retenção.`)
  console.log(`   Corrija o motivo e rode de novo; schema avulso: \`npm run db:pull\`.\n`)
  process.exit(2)
}

console.log(`\n✅ BACKUP COMPLETO — ${totalRows} linhas em ${r.tabelas} tabelas + schema, conferidos no disco`)
console.log(`   ${destino}`)
console.log(`   schema: ${(schema.bytes / 1024).toFixed(0)} KB gzipado · ${schema.policies} policies` +
  ` · ${schema.functions} functions · ${schema.triggers} triggers`)
console.log(`\n   Pra restaurar: criar as extensions vector e pg_trgm, aplicar schema.sql.gz e depois`)
console.log(`   zcat <tabela>.ndjson.gz | ... → upsert via service role (a ordem importa: FKs).\n`)

// Retenção: a política mora em `lib/backups-retencao.mjs`, dono ÚNICO. Ela só conta (e só pode
// apagar) backups que a régua de `lib/backup-integridade.mjs` classifica como COMPLETOS, e por
// padrão só SIMULA: apagar exige BACKUP_PODAR=1 (ver o porquê na família "backup").
//
// 🔴 Aqui, e SÓ aqui, a poda é no FIM de propósito: chegar até esta linha é a prova de que o
// backup novo está completo. Podar antes descartaria um backup bom por causa de um novo que
// falhou. Nos scripts de STAGING é o contrário — lá se poda no começo.
podar("backup", { base })

const parciais = listarFamilia("backup-parcial", base)
if (parciais.length) {
  console.log(`ℹ️  ${parciais.length} pasta(s) .incompleto/.sem-schema preservada(s) em ${base} — não contam` +
    ` como backup; apague à mão depois de diagnosticar:`)
  for (const p of parciais) console.log(`     ${p}`)
}

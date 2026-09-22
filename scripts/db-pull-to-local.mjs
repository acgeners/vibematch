#!/usr/bin/env node
/**
 * Copia o banco da NUVEM para o stack Supabase LOCAL (`supabase start`).
 *
 *   node scripts/db-pull-to-local.mjs      (npm run db:pull)
 *
 * Precisa de `SUPABASE_DB_PASSWORD` no `.env.local` (senha do Postgres, em
 * Dashboard → Project Settings → Database). O gateway REST da nuvem pode estar restrito
 * (402 `exceed_egress_quota`) — não importa: isto fala **Postgres direto**, que continua
 * respondendo mesmo com o projeto restrito.
 *
 * Por que pg_dump e não o backup NDJSON de `scripts/backup-db.mjs`: aquele é **só dado**.
 * O schema `public` da nuvem tem 162 functions, 47 policies, 11 triggers e 2 views que o
 * NDJSON não carrega — sem eles o app não roda (a RLS da migration 142 nem existiria).
 * Replayar as 173 migrations também não serve: foram aplicadas via Management API, têm
 * colisões de número e nunca rodaram do zero.
 *
 * ⚠️ Este script DESTRÓI os schemas `public` e `bkp` do banco LOCAL. Nunca escreve na nuvem
 * (todo acesso remoto é leitura: pg_dump + selects).
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
import { exigirIntencaoParaDestruir } from "./lib/local-primary.mjs"
import { podar } from "./lib/backups-retencao.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")

// 🔴 ANTES DE TUDO. Este script destrói os schemas `public` e `bkp` do local, e até
// 2026-08 isso era inofensivo — o local era réplica descartável. Com LOCAL PRIMARY ativo
// ele é a FONTE DA VERDADE, e este seria o comando que apaga a curadoria.
exigirIntencaoParaDestruir({
  comando: "npm run db:pull",
  oQueDestroi: "DESTRÓI os schemas `public` e `bkp` do banco LOCAL e os recria a partir da nuvem",
})
const SCHEMAS = ["public", "bkp"]

const parseEnv = (file) => {
  const out = {}
  if (!fs.existsSync(file)) return out
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
  return out
}

const die = (msg) => {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

const env = parseEnv(path.join(ROOT, ".env.local"))
const snapshot = parseEnv(path.join(ROOT, ".env.supabase-cloud"))

const password = env.SUPABASE_DB_PASSWORD
if (!password) {
  die(
    "falta SUPABASE_DB_PASSWORD no .env.local.\n" +
      "  Pegue em Dashboard → Project Settings → Database → Database password\n" +
      "  (ou 'Reset database password' — nada do app usa conexão Postgres direta, então não quebra nada)."
  )
}

// O .env.local pode já estar apontado pro local; nesse caso o ref da nuvem vem do arquivo arquivado.
const cloudApiUrl = snapshot.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ""
const ref = cloudApiUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
if (!ref) die(`não consegui extrair o project ref de "${cloudApiUrl}"`)

const CLOUD = `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres?sslmode=require`
const LOCAL = (() => {
  try {
    // stderr ignorado: o `status` avisa "Stopped services: [imgproxy pooler]", nenhum dos dois usado aqui.
    const raw = execFileSync("supabase", ["--workdir", ROOT, "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return raw.match(/^DB_URL="(.+)"$/m)?.[1] ?? die("`supabase status` não trouxe DB_URL")
  } catch {
    return die("`supabase status` falhou — o stack local está de pé? (`supabase start`)")
  }
})()

/** psql em modo "só o valor", abortando no primeiro erro. */
const psql = (url, sql) =>
  execFileSync("psql", [url, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim()

/**
 * Carrega um arquivo .sql tolerando erro. spawnSync (e não execFileSync) porque com
 * ON_ERROR_STOP=0 o psql sai com **código 0 mesmo tendo cuspido erros** — num try/catch os
 * erros passariam batido. Quem julga o resultado é a conferência do fim, não o exit code.
 */
const loadFile = (file) => {
  const r = spawnSync("psql", [LOCAL, "-X", "-q", "-v", "ON_ERROR_STOP=0", "-f", file], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  })
  if (r.error) die(`psql não executou: ${r.error.message}`)
  return String(r.stderr || "")
    .split("\n")
    .filter((l) => /ERROR|FATAL/.test(l))
    // "schema já existe" é esperado: criamos public/bkp na mão antes, porque as extensions
    // (vector/pg_trgm moram DENTRO do public na nuvem) têm de existir antes do CREATE TABLE.
    .filter((l) => !/schema ".+" already exists/.test(l))
}

const rowCountsSql = `
  select table_schema || '.' || table_name || '=' ||
         (xpath('/row/c/text()', query_to_xml(
            format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
  from information_schema.tables
  where table_schema in (${SCHEMAS.map((s) => `'${s}'`).join(",")}) and table_type = 'BASE TABLE'
  order by 1`

// Inclui FKs e índices porque a primeira versão deste script NÃO os contava — e foi exatamente
// aí que 4 foreign keys ficaram de fora sem que a conferência reclamasse.
const objectCountsSql = `
  with pub as (select oid from pg_namespace where nspname = 'public')
  select 'functions=' || (select count(*) from pg_proc where pronamespace = (select oid from pub))
  union all select 'policies=' || (select count(*) from pg_policies where schemaname = 'public')
  union all select 'triggers=' || (select count(*) from information_schema.triggers where trigger_schema = 'public')
  union all select 'views=' || (select count(*) from pg_views where schemaname = 'public')
  union all select 'rls_on=' || (select count(*) from pg_class c where c.relnamespace = (select oid from pub) and c.relkind = 'r' and c.relrowsecurity)
  union all select 'fks=' || (select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relnamespace = (select oid from pub) and c.contype = 'f')
  union all select 'uniques=' || (select count(*) from pg_constraint c join pg_class t on t.oid = c.conrelid where t.relnamespace = (select oid from pub) and c.contype in ('u','p'))
  union all select 'indexes=' || (select count(*) from pg_indexes where schemaname = 'public')`

const toMap = (out) =>
  new Map(
    out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const i = l.lastIndexOf("=")
        return [l.slice(0, i), l.slice(i + 1)]
      })
  )

// ── 1. alcance das duas pontas ───────────────────────────────────────────────────────────
console.log(`origem : nuvem  db.${ref}.supabase.co`)
console.log(`destino: local  ${LOCAL.replace(/:[^:@]+@/, ":***@")}`)
try {
  psql(CLOUD, "select 1")
} catch (e) {
  die(`não conectei na nuvem — senha errada?\n  ${String(e.stderr || e.message).trim().split("\n")[0]}`)
}
try {
  psql(LOCAL, "select 1")
} catch {
  die("não conectei no Postgres local (`supabase start`?)")
}

// ── 2. inventário da ORIGEM (a régua da conferência final) ───────────────────────────────
const srcRows = toMap(psql(CLOUD, rowCountsSql))
const srcObjects = toMap(psql(CLOUD, objectCountsSql))
const srcTotal = [...srcRows.values()].reduce((a, b) => a + Number(b), 0)
const fmtObjects = (m) => [...m].map(([k, v]) => `${k} ${v}`).join(", ")
console.log(`\norigem : ${srcRows.size} tabelas, ${srcTotal.toLocaleString("pt-BR")} linhas`)
console.log(`         ${fmtObjects(srcObjects)}`)

// ── 3. pg_dump em DUAS seções ────────────────────────────────────────────────────────────
// Separado de propósito: constraints e índices ficam em `post-data`, o que abre uma janela
// entre carregar o dado e validar as FKs. É nessa janela que dá pra consertar as órfãs (ver
// passo 6) — num dump único o ADD CONSTRAINT falha e a constraint simplesmente não nasce.
// `--reuse-dump`: retoma do dump mais recente em vez de baixar de novo. O passo destrutivo
// (drop do `public`) vem DEPOIS do dump, então uma falha entre os dois deixa o local vazio
// com um dump de 120 MB intacto no disco — repetir o download só para refazer os passos
// seguintes é ~30 MB de egress e vários minutos por nada. Foi o que aconteceu em
// 2026-08-11, quando o COPY do auth abortou o pull no meio.
// ⚠️ O dump reusado é uma FOTO: reusar um antigo restaura o estado DAQUELE momento, e é
// por isso que a idade dele é impressa em vez de suposta.
const REUSE = process.argv.includes("--reuse-dump")
const stamp = new Date().toISOString().replace(/[:.]/g, "-")
let outDir = path.join(ROOT, ".backups", `pull-${stamp}`)
if (REUSE) {
  const anteriores = fs
    .readdirSync(path.join(ROOT, ".backups"))
    .filter((d) => /^pull-\d{4}/.test(d))
    .filter((d) => fs.existsSync(path.join(ROOT, ".backups", d, "cloud-data.sql")))
    .sort()
  if (!anteriores.length) die("--reuse-dump: nenhum pull-* com cloud-data.sql em .backups/")
  outDir = path.join(ROOT, ".backups", anteriores[anteriores.length - 1])
} else {
  fs.mkdirSync(outDir, { recursive: true })
}
const dataFile = path.join(outDir, "cloud-data.sql")
const postFile = path.join(outDir, "cloud-post.sql")

const dumpArgs = ["--no-owner", "--quote-all-identifiers", ...SCHEMAS.flatMap((s) => ["--schema", s])]
// Sem --no-privileges: policy sem GRANT não filtra nada — o papel `authenticated` precisa do
// grant de tabela pra RLS ter o que aplicar.
if (REUSE) {
  const idadeMin = Math.round((Date.now() - fs.statSync(dataFile).mtimeMs) / 60000)
  console.log(`\n→ REUSANDO o dump de ${path.basename(outDir)} (${idadeMin} min atrás) — sem baixar de novo`)
  console.log(`  ${(fs.statSync(dataFile).size / 1e6).toFixed(1)} MB + ${(fs.statSync(postFile).size / 1e6).toFixed(2)} MB`)
} else {
  console.log(`\n→ pg_dump seção pre-data + data`)
  execFileSync("pg_dump", [CLOUD, ...dumpArgs, "--section", "pre-data", "--section", "data", "-f", dataFile], {
    stdio: ["ignore", "inherit", "inherit"],
  })
  console.log(`  ${(fs.statSync(dataFile).size / 1e6).toFixed(1)} MB`)
  console.log(`→ pg_dump seção post-data (constraints, índices, policies)`)
  execFileSync("pg_dump", [CLOUD, ...dumpArgs, "--section", "post-data", "-f", postFile], {
    stdio: ["ignore", "inherit", "inherit"],
  })
  console.log(`  ${(fs.statSync(postFile).size / 1e6).toFixed(2)} MB`)
}

// ── 4. prepara o LOCAL ──────────────────────────────────────────────────────────────────
// pg_dump com --schema NÃO leva as extensions de que o schema depende (documentado: ele não
// tenta dumpar objetos externos ao schema selecionado). `vector` e `pg_trgm` moram DENTRO do
// public na nuvem, então sem criá-las antes a coluna `embedding vector` de work_embeddings
// quebra na carga.
console.log(`\n→ recriando os schemas ${SCHEMAS.join(", ")} no local`)
psql(
  LOCAL,
  `
  set client_min_messages = warning;  -- senão o cascade despeja ~100 linhas de "drop cascades to ..."
  drop schema if exists public cascade;
  drop schema if exists bkp cascade;
  create schema public;
  create schema bkp;
  grant usage on schema public to anon, authenticated, service_role;
  grant all on schema public to postgres;
  create extension if not exists vector with schema public;
  create extension if not exists pg_trgm with schema public;`
)

// ── 5. usuários do auth ANTES do dado ───────────────────────────────────────────────────
// Ordem importa: `user_settings.auth_user_id` tem FK pra `auth.users`. Com o auth vazio, a
// validação dessa FK falha no post-data e a constraint não nasce.
//
// Preserva os UUIDs: as 9 tabelas com dono referenciam user_id, e uuid novo desconectaria TODO
// o dado per-user (notas, estado de leitura, attribute_bias). Copiamos só a interseção de
// colunas — o schema `auth` é do GoTrue e a versão local difere da nuvem; copiar o schema
// inteiro quebraria o container de auth. Os hashes de senha vêm junto: o login local usa a
// mesma senha da nuvem.
console.log(`\n→ auth: copiando usuários (mantendo os UUIDs)`)

// 🔴 LIMPAR ANTES DE COPIAR — sem isto o pull funciona UMA vez e falha em todos os
// seguintes. O `drop schema public cascade` acima NÃO toca em `auth`, então os usuários
// do pull anterior continuam lá e o `COPY ... FROM STDIN` viola a PK:
//   ERROR: duplicate key value violates unique constraint "users_pkey"
// Pior que o erro é ONDE ele acontece: depois do drop e ANTES da carga, deixando o local
// com o `public` VAZIO — o app e os ~25 scripts de análise passam a responder
// `PGRST205 Could not find the table 'public.works'`, que não se parece nem um pouco com
// "o pull morreu no meio". Medido em 2026-08-11, no 2º pull da máquina.
// `identities` primeiro: ela referencia `users`.
psql(LOCAL, `delete from auth.identities; delete from auth.users;`)
const authCols = (url, table) =>
  psql(
    url,
    `select column_name from information_schema.columns
     where table_schema='auth' and table_name='${table}'
       and is_generated = 'NEVER' and is_identity = 'NO'
     order by ordinal_position`
  )
    .split("\n")
    .filter(Boolean)

for (const table of ["users", "identities"]) {
  const remote = authCols(CLOUD, table)
  const shared = remote.filter((c) => authCols(LOCAL, table).includes(c))
  if (!shared.length) {
    console.log(`  ${table}: sem colunas em comum — pulado`)
    continue
  }
  const list = shared.map((c) => `"${c}"`).join(",")
  const r = spawnSync(
    "bash",
    [
      "-c",
      `set -o pipefail; psql "$CLOUD" -X -q -v ON_ERROR_STOP=1 -c "COPY (select ${list} from auth.${table}) TO STDOUT" ` +
        `| psql "$LOCAL" -X -q -v ON_ERROR_STOP=1 -c "COPY auth.${table}(${list}) FROM STDIN"`,
    ],
    { env: { ...process.env, CLOUD, LOCAL }, encoding: "utf8" }
  )
  if (r.status !== 0) die(`falhou copiando auth.${table}:\n${r.stderr}`)
  console.log(`  ${table}: ${psql(LOCAL, `select count(*) from auth.${table}`)} linha(s), ${shared.length}/${remote.length} colunas`)
}

// ── 6. carrega estrutura + dado ─────────────────────────────────────────────────────────
console.log(`\n→ carregando estrutura e dado`)
const dataErrors = loadFile(dataFile)
if (dataErrors.length) console.log(`  ${dataErrors.length} erro(s)`)

// ── 7. post-data, com auto-conserto das órfãs ───────────────────────────────────────────
// A nuvem tem linhas que violam FKs que ela mesma marca como VALIDADAS (`convalidated = t`):
// medido em 2026-07-29 → deep_dive_results 12, recommendation_runs 14 e
// synopsis_quality_predictions 2074 apontando pra `ai_api_calls` que não existem mais. Só dá
// pra chegar nesse estado apagando linhas com a checagem de FK desligada
// (`session_replication_role = replica` ou DISABLE TRIGGER) — provavelmente uma poda da tabela
// de log. Como as FKs são ON DELETE SET NULL, um DELETE normal teria posto NULL nelas.
//
// Aqui essas FKs falhariam na validação e ficariam de fora do banco local. Em vez de aceitar um
// schema mais frouxo que o original, zeramos a referência pendurada (que é justamente o que o
// ON DELETE SET NULL faria) e criamos a constraint. Nada de real se perde: a linha de log
// apontada já não existe.
console.log(`\n→ constraints, índices e policies`)
let postErrors = loadFile(postFile)
const failedFks = [...new Set(postErrors.map((l) => l.match(/violates foreign key constraint "(.+?)"/)?.[1]).filter(Boolean))]

if (failedFks.length) {
  console.log(`  ${failedFks.length} foreign key(s) barrada(s) por linha órfã — consertando`)
  for (const name of failedFks) {
    // Definição vem da NUVEM, que é a fonte da verdade do schema.
    const meta = psql(
      CLOUD,
      `select t.relname || '|' || a.attname || '|' || rn.nspname || '|' || rt.relname || '|' || ra.attname
         || '|' || a.attnotnull || '|' || array_length(c.conkey, 1) || '|' || pg_get_constraintdef(c.oid)
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       join pg_namespace n on n.oid = t.relnamespace
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       join pg_class rt on rt.oid = c.confrelid
       join pg_namespace rn on rn.oid = rt.relnamespace
       join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
       where n.nspname = 'public' and c.conname = '${name}'`
    )
    if (!meta) {
      console.log(`    ${name}: não achei a definição na nuvem — deixando de fora`)
      continue
    }
    const [tbl, col, refSchema, refTbl, refCol, notNull, nKeys, condef] = meta.split("|")
    if (Number(nKeys) !== 1) {
      console.log(`    ${name}: FK composta — não sei consertar automaticamente, deixando de fora`)
      continue
    }
    if (notNull === "t") {
      console.log(`    ${name}: coluna NOT NULL — zerar não é opção, deixando de fora`)
      continue
    }
    const nulled = psql(
      LOCAL,
      `with orfas as (
         update public."${tbl}" x set "${col}" = null
         where x."${col}" is not null
           and not exists (select 1 from "${refSchema}"."${refTbl}" r where r."${refCol}" = x."${col}")
         returning 1)
       select count(*) from orfas`
    )
    psql(LOCAL, `alter table public."${tbl}" add constraint "${name}" ${condef}`)
    console.log(`    ${name}: ${nulled} referência(s) pendurada(s) zerada(s) em ${tbl}.${col} → constraint criada`)
  }
  postErrors = postErrors.filter((l) => !/violates foreign key constraint/.test(l))
}

const allErrors = [...dataErrors, ...postErrors]
const errFile = path.join(outDir, "load-errors.txt")
if (allErrors.length) {
  fs.writeFileSync(errFile, allErrors.join("\n"))
  console.log(`  ${allErrors.length} erro(s) não resolvido(s) → ${path.relative(ROOT, errFile)}`)
}

// ── 8. conferência (é isto que decide se o restore vale) ─────────────────────────────────
console.log(`\n→ conferindo destino contra origem`)
const dstRows = toMap(psql(LOCAL, rowCountsSql))
const dstObjects = toMap(psql(LOCAL, objectCountsSql))

const problems = []
for (const [table, want] of srcRows) {
  const got = dstRows.get(table)
  if (got === undefined) problems.push(`tabela AUSENTE no local: ${table} (${want} linhas na nuvem)`)
  else if (got !== want) problems.push(`${table}: nuvem ${want} × local ${got}`)
}
for (const [key, want] of srcObjects) {
  const got = dstObjects.get(key)
  if (got !== want) problems.push(`${key}: nuvem ${want} × local ${got}`)
}

const dstTotal = [...dstRows.values()].reduce((a, b) => a + Number(b), 0)
console.log(`  destino: ${dstRows.size} tabelas, ${dstTotal.toLocaleString("pt-BR")} linhas`)
console.log(`           ${fmtObjects(dstObjects)}`)

if (problems.length) {
  console.error(`\n✗ ${problems.length} divergência(s) — o banco local NÃO é uma cópia fiel:`)
  for (const p of problems.slice(0, 40)) console.error(`   • ${p}`)
  if (problems.length > 40) console.error(`   … e outras ${problems.length - 40}`)
  if (allErrors.length) console.error(`\n   erros da carga em ${path.relative(ROOT, errFile)}`)
  process.exit(1)
}

// Cada pull deixa ~113 MB. Guardamos 3 (PULL_KEEP): além de servirem pro dev local, estes dumps
// são hoje o ÚNICO backup do projeto que inclui schema, policies e functions — o NDJSON do
// `backup-db.mjs` não inclui. A política mora em `lib/backups-retencao.mjs`; até 2026-08-10 cada
// script tinha a sua, e cada regex enxergava só a própria família — foi assim que 3 famílias
// ficaram sem poda nenhuma.
podar("pull")

console.log(`\n✓ cópia fiel: ${srcRows.size} tabelas, ${srcTotal.toLocaleString("pt-BR")} linhas e todos os`)
console.log(`  objetos de schema (functions, policies, triggers, views, FKs, índices) conferem.`)
console.log(`\nO bucket de Storage "criteria-icons" (19 arquivos) NÃO veio: a API de Storage passa pelo`)
console.log(`gateway restrito (402). São ícones de critério — cosmético.`)
console.log(`\nPróximo passo:  npm run db:local  &&  npm run dev`)

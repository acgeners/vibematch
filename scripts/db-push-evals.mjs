#!/usr/bin/env node
/**
 * Empurra o resultado de avaliações de IA feitas no banco LOCAL para a NUVEM.
 *
 *   node scripts/db-push-evals.mjs --dry-run              → ensaio contra a nuvem (faz tudo e dá ROLLBACK)
 *   node scripts/db-push-evals.mjs --target=<pg-url>      → ensaio contra outro banco (ex.: cloudsim local)
 *   node scripts/db-push-evals.mjs --yes                  → escreve de verdade na nuvem
 *   node scripts/db-push-evals.mjs --skip-missing         → empurra só as obras que existem nos DOIS lados
 *
 * `--skip-missing` existe porque o caso normal de quem cura no local é ter, ao mesmo tempo,
 * avaliações novas de obras antigas E obras criadas do zero. Sem a flag, uma obra nova bloqueia
 * o push inteiro — inclusive avaliações que a nuvem está esperando há semanas. Com ela, as obras
 * ausentes ficam listadas e de fora, e o resto viaja na mesma transação única.
 *
 * Contexto: em 2026-07-29 o projeto da nuvem foi restrito por cota de egress e o dev migrou pro
 * stack local ([[project-supabase-local-dev]]). O banco local é DESCARTÁVEL — o próximo
 * `npm run db:pull` o destrói. Avaliação de IA, porém, é dado CARO (tokens + reviews raspadas de
 * 8 fontes atrás de Cloudflare) e sobretudo custa 1-2h de revisão manual. Este script leva essa
 * saída pro único lugar onde ela persiste.
 *
 * Por que é seguro fazer isto e não uma sincronização geral: as obras já existem nos dois lados com
 * o MESMO uuid (o local é uma cópia da nuvem), todos os PKs envolvidos são uuid gerados localmente,
 * a FK tem dois níveis (ai_evaluations → ai_evaluation_scores) e `criteria`/`source` são idênticas.
 * Nada precisa de remapeamento. É append de linhas-filhas, não merge.
 *
 * ⚠️ Escreve em PRODUÇÃO com --yes. Tudo acontece numa ÚNICA transação: ou entra inteiro ou nada
 * entra. Um push pela metade é o pior resultado possível — pior que falhar.
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync, spawnSync } from "node:child_process"
import { podar } from "./lib/backups-retencao.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")

const args = process.argv.slice(2)
const DRY = args.includes("--dry-run")
const YES = args.includes("--yes")
// Empurra só as obras que existem nos dois lados, em vez de abortar por causa das que foram
// criadas localmente. Ver o bloco "as obras têm de existir no destino".
const SKIP_MISSING = args.includes("--skip-missing")
const targetArg = args.find((a) => a.startsWith("--target="))?.slice("--target=".length)

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

// ── origem: sempre o Postgres local do `supabase start` ─────────────────────────────────
const SOURCE = (() => {
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

// ── destino: --target (ensaio) ou a nuvem ───────────────────────────────────────────────
let TARGET, targetLabel
if (targetArg) {
  TARGET = targetArg
  targetLabel = `ENSAIO ${targetArg.replace(/:[^:@]+@/, ":***@")}`
} else {
  const password = env.SUPABASE_DB_PASSWORD
  if (!password) die("falta SUPABASE_DB_PASSWORD no .env.local")
  const cloudUrl = snapshot.NEXT_PUBLIC_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || ""
  const ref = cloudUrl.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1]
  if (!ref) die(`não consegui extrair o project ref de "${cloudUrl}"`)
  TARGET = `postgresql://postgres:${encodeURIComponent(password)}@db.${ref}.supabase.co:5432/postgres?sslmode=require`
  targetLabel = `NUVEM db.${ref}.supabase.co`
  if (!DRY && !YES) {
    die(
      "escrever na NUVEM exige --yes explícito.\n" +
        "  Ensaie primeiro:  node scripts/db-push-evals.mjs --dry-run   (faz tudo e dá ROLLBACK)"
    )
  }
}
if (TARGET === SOURCE) die("origem e destino são o mesmo banco")

const psql = (url, sql) =>
  execFileSync("psql", [url, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }).trim()

const lines = (out) => out.split("\n").filter(Boolean)

console.log(`origem : LOCAL  ${SOURCE.replace(/:[^:@]+@/, ":***@")}`)
console.log(`destino: ${targetLabel}`)
console.log(`modo   : ${DRY ? "ENSAIO (rollback no fim)" : "GRAVANDO (commit)"}`)

try {
  psql(SOURCE, "select 1")
} catch {
  die("não conectei no Postgres local")
}
try {
  psql(TARGET, "select 1")
} catch (e) {
  die(`não conectei no destino:\n  ${String(e.stderr || e.message).trim().split("\n")[0]}`)
}

// ── 1. o que é novo: diff de ids de ai_evaluations ──────────────────────────────────────
// A nuvem é a fonte da verdade sobre o que ela já tem — nenhum marcador, nenhum timestamp de
// controle pra dessincronizar.
const targetEvalIds = new Set(lines(psql(TARGET, "select id from public.ai_evaluations")))
const localEvals = lines(psql(SOURCE, "select id || ' ' || work_id from public.ai_evaluations")).map((l) => l.split(" "))
const newEvals = localEvals.filter(([id]) => !targetEvalIds.has(id))
const workIds = [...new Set(newEvals.map(([, workId]) => workId))]

console.log(`\nai_evaluations: ${localEvals.length} no local, ${targetEvalIds.size} no destino`)
if (!newEvals.length) {
  console.log(`\n✓ nada a empurrar — o destino já tem todas as avaliações do local.`)
  process.exit(0)
}
console.log(`  → ${newEvals.length} avaliação(ões) nova(s), em ${workIds.length} obra(s)`)

// ── 2. as obras têm de existir no destino ───────────────────────────────────────────────
// Se uma obra foi CRIADA localmente ela não está aqui — é outro problema (exige inserir em
// `works` + upsert de `tags` com remap). Abortamos em vez de empurrar meia solução.
const idArrayAll = `'{${workIds.join(",")}}'::uuid[]`
const presentInTarget = new Set(lines(psql(TARGET, `select id from public.works where id = any(${idArrayAll})`)))
const missing = workIds.filter((id) => !presentInTarget.has(id))
if (missing.length) {
  console.error(`\n✗ ${missing.length} obra(s) não existe(m) no destino — foram criadas localmente:`)
  for (const id of missing.slice(0, 10)) {
    console.error(`   • ${id}  ${psql(SOURCE, `select title from public.works where id='${id}'`)}`)
  }
  if (!SKIP_MISSING) {
    die(
      "este script só empurra avaliação de obra que já existe nos dois lados. Criar obra é outro fluxo.\n" +
        "  Pra empurrar mesmo assim SÓ o que dá, repita com --skip-missing (as obras acima ficam de fora).",
    )
  }
  // `--skip-missing`: as obras acima ficam de fora e o resto viaja. Continua sendo tudo-ou-nada
  // sobre o subconjunto — a transação única não muda; o que muda é o que entra nela.
  //
  // Por que isto não é afrouxar a guarda: a recusa existia pra não empurrar "meia solução" numa
  // MESMA obra (avaliação sem a obra). Aqui a separação é POR OBRA — cada uma entra inteira ou
  // não entra. Uma obra criada localmente não tem nada de meio caminho no destino: ela
  // simplesmente ainda não existe lá, e continua não existindo depois.
  console.error(`\n⚠️  --skip-missing: as ${missing.length} obra(s) acima ficam FORA deste push.`)
}

const skipped = new Set(missing)
const pushableWorkIds = workIds.filter((id) => !skipped.has(id))
const pushableEvals = newEvals.filter(([, workId]) => !skipped.has(workId))
if (!pushableEvals.length) {
  console.log(`\n✓ nada a empurrar depois de excluir as obras ausentes.`)
  process.exit(0)
}
if (missing.length) {
  console.log(`  → seguem ${pushableEvals.length} avaliação(ões) em ${pushableWorkIds.length} obra(s)`)
}
const idArray = `'{${pushableWorkIds.join(",")}}'::uuid[]`

// ── 3. plano de transferência, em ordem de FK ───────────────────────────────────────────
const cols = (table) =>
  lines(
    psql(
      TARGET,
      `select column_name from information_schema.columns
       where table_schema='public' and table_name='${table}'
         and is_generated='NEVER' and is_identity='NO'
       order by ordinal_position`
    )
  )

// `ai_api_calls` não tem work_id (conferido), então escopo por tempo: tudo mais novo que a linha
// mais recente do destino. Exato e sem bookkeeping. É log append-only, sem FK de saída.
const maxCall = psql(TARGET, "select coalesce(max(created_at)::text, '-infinity') from public.ai_api_calls")

const PLAN = [
  {
    table: "ai_api_calls",
    where: `created_at > '${maxCall}'::timestamptz`,
    atLeast: true, // log append-only: o destino pode ter linhas próprias mais novas
    // Log de custo: sem ele o /curation/ai-usage da nuvem não mostra o que estas avaliações gastaram.
    insert: (c) => `insert into public.ai_api_calls (${c}) select ${c} from stage_ai_api_calls on conflict do nothing`,
  },
  {
    table: "work_reviews",
    where: `work_id = any(${idArray})`,
    // Contar linha aqui daria falso alarme: se a origem tem duas reviews de conteúdo idêntico, a
    // dedup grava UMA e o destino fica legitimamente com MENOS linhas. A invariante que importa é
    // cobertura de CONTEÚDO: todo (work_id, source, md5(text)) que existe na origem tem de existir
    // no destino.
    verify: `select count(*) from (
               select distinct work_id, source, md5(coalesce(text,'')) from public.work_reviews
               where work_id = any(${idArray})) t`,
    atLeast: true,
    // work_reviews NÃO tem chave natural, só PK em id (conferido). A avaliação re-raspa as
    // reviews, então elas chegam com uuid NOVO: um on-conflict-do-nothing duplicaria tudo que a
    // nuvem já tem. Dedup por conteúdo.
    insert: (c) => `insert into public.work_reviews (${c})
      select ${c} from stage_work_reviews s
      where not exists (
        select 1 from public.work_reviews r
        where r.work_id = s.work_id and r.source = s.source
          and md5(coalesce(r.text,'')) = md5(coalesce(s.text,''))
      )
      on conflict do nothing`,
  },
  {
    table: "ai_evaluations",
    where: `work_id = any(${idArray})`,
    insert: (c) => `insert into public.ai_evaluations (${c}) select ${c} from stage_ai_evaluations on conflict do nothing`,
  },
  {
    table: "ai_evaluation_scores",
    where: `ai_evaluation_id in (select id from public.ai_evaluations where work_id = any(${idArray}))`,
    insert: (c) =>
      `insert into public.ai_evaluation_scores (${c}) select ${c} from stage_ai_evaluation_scores on conflict do nothing`,
  },
  {
    table: "category_scores",
    where: `work_id = any(${idArray})`,
    // Espelha o app, que faz upsert em (work_id, criterion_slug) — ai.ts:555. Contamos abaixo
    // quantas linhas do destino serão SOBRESCRITAS, pra isso não passar em silêncio.
    insert: (c) => {
      const set = cols("category_scores")
        .filter((x) => !["work_id", "criterion_slug", "id"].includes(x))
        .map((x) => `"${x}" = excluded."${x}"`)
        .join(", ")
      return `insert into public.category_scores (${c}) select ${c} from stage_category_scores
              on conflict (work_id, criterion_slug) do update set ${set}`
    },
  },
]

// ── 4. quanto vai mexer (lido ANTES, pra o relatório ser honesto) ───────────────────────
const willOverwrite = psql(
  TARGET,
  `select count(*) from public.category_scores where work_id = any(${idArray})`
)
console.log(`\nlinhas a transferir:`)
const staged = []
const stamp = new Date().toISOString().replace(/[:.]/g, "-")

// Staging de ~2 MB por execução, inclusive em ensaio. Até 2026-08-10 esta família não tinha
// retenção nenhuma: a do `backup-db.mjs` só casa stamp ISO puro e o prefixo `push-` escapava.
// ⚠️ `push-` NÃO engole `push-curation-`: o regex da família exige o dígito do ano logo depois
// do prefixo. As duas são famílias distintas, com tetos distintos (2 MB × 96 MB por execução).
podar("push-evals")

const outDir = path.join(ROOT, ".backups", `push-${stamp}`)
fs.mkdirSync(outDir, { recursive: true })

for (const step of PLAN) {
  const c = cols(step.table)
  const list = c.map((x) => `"${x}"`).join(",")
  const n = psql(SOURCE, `select count(*) from public.${step.table} where ${step.where}`)
  const file = path.join(outDir, `${step.table}.tsv`)
  execFileSync(
    "psql",
    [SOURCE, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
     `\\copy (select ${list} from public.${step.table} where ${step.where}) to '${file}'`],
    { stdio: ["ignore", "ignore", "inherit"] }
  )
  console.log(`  ${step.table.padEnd(22)} ${String(n).padStart(6)} linha(s)`)
  staged.push({ ...step, cols: list, file, n: Number(n) })
}
console.log(`  ${"works (só o status)".padEnd(22)} ${String(pushableWorkIds.length).padStart(6)} obra(s)`)
if (Number(willOverwrite) > 0) {
  console.log(`\n  ⚠️ ${willOverwrite} linha(s) de category_scores já existem no destino e serão SOBRESCRITAS`)
  console.log(`     (é o mesmo upsert que o app faz em ai.ts:555 — mas se você editou nota na nuvem, ela se vai)`)
}

// status das obras: só as duas colunas que a avaliação mexe
const statusCols = cols("works").filter((c) => ["ai_eval_status", "ai_eval_reviews_stale"].includes(c))
const statusFile = path.join(outDir, "works-status.tsv")
execFileSync(
  "psql",
  [SOURCE, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
   `\\copy (select id,${statusCols.map((c) => `"${c}"`).join(",")} from public.works where id = any(${idArray})) to '${statusFile}'`],
  { stdio: ["ignore", "ignore", "inherit"] }
)

// ── 5. uma transação só: entra inteiro ou não entra ─────────────────────────────────────
const sql = [`\\set ON_ERROR_STOP on`, `begin;`]
for (const s of staged) {
  sql.push(`create temp table stage_${s.table} (like public.${s.table} including defaults) on commit drop;`)
  sql.push(`\\copy stage_${s.table} (${s.cols}) from '${s.file}'`)
  sql.push(`with ins as (${s.insert(s.cols)} returning 1) select '${s.table}=' || count(*) from ins;`)
}
sql.push(
  `create temp table stage_works (id uuid, ${statusCols.map((c) => `"${c}" text`).join(", ")}) on commit drop;`,
  `\\copy stage_works from '${statusFile}'`,
  // O status vai DEPOIS das avaliações: o trigger enforce_work_ai_eval_pending_reality lê
  // ai_evaluations pra decidir, e works.ai_eval_status é enum/text — cast explícito.
  `with upd as (
     update public.works w set ${statusCols.map((c) => `"${c}" = s."${c}"::${c === "ai_eval_reviews_stale" ? "boolean" : "text"}`).join(", ")}
     from stage_works s where s.id = w.id
       and (${statusCols.map((c) => `w."${c}"::text is distinct from s."${c}"`).join(" or ")})
     returning 1)
   select 'works_status=' || count(*) from upd;`
)
sql.push(DRY ? `rollback;` : `commit;`)

const sqlFile = path.join(outDir, "push.sql")
fs.writeFileSync(sqlFile, sql.join("\n") + "\n")

console.log(`\n→ aplicando no destino (${DRY ? "com ROLLBACK no fim" : "COMMIT"})`)
const run = spawnSync("psql", [TARGET, "-X", "-A", "-t", "-q", "-f", sqlFile], {
  encoding: "utf8",
  maxBuffer: 256 * 1024 * 1024,
})
if (run.stderr?.trim()) console.error(run.stderr.trim())
if (run.status !== 0) {
  die(`a transação falhou — NADA foi gravado (ver ${path.relative(ROOT, sqlFile)})`)
}
const applied = new Map(lines(run.stdout).filter((l) => l.includes("=")).map((l) => l.split("=")))
for (const [k, v] of applied) console.log(`  ${k.padEnd(22)} ${String(v).padStart(6)} aplicada(s)`)

// ── 6. conferência ──────────────────────────────────────────────────────────────────────
if (DRY) {
  console.log(`\n✓ ENSAIO passou: a transação inteira rodou (constraints, triggers e policies incluídos)`)
  console.log(`  e foi revertida. Nada mudou no destino.`)
  console.log(`\nPra valer:  node scripts/db-push-evals.mjs${targetArg ? ` --target=${targetArg}` : " --yes"}`)
  process.exit(0)
}

console.log(`\n→ conferindo destino contra origem`)
const problems = []
for (const s of staged) {
  const sql = s.verify ?? `select count(*) from public.${s.table} where ${s.where}`
  const there = Number(psql(TARGET, sql))
  const here = Number(psql(SOURCE, sql))
  const ok = s.atLeast ? there >= here : there === here
  if (!ok) problems.push(`${s.table}: origem ${here} × destino ${there}${s.verify ? " (conteúdo distinto)" : ""}`)
  else console.log(`  ${s.table.padEnd(22)} destino ${there} (origem ${here}) ok`)
}
const statusMismatch = Number(
  psql(
    TARGET,
    `select count(*) from public.works where id = any(${idArray}) and ai_eval_status = 'pending'`
  )
)
if (statusMismatch) problems.push(`${statusMismatch} obra(s) ainda em ai_eval_status='pending' no destino`)

if (problems.length) {
  console.error(`\n✗ ${problems.length} divergência(s) depois do push:`)
  for (const p of problems) console.error(`   • ${p}`)
  process.exit(1)
}

console.log(`\n✓ push conferido: ${pushableEvals.length} avaliação(ões) de ${pushableWorkIds.length} obra(s) na nuvem.`)
console.log(`\nFalta 1 passo manual: \`calculated_scores\` NÃO foi empurrada (é TS determinístico e`)
console.log(`depende de recalc). Rode "Recalcular" nessas obras na nuvem — ou o recalc geral — pra`)
console.log(`Nota.Calc e Nota Prevista saírem do zero. Obras:`)
for (const id of pushableWorkIds) console.log(`  ${id}  ${psql(SOURCE, `select title from public.works where id='${id}'`)}`)

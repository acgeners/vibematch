#!/usr/bin/env node
/**
 * Impressão digital de TODAS as tabelas do schema `public` do banco LOCAL.
 *
 *   node scripts/db-table-fingerprint.mjs snap antes
 *   … faz UMA operação no app (ex.: "Atualizar dados" + "Avaliar IA" numa obra) …
 *   node scripts/db-table-fingerprint.mjs snap depois
 *   node scripts/db-table-fingerprint.mjs diff antes depois
 *
 * Para que serve: descobrir, MEDINDO, o que uma operação do app escreve — em vez de
 * deduzir lendo o código. Toda tabela que aparecer no diff e não estiver no PLAN de um
 * pusher é uma omissão silenciosa (o dado nasce no local e morre no próximo `db:pull`).
 *
 * Por que hash e não só contagem: contagem não enxerga UPDATE. "Atualizar dados" mexe
 * em dezenas de colunas de `works` sem criar nenhuma linha — num diff por contagem isso
 * é invisível, que é exatamente o pior tipo de lacuna. O hash é por CONTEÚDO de linha e
 * independente de ordem, então pega insert, update e delete.
 *
 * Snapshots vão pra `.backups/fingerprints/` (gitignored).
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { podar } from "./lib/backups-retencao.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")
const OUT_DIR = path.join(ROOT, ".backups", "fingerprints")

// Família de diretório FIXO: não acumula versões, então não há o que podar. A chamada existe
// para que este script participe da checagem de órfãos — é ela que denuncia o PRÓXIMO prefixo
// que alguém criar sem dono. Ver `lib/backups-retencao.mjs`.
podar("fingerprints")

const die = (msg) => {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

// ── alvo: SEMPRE o Postgres local do `supabase start` ──────────────────────────────────
// Nunca a nuvem: isto varre 83 tabelas inteiras e seria um tiro de egress no pé.
const DB = (() => {
  try {
    const raw = execFileSync("supabase", ["--workdir", ROOT, "status", "-o", "env"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    return raw.match(/^DB_URL="(.+)"$/m)?.[1] ?? die("`supabase status` não trouxe DB_URL")
  } catch {
    return die("`supabase status` falhou — o stack local está de pé? (`supabase start`)")
  }
})()

const psql = (sql) =>
  execFileSync("psql", [DB, "-X", "-A", "-t", "-q", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-c", sql], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  }).trim()

function fingerprint() {
  const tables = psql(`
    select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE'
    order by table_name
  `)
    .split("\n")
    .filter(Boolean)

  // Um SELECT só por tabela: contagem + hash do conteúdo. O hash agrega os md5 de cada
  // linha ORDENADOS pelo próprio md5 — assim independe da ordem física, que muda sozinha
  // com VACUUM/UPDATE e produziria falso positivo.
  const union = tables
    .map(
      (t) =>
        `select '${t}' as t, count(*) as n, coalesce(md5(string_agg(h, '' order by h)), '-') as h
         from (select md5(x::text) as h from public."${t}" x) s`,
    )
    .join(" union all ")

  const rows = psql(`${union} order by t`)
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [table, n, h] = line.split("\t")
      return { table, n: Number(n), h }
    })

  return { takenAt: new Date().toISOString(), tables: rows }
}

function pathFor(label) {
  return path.join(OUT_DIR, `${label}.json`)
}

const [cmd, a, b] = process.argv.slice(2)

if (cmd === "snap") {
  if (!a) die("uso: node scripts/db-table-fingerprint.mjs snap <rotulo>")
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const fp = fingerprint()
  fs.writeFileSync(pathFor(a), JSON.stringify(fp, null, 2))
  const total = fp.tables.reduce((s, r) => s + r.n, 0)
  console.log(`✓ snapshot "${a}": ${fp.tables.length} tabelas, ${total.toLocaleString("pt-BR")} linhas`)
  console.log(`  ${pathFor(a)}`)
} else if (cmd === "diff") {
  if (!a || !b) die("uso: node scripts/db-table-fingerprint.mjs diff <antes> <depois>")
  for (const l of [a, b]) if (!fs.existsSync(pathFor(l))) die(`snapshot "${l}" não existe`)
  const before = JSON.parse(fs.readFileSync(pathFor(a), "utf8"))
  const after = JSON.parse(fs.readFileSync(pathFor(b), "utf8"))

  const byTable = new Map(before.tables.map((r) => [r.table, r]))
  const changed = []
  for (const row of after.tables) {
    const prev = byTable.get(row.table)
    if (!prev) {
      changed.push({ table: row.table, delta: row.n, kind: "TABELA NOVA" })
      continue
    }
    if (prev.h === row.h) continue
    const delta = row.n - prev.n
    changed.push({
      table: row.table,
      delta,
      kind: delta > 0 ? "linhas novas" : delta < 0 ? "linhas removidas" : "SÓ UPDATE (contagem igual)",
      from: prev.n,
      to: row.n,
    })
  }

  console.log(`\nantes : ${before.takenAt}`)
  console.log(`depois: ${after.takenAt}\n`)

  if (changed.length === 0) {
    console.log("nenhuma tabela mudou.")
  } else {
    const w = Math.max(...changed.map((c) => c.table.length), 10)
    console.log(`${"tabela".padEnd(w)}  ${"antes".padStart(7)} ${"depois".padStart(7)} ${"delta".padStart(7)}  o quê`)
    console.log("─".repeat(w + 40))
    for (const c of changed.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))) {
      const d = c.delta > 0 ? `+${c.delta}` : String(c.delta)
      console.log(
        `${c.table.padEnd(w)}  ${String(c.from ?? "-").padStart(7)} ${String(c.to ?? "-").padStart(7)} ${d.padStart(7)}  ${c.kind}`,
      )
    }
    console.log(`\n${changed.length} tabela(s) tocada(s).`)
    console.log("⚠️ Toda tabela desta lista precisa estar no PLAN do pusher — ou o dado morre no db:pull.")
  }
} else {
  die(
    "uso:\n" +
      "  node scripts/db-table-fingerprint.mjs snap <rotulo>\n" +
      "  node scripts/db-table-fingerprint.mjs diff <antes> <depois>",
  )
}

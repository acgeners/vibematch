#!/usr/bin/env node
/**
 * Aplica um arquivo de migration no Supabase via **Management API**
 * (`POST /v1/projects/{ref}/database/query`), sem SQL editor.
 *
 *   node scripts/apply-migration.mjs supabase/migrations/144_snapshot_pre_fatia2c.sql
 *   node scripts/apply-migration.mjs <arquivo> --dry-run    → só imprime o SQL
 *   node scripts/apply-migration.mjs --check                → só confere se o token PODE escrever
 *
 * Precisa de `SUPABASE_ACCESS_TOKEN` no .env.local (token pessoal da conta Supabase).
 *
 * ⚠️ Isto roda SQL ARBITRÁRIO com privilégio total — inclusive `drop`. Antes de usar:
 *   - Rode `node scripts/backup-db.mjs` se a migration mexe em dado.
 *   - `create/drop policy` e `alter table` pegam AccessExclusiveLock e podem DAR DEADLOCK
 *     com o app rodando (aconteceu na mig 142). Pare o dev server antes.
 *
 * A API roda o script inteiro numa transação. Se qualquer statement falhar, nada é aplicado.
 *
 * 🔴 O endpoint executa como `supabase_read_only_user` quando o token só tem a permissão
 * `database_read` — e aí o `read_only: false` do corpo NÃO tem efeito. Medido em 2026-10-10
 * com o token do `.env.local`: as três formas do corpo (omitido, `false`, `true`) responderam
 * `current_user = supabase_read_only_user` e `transaction_read_only = on`, e a migration 203
 * voltou `25006: cannot execute DROP TABLE in a read-only transaction`. A especificação pública
 * (`x-fga-permissions: [["database_read"], ["database_write"]]`) aceita qualquer uma das duas.
 * Por isso este script SONDA antes de enviar: sem a sonda, a falha só aparece no meio da
 * migration, e a mensagem do Postgres não diz que a causa é a permissão do token.
 *
 * Se a sonda recusar, o caminho suportado é o psql direto como `postgres` (senha em
 * `.env.supabase-cloud`), numa transação com `ON_ERROR_STOP` e bloco de asserções antes do
 * `commit` — com um ensaio idêntico terminando em `rollback` antes. Foi assim que a 203 entrou.
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

/** Corpo da chamada. `read_only: false` é explícito: o padrão do endpoint não é contrato. */
export function buildQueryBody(query) {
  return JSON.stringify({ query, read_only: false })
}

/** Sonda SÓ DE LEITURA: quem a API usa para executar, e se a transação aceita escrita. */
export const SONDA_ESCRITA_SQL =
  "select current_user as usr, current_setting('transaction_read_only') as tx_ro"

/**
 * Lê a resposta da sonda. Zero linha é recusa, não sucesso: sem linha não houve o que
 * conferir, e seguir mandaria a migration às cegas.
 */
export function diagnosticarEscrita(rows) {
  const r = Array.isArray(rows) ? rows[0] : null
  if (!r || typeof r !== "object") {
    return { ok: false, motivo: "a sonda não devolveu linha — não dá para saber se o token escreve" }
  }
  if (r.tx_ro !== "off" || r.usr === "supabase_read_only_user") {
    return {
      ok: false,
      motivo:
        `a Management API executou como "${r.usr}" com transaction_read_only=${r.tx_ro}. ` +
        "O token só tem permissão de LEITURA no banco (database_read); o read_only:false do corpo " +
        "não muda isso. Nada foi enviado. Use o psql direto como postgres (ver o cabeçalho deste " +
        "arquivo) ou um token com database_write.",
    }
  }
  return { ok: true, usr: r.usr }
}

function lerEnvLocal(root) {
  for (const line of fs.readFileSync(path.join(root, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
  }
}

/** Roda SQL e devolve as linhas. */
export async function runSql(query, { ref, token, fetchImpl = fetch }) {
  const res = await fetchImpl(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: buildQueryBody(query),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function main() {
  const ROOT = path.resolve(import.meta.dirname, "..")
  lerEnvLocal(ROOT)

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
  const cfg = { ref: REF, token: TOKEN }

  const check = process.argv.includes("--check")
  const dry = process.argv.includes("--dry-run")
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"))
  if (!file && !check) {
    console.error("uso: node scripts/apply-migration.mjs <arquivo.sql> [--dry-run] | --check")
    process.exit(1)
  }

  console.log(`projeto: ${REF}`)

  if (file) {
    const sql = fs.readFileSync(path.resolve(ROOT, file), "utf8")
    console.log(`arquivo: ${file} (${sql.split("\n").length} linhas)`)
    if (dry) {
      console.log("\n[dry-run] SQL que seria enviado (nada foi conferido nem enviado):\n")
      console.log(sql)
      process.exit(0)
    }
  }

  const diag = diagnosticarEscrita(await runSql(SONDA_ESCRITA_SQL, cfg))
  if (!diag.ok) {
    console.error(`\n❌ ${diag.motivo}`)
    process.exit(2)
  }
  console.log(`sonda: a API executa como "${diag.usr}", transação aceita escrita`)
  if (check) process.exit(0)

  const sql = fs.readFileSync(path.resolve(ROOT, file), "utf8")
  const out = await runSql(sql, cfg)
  console.log("\n✅ aplicada.")
  if (Array.isArray(out) && out.length > 0) console.log(JSON.stringify(out, null, 1).slice(0, 500))
}

/**
 * Só executa quando chamado direto — importar num teste não pode disparar nada contra a nuvem.
 * Via `realpath`, não `resolve`: com symlink no caminho a comparação crua dá falso e o script
 * sairia com código 0 sem fazer nada (ver `scripts/smoke.mjs`).
 */
const mesmoArquivo = (a, b) => {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b)
  } catch {
    return false
  }
}
if (Boolean(process.argv[1]) && mesmoArquivo(process.argv[1], fileURLToPath(import.meta.url))) {
  await main()
}

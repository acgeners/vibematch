#!/usr/bin/env node
/**
 * Liga/desliga o LOCAL PRIMARY MODE — ver scripts/lib/local-primary.mjs.
 *
 *   npm run db:local-primary        → estado
 *   npm run db:local-primary on     → ativa (o banco LOCAL vira fonte da verdade)
 *   npm run db:local-primary off    → desativa (só depois de promover LOCAL → CLOUD)
 *
 * ALVO: LOCAL. O sentinela é o que faz `db:pull` recusar; ligá-lo é a decisão, não a prosa.
 */
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { SENTINELA, lerSentinela, ehLocal } from "./lib/local-primary.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")
const cmd = process.argv[2]
const s = lerSentinela()

if (!cmd) {
  console.log(
    s
      ? `\nLOCAL PRIMARY: ATIVO desde ${s.ativadoEm}\n  snapshot da nuvem: ${s.snapshotDe}\n  último backup: ${s.ultimoBackup ?? "🔴 NENHUM"}\n`
      : "\nLOCAL PRIMARY: desligado (o local é réplica descartável; `db:pull` roda sem perguntar)\n",
  )
  process.exit(0)
}

if (cmd === "on") {
  if (!ehLocal(process.env.NEXT_PUBLIC_SUPABASE_URL)) {
    console.error(`\n🔴 o alvo é ${process.env.NEXT_PUBLIC_SUPABASE_URL} — rode \`npm run db:local\` antes.\n`)
    process.exit(1)
  }
  if (s) { console.log(`\njá estava ativo desde ${s.ativadoEm}\n`); process.exit(0) }
  const obras = execFileSync("psql", ["postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    "-X", "-A", "-t", "-q", "-c", "select count(*) from works"], { encoding: "utf8" }).trim()
  fs.writeFileSync(SENTINELA, JSON.stringify({
    ativadoEm: new Date().toISOString(),
    snapshotDe: new Date().toISOString().slice(0, 10),
    obrasNoSnapshot: Number(obras),
    ultimoBackup: null,
  }, null, 2) + "\n")
  console.log(`\n✓ LOCAL PRIMARY ATIVO — ${obras} obras. \`db:pull\` agora RECUSA sem intenção explícita.`)
  console.log(`  faça um backup agora:  npm run db:local:backup\n`)
  process.exit(0)
}

if (cmd === "off") {
  if (!s) { console.log("\njá estava desligado\n"); process.exit(0) }
  fs.unlinkSync(SENTINELA)
  console.log(`\n✓ LOCAL PRIMARY desligado (estava ativo desde ${s.ativadoEm}).`)
  console.log(`  ⚠️ \`db:pull\` volta a destruir o local sem perguntar.\n`)
  process.exit(0)
}
console.error(`uso: npm run db:local-primary [on|off]`)
process.exit(1)

#!/usr/bin/env node
/**
 * Backup do banco PRIMÁRIO — o ponto de entrada único do agente automático.
 *
 *   node scripts/backup-primary.mjs        (npm run backup)
 *
 * 🔴 POR QUE ELE EXISTE. O agente semanal chamava `backup-db.mjs` com
 * `BACKUP_ENV_FILE=.env.supabase-cloud` cravado no plist — ou seja, "a nuvem é a verdade"
 * escrito num arquivo que ninguém revisita. Quando o LOCAL virou primário em 2026-08-23, o
 * agente seguiu salvando um projeto PAUSADO: 3 semanas de diretórios vazios, `totalRows: 0`,
 * e sucesso anunciado. O alvo não pode ser uma constante do agendador; tem que ser DERIVADO
 * de quem é primário AGORA.
 *
 * A fonte de "quem é primário" é o sentinela `.local-primary` — o mesmo que já faz o
 * `db:pull` recusar. Um segundo lugar dizendo isso divergiria na primeira troca.
 */
import { spawnSync } from "node:child_process"
import path from "node:path"
import { localPrimaryAtivo, lerSentinela } from "./lib/local-primary.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")
const run = (cmd, args, env) =>
  spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } }).status ?? 1

const s = lerSentinela()
if (localPrimaryAtivo()) {
  console.log(`\n▶ PRIMÁRIO = LOCAL (sentinela de ${s.ativadoEm})`)
  console.log(`  pg_dump do stack local + cópia externa conferida por sha256`)
  // O db:local:backup exige NEXT_PUBLIC_SUPABASE_URL local; os npm scripts já carregam
  // .env.local + .env.analysis, então delegamos pelo npm em vez de reconstruir o env aqui.
  process.exit(run("npm", ["run", "--silent", "db:local:backup"]))
}

console.log(`\n▶ PRIMÁRIO = NUVEM (sem sentinela .local-primary)`)
process.exit(run("node", ["scripts/backup-db.mjs"], { BACKUP_ENV_FILE: ".env.supabase-cloud" }))

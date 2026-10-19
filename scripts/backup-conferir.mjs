#!/usr/bin/env node
/**
 * Confere os backups de `.backups/` e SIMULA a retenção — só leitura, não toca em nada.
 *
 *   node scripts/backup-conferir.mjs            (npm run backup:conferir)
 *   node scripts/backup-conferir.mjs /caminho   → confere outra pasta-base
 *
 * Não acessa banco nenhum. Imprime o estado de cada pasta de backup (completo, sem-schema,
 * incompleto, desconhecido — régua em `lib/backup-integridade.mjs`) e o plano da poda: o que o
 * próximo backup manteria e o que apagaria se rodasse com BACKUP_PODAR=1.
 */
import path from "node:path"
import { classificarBackup } from "./lib/backup-integridade.mjs"
import { BASE, listarFamilia, planejarPoda } from "./lib/backups-retencao.mjs"

const base = process.argv[2] ? path.resolve(process.argv[2]) : BASE

const nomes = [...listarFamilia("backup", base), ...listarFamilia("backup-parcial", base)].sort()
if (nomes.length === 0) {
  console.log(`nenhum backup em ${base}`)
  process.exit(0)
}

console.log(`backups em ${base}\n`)
for (const nome of nomes) {
  const c = classificarBackup(path.join(base, nome))
  const marca = { completo: "✅", "sem-schema": "⚠️ ", incompleto: "🔴", desconhecido: "❔" }[c.estado]
  const linhas = c.totalRows ? ` · ${c.totalRows} linhas em ${c.tabelas} tabelas` : ""
  console.log(`${marca} ${nome.padEnd(36)} ${c.estado.padEnd(12)}${c.legado ? " (legado)" : ""}${linhas}`)
  if (!c.completo) console.log(`     ${c.motivo}`)
}

const plano = planejarPoda("backup", { base })
console.log(`\nretenção (SIMULAÇÃO — nada é apagado aqui): limite ${plano.keep} (BACKUP_KEEP)`)
console.log(`  mantém ${plano.manter.length}: ${plano.manter.join(", ") || "—"}`)
console.log(`  com BACKUP_PODAR=1, a poda de hoje apagaria ${plano.apagar.length}` +
  (plano.apagar.length ? `: ${plano.apagar.join(", ")}` : ""))
console.log(`  (o próximo backup completo entra na contagem e empurra mais um; pasta que não é`)
console.log(`   "completo" nunca conta nem é apagada)`)

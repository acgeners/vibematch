#!/usr/bin/env node
/**
 * Guarda de `npm run dev` — roda como `predev`.
 *
 * 🔴 POR QUE. O estouro de quota de 2026-08 tem causa MEDIDA no painel: o cutover de 10/08
 * mandou o APP para a nuvem e o egress saltou de ~80 MB/dia para ~450 MB/dia (picos de 1 GB),
 * fechando o ciclo em 5,97 GB de 5 GB. A conta fecha com o uso normal: `/catalog` custa
 * 1.494 KB por carregamento e o Fast Refresh recarrega a página aberta a cada save — ~253
 * recargas/dia é uma jornada comum, não abuso.
 *
 * O interruptor (`npm run db:local`) já existia e não foi esquecido por descuido: nada avisava.
 * `exigirAlvoLocal` guardava 3 scripts e NÃO guardava o caminho que de fato gasta, que é o
 * dev server. Esta é a guarda que faltava.
 *
 * ⚠️ Só RECUSA sob LOCAL PRIMARY. Sob CLOUD PRIMARY (o regime desde 2026-09-08) apontar o dev
 * para a nuvem é a escolha correta, e a guarda vira BANNER — o objetivo é impedir uso
 * acidental, não bloquear a nuvem.
 */
import fs from "node:fs"
import path from "node:path"
import { localPrimaryAtivo, ehLocal } from "./lib/local-primary.mjs"

const ROOT = path.resolve(import.meta.dirname, "..")
const envFile = path.join(ROOT, ".env.local")
const url = fs.existsSync(envFile)
  ? (fs.readFileSync(envFile, "utf8").match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)?.[1] ?? "").replace(/^["']|["']$/g, "")
  : ""

if (ehLocal(url)) process.exit(0)

if (localPrimaryAtivo()) {
  console.error(`\n🔴 RECUSADO — LOCAL PRIMARY ativo e o app aponta para ${url || "(vazio)"}.`)
  console.error(`   Sob LOCAL PRIMARY a nuvem é um snapshot congelado: desenvolver contra ela`)
  console.error(`   gasta quota E lê dado velho.  Rode:  npm run db:local\n`)
  process.exit(1)
}

// CLOUD PRIMARY: apontar o dev para a nuvem é a escolha CORRETA, não um acidente — então
// não se bloqueia. O que se impede é o uso DISTRAÍDO: o banner existe porque o estouro de
// 08/2026 não veio de ninguém decidir gastar, veio de ninguém perceber que estava gastando.
const L = "━".repeat(64)
console.warn(`\n\x1b[43m\x1b[30m${L}\x1b[0m`)
console.warn(`\x1b[43m\x1b[30m  DATABASE TARGET: CLOUD  —  EGRESS WILL BE CONSUMED${" ".repeat(11)}\x1b[0m`)
console.warn(`\x1b[43m\x1b[30m${L}\x1b[0m`)
console.warn(`  projeto : ${url}`)
console.warn(`  primário: CLOUD (sem sentinela .local-primary)`)
console.warn(`  medido  : /catalog ~1.494 KB por carregamento · Fast Refresh recarrega a cada save`)
console.warn(`            08/2026 fechou o ciclo em 5,97 GB de 5 GB neste mesmo modo`)
console.warn(`  de graça: npm run db:local   (volta o app para o stack local)`)
console.warn(`  medir    : node scripts/egress-proxy.mjs\n`)

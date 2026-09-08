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
 * ⚠️ Só recusa sob LOCAL PRIMARY. Sem sentinela, apontar o dev para a nuvem é uma escolha
 * legítima (curadoria precisa persistir lá) — aí ele apenas AVISA o custo.
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

console.warn(`\n⚠️  dev server apontando para a NUVEM (${url}).`)
console.warn(`   Medido em 08/2026: ~450 MB/dia neste modo (teto free = 5 GB/ciclo).`)
console.warn(`   Para desenvolver de graça:  npm run db:local\n`)

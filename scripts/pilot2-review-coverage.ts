/**
 * CLI — painel READ-ONLY das 13 obras com <2 reviews úteis (Plano 3 Fase B2.2M §9).
 * NÃO toca no banco, NÃO chama LLM, NÃO adiciona reviews, zero custo. Lê o artefato
 * CONGELADO da B2.2G (`review-coverage-under-2.csv`) e imprime o painel: título · rota
 * local · reviews úteis atuais · quantas faltam p/ 2 · fontes externas disponíveis.
 * Escreve um artefato local de painel (não-DB) ao lado do CSV.
 *
 * Uso: npm run pilot2:coverage
 */
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  buildPilot2CoveragePanel,
  parseCoverageUnder2Csv,
  MIN_USEFUL_TARGET,
} from "@/lib/synopsis-interest/pilot2-review-coverage"

const DIR = ".local-experiments/plan3/digest-exp-1/pilot-2/review-coverage-audit"
const CSV = resolve(DIR, "review-coverage-under-2.csv")
const OUT = resolve(DIR, "coverage-panel-b2.2m.json")

function main(): void {
  const csv = readFileSync(CSV, "utf8")
  const panel = buildPilot2CoveragePanel(parseCoverageUnder2Csv(csv))

  console.log(`\n=== Painel B2.2M — cobertura de reviews (meta = ${MIN_USEFUL_TARGET} úteis/obra) ===`)
  console.log(`fonte: ${CSV} (B2.2G, congelado) · NENHUMA review adicionada\n`)
  for (const r of panel.rows) {
    console.log(`• ${r.title}`)
    console.log(`    rota: http://localhost:3001${r.localRoute}`)
    console.log(`    úteis: ${r.usefulReviewCount} · faltam p/ ${MIN_USEFUL_TARGET}: ${r.missingToTarget} · ${r.split}/${r.stratum}`)
    console.log(`    fontes externas: ${r.availableExternalSources.join(", ")}`)
  }
  console.log(
    `\nresumo: 0 úteis=${panel.summary.zeroUseful} · 1 útil=${panel.summary.oneUseful} · total=${panel.summary.total} · reviews faltando=${panel.summary.totalMissing}`,
  )

  writeFileSync(OUT, JSON.stringify(panel, null, 2) + "\n")
  console.log(`\nartefato: ${OUT}`)
  console.log("[read-only] nenhuma review adicionada, nenhum acesso ao banco, zero custo.")
}

main()

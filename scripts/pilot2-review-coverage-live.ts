/**
 * CLI — cobertura LIVE (read-only) das 13 obras com <2 reviews úteis (Plano 3 B2.2M-AUDIT §3).
 *
 * Distinta de `pilot2:coverage` (que lê o CSV CONGELADO da B2.2G = baseline). Esta consulta
 * o BANCO **somente por SELECT**, via os loaders canônicos:
 *   readScrapedExternalReviews        → SÓ work_reviews
 *   readManuallyEnteredExternalReviews→ SÓ work_external_reviews_manual
 *   readCanonicalReviewCorpus         → combina apenas os dois acima
 * NUNCA consulta work_manual_reviews. NÃO escreve, NÃO chama LLM, NÃO gera digest, zero custo.
 *
 * A lista das 13 obras vem do CSV congelado (sem alterar o manifesto). Para cada obra mostra:
 * scraped útil · manual_external útil · útil antes/depois do dedupe · fontes distintas/presentes ·
 * faltam p/ 2 · reviewCorpusSignature. Agregados + linhas atuais em work_external_reviews_manual.
 *
 * SEPARA (B2.2O): baseline HISTÓRICO (9/4/0, congelado, referência) × estado ATUAL (progresso
 * autorizado) × DIVERGÊNCIA REAL (invariantes). O progresso ratificado NÃO bloqueia; o comando
 * SÓ falha em invariante real (nº de obras-alvo ≠ 13, obra-alvo <2, dup canônica inesperada,
 * agregado ≠ individual). Não lê `work_manual_reviews` (loaders canônicos só).
 *
 * Uso: npm run pilot2:coverage:live
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createClient } from "@supabase/supabase-js"
import {
  parseCoverageUnder2Csv,
  MIN_USEFUL_TARGET,
  HISTORICAL_COVERAGE_BASELINE,
  evaluateLiveCoverage,
} from "@/lib/synopsis-interest/pilot2-review-coverage"
import {
  readScrapedExternalReviews,
  readManuallyEnteredExternalReviews,
  readCanonicalReviewCorpus,
} from "@/lib/synopsis-interest/digest-corpus"
import { isUsefulReviewText } from "@/lib/reviews/useful-review"

const CSV = resolve(
  process.cwd(),
  ".local-experiments/plan3/digest-exp-1/pilot-2/review-coverage-audit/review-coverage-under-2.csv",
)

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
})

async function main(): Promise<void> {
  const frozen = parseCoverageUnder2Csv(readFileSync(CSV, "utf8"))

  const rows = await Promise.all(
    frozen.map(async (w) => {
      const [scraped, manual, corpus] = await Promise.all([
        readScrapedExternalReviews(w.workId, sb),
        readManuallyEnteredExternalReviews(w.workId, sb),
        readCanonicalReviewCorpus(w.workId, sb),
      ])
      const scrapedUseful = scraped.filter((r) => isUsefulReviewText(r.text)).length
      const manualUseful = manual.filter((r) => isUsefulReviewText(r.text)).length
      const sources = new Set<string>()
      for (const r of corpus.reviews) for (const p of r.provenance) sources.add(p.source)
      return {
        workId: w.workId,
        title: w.title,
        localRoute: `/catalog/${w.workId}`,
        scrapedUseful,
        manualUseful,
        usefulBeforeDedupe: scrapedUseful + manualUseful,
        usefulAfterDedupe: corpus.usefulReviewCount,
        distinctSources: sources.size,
        sources: [...sources].sort(),
        missingToTarget: Math.max(0, MIN_USEFUL_TARGET - corpus.usefulReviewCount),
        reviewCorpusSignature: corpus.reviewCorpusSignature,
      }
    }),
  )
  rows.sort((a, b) => a.usefulAfterDedupe - b.usefulAfterDedupe || a.title.localeCompare(b.title))

  const { count: manualRows } = await sb
    .from("work_external_reviews_manual")
    .select("*", { count: "exact", head: true })

  console.log(`\n=== Cobertura LIVE — 13 obras <2 úteis (meta=${MIN_USEFUL_TARGET}) · READ-ONLY ===`)
  for (const r of rows) {
    console.log(`• ${r.title}  [${r.workId}]`)
    console.log(`    rota: http://localhost:3001${r.localRoute}`)
    console.log(`    útil scraped=${r.scrapedUseful} · manual_external=${r.manualUseful} · antes-dedupe=${r.usefulBeforeDedupe} · após-dedupe=${r.usefulAfterDedupe} · faltam p/${MIN_USEFUL_TARGET}=${r.missingToTarget}`)
    console.log(`    fontes distintas=${r.distinctSources}: ${r.sources.join(", ") || "—"}`)
    console.log(`    reviewCorpusSignature: ${r.reviewCorpusSignature}`)
  }

  const r = evaluateLiveCoverage(rows)
  const b = HISTORICAL_COVERAGE_BASELINE
  const c = r.current

  console.log(`\n────────────────────────────────────────────────────────`)
  console.log(`baseline histórico (pré-migração/cadastro, congelado):`)
  console.log(`   0 úteis = ${b.zeroUseful} / 1 útil = ${b.oneUseful} / ≥2 úteis = ${b.twoPlus}  ·  faltantes = ${b.totalMissing}  ·  linhas manuais = ${b.manualRows}`)
  console.log(`estado ATUAL (progresso autorizado):`)
  console.log(`   0 úteis = ${c.zeroUseful} / 1 útil = ${c.oneUseful} / ≥2 úteis = ${c.twoPlus}  ·  faltantes = ${c.totalMissing}  ·  linhas manuais = ${manualRows ?? 0}`)
  console.log(`   (duplicatas canônicas: ${c.canonicalDups})`)

  console.log(`\nVEREDITO (invariantes reais — não confunde progresso com divergência):`)
  for (const inv of r.invariants) {
    console.log(`   ${inv.pass ? "✅" : "⛔"} ${inv.name}  [${inv.detail}]`)
  }
  console.log(`   ℹ️  work_manual_reviews NÃO é consultada (loaders canônicos só) — garantido por código/guard.`)

  if (r.ok) {
    console.log(`\n✅ Todas as invariantes OK — progresso autorizado, sem divergência real. [read-only, $0]`)
  } else {
    console.error(`\n⛔ INVARIANTE REAL violada — investigar (não é só progresso).`)
    process.exit(3)
  }
}

main().catch((e) => {
  console.error("[pilot2:coverage:live] erro:", e instanceof Error ? e.message : String(e))
  process.exit(1)
})

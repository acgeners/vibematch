/**
 * CLI híbrida do backfill orquestrado — Etapa 2A (taste profile + Potencial de
 * Interesse). Ver PLANO-BACKFILL-ORQUESTRADO.md §29.
 *
 * Casca FINA: toda a lógica vive em lib/orchestration/backfill/interest-backfill.
 * Comportamento PADRÃO = dry-run (read-only). A execução real exige --execute +
 * --plan-signature + --max-cost-usd (validados por Zod ANTES de qualquer chamada
 * paga). SIGINT/SIGTERM = cancelamento cooperativo (para de iniciar novos itens).
 *
 * Uso:
 *   npm run backfill:interest                              # dry-run
 *   npm run backfill:interest -- --execute \
 *     --plan-signature=<hash> --max-cost-usd=12 [--concurrency=3] [--retry-failed]
 *
 * (resolve para: npx tsx --tsconfig tsconfig.smoke.json --env-file=.env.local
 *  scripts/backfill-work-data.ts)
 */
import {
  planInterestBackfill,
  runInterestBackfill,
} from "@/lib/orchestration/backfill/interest-backfill"
import { parseBackfillCliArgs } from "@/lib/orchestration/backfill/cli-args"

// ---- Saída (sanitizada — nunca secrets/sinopse/perfil/prompt íntegros) ------

function printPlan(plan: Awaited<ReturnType<typeof planInterestBackfill>>) {
  console.log("\n=== DRY-RUN — Backfill de Potencial de Interesse ===")
  const scopeDesc = plan.scopeKind === "full" ? "catálogo completo" : plan.scopeKind === "limit" ? `limit=${plan.scopeLimit} (work_id ASC)` : `${plan.scopeWorkIds.length} ID(s) explícito(s)`
  console.log(`escopo: ${scopeDesc}`)
  if (plan.scopeKind !== "full") console.log(`  selecionadas: ${plan.scopeWorkIds.join(", ")}`)
  if (plan.requestedButMissing.length > 0) console.log(`  ✗ IDs inexistentes/arquivados: ${plan.requestedButMissing.join(", ")}`)
  console.log(`perfil: ${plan.profileState}  (ação: ${plan.profileAction}; versão funcional: ${plan.profileFunctionalVersion ?? "—"})`)
  console.log(`obras: total=${plan.totalWorks} elegíveis=${plan.eligible} | fresh=${plan.fresh} stale=${plan.stale} ausente=${plan.absent} bloqueadas=${plan.blocked}`)
  console.log(`jobs: processing=${plan.processing} failed=${plan.failed}`)
  console.log(`previsões planejadas: ${plan.itemsToPredict.length}  (recalc final: ${plan.recalcPlanned ? "sim" : "não"})`)
  console.log(`custo: likely=$${plan.estimatedLikelyUsd.toFixed(3)}  upperBound=$${plan.estimatedUpperBoundUsd.toFixed(3)}`)
  console.log(`maxCostUsd MÍNIMO necessário: $${plan.minMaxCostUsd.toFixed(3)}`)
  console.log(`versões: model=${plan.actionVersions.model} prompt=${plan.actionVersions.promptVersion} schema=${plan.actionVersions.schemaVersion} pricing=${plan.actionVersions.costVersion}`)
  for (const w of plan.warnings) console.log(`  ⚠ ${w}`)
  if (plan.abandonedJobs.length > 0) {
    console.log(`  ⚠ ${plan.abandonedJobs.length} job(s) possivelmente abandonados (queued/running antigos) — NÃO recuperados automaticamente.`)
  }
  console.log(`\nplanSignature: ${plan.planSignature}`)
  console.log(`\nPara executar:\n  npm run backfill:interest -- --execute --plan-signature=${plan.planSignature} --max-cost-usd=${plan.minMaxCostUsd.toFixed(2)}`)
}

function printReport(report: Awaited<ReturnType<typeof runInterestBackfill>>) {
  if (report.status !== "completed" && report.status !== "partial" && report.status !== "completed_with_failures") {
    console.log(`\n✗ ${report.status}: ${"message" in report ? report.message : ""}`)
    return
  }
  const r = report.report
  console.log(`\n=== ${report.status.toUpperCase()} ===`)
  console.log(`planned=${r.planned} started=${r.started} freshSkipped=${r.freshSkipped} succeeded=${r.succeeded} failed=${r.failed} processing=${r.processing} blocked=${r.blocked} changedDuringRun=${r.changedDuringRun}`)
  console.log(`stoppedByCost=${r.stoppedByCost} stoppedByPlanChange=${r.stoppedByPlanChange} stoppedByCancel=${r.stoppedByCancel}`)
  console.log(`profileUpdated=${r.profileUpdated} recalcExecuted=${r.recalcExecuted} recalcFailed=${r.recalcFailed}`)
  console.log(`custo: estimadoLikely=$${r.estimatedLikelyUsd.toFixed(3)} estimadoUpper=$${r.estimatedUpperBoundUsd.toFixed(3)} real=$${r.actualUsd.toFixed(4)}`)
  console.log(`duração: ${(r.durationMs / 1000).toFixed(1)}s`)
  if (r.lastSanitizedError) console.log(`último erro (sanitizado): ${r.lastSanitizedError}`)
  if (report.status === "completed_with_failures") {
    console.log(`\n⚠ Etapas PAGAS concluídas (perfil + previsões, sem custo extra), mas o recálculo`)
    console.log(`  global (GRATUITO) falhou. Estado parcial preservado. Retome SÓ o recálculo com:`)
    console.log(`    npm run recalc:scores`)
  }
}

// ---- Main ------------------------------------------------------------------

async function main() {
  const parsed = parseBackfillCliArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error("Erro de configuração:", parsed.error)
    process.exit(2)
  }
  const args = parsed.args
  const scope = parsed.scope

  if (!args.execute) {
    // DRY-RUN — read-only, sem jobs, sem LLM, sem alterar nada.
    const plan = await planInterestBackfill({ scope })
    printPlan(plan)
    return
  }

  // EXECUÇÃO — cancelamento cooperativo.
  let cancel = false
  const onSignal = (sig: string) => {
    if (cancel) return
    cancel = true
    console.log(`\n${sig} recebido — parando de iniciar novos itens; os em voo terminam.`)
  }
  process.on("SIGINT", () => onSignal("SIGINT"))
  process.on("SIGTERM", () => onSignal("SIGTERM"))

  const result = await runInterestBackfill({
    planSignature: args["plan-signature"]!,
    maxCostUsd: args["max-cost-usd"]!,
    scope,
    concurrency: args.concurrency,
    retryFailed: args["retry-failed"],
    shouldStop: () => cancel,
  })
  printReport(result)
  // Exit 0 SOMENTE no sucesso completo. Qualquer falha/parcial (inclusive recalc
  // de pós-processamento) ⇒ exit != 0.
  if (result.status !== "completed") {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})

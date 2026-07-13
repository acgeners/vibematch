/**
 * CLI de recálculo global GRATUITO headless-safe (Etapa 2B.2).
 *
 * Superfície mínima e SEGURA: reusa o contrato central `ensureRecalculateScores`
 * via `recalculateScoresHeadless` (recalculateAll no caminho "headless" — leituras
 * uncached, sem `revalidate*`). NÃO chama LLM, NÃO regenera perfil, NÃO prevê obras,
 * custo = US$ 0. Global/coalescido/`work_id=null`. Retoma o job `failed`/pendente
 * existente (mesma dedup key) e zera `recalc_pending` no sucesso.
 *
 * Uso: npm run recalc:scores
 *  - fresh (recalc_pending=false) ⇒ sai sem job/cálculo (exit 0);
 *  - pending/failed ⇒ retoma e recalcula uma vez (exit 0 no sucesso, !=0 na falha).
 */
import { getRecalcPendingState, recalculateScoresHeadless } from "@/server/recalc/queue"

async function main() {
  const before = await getRecalcPendingState()
  console.log(`estado atual: recalc_pending=${before.pending} · recalc_last_edit_at=${before.lastEditAt ?? "—"}`)

  if (!before.pending) {
    console.log("✓ Nada a fazer — scores já fresh (recalc_pending=false). Sem job, sem cálculo.")
    return
  }

  console.log("Retomando recálculo global (headless-safe, GRATUITO)…")
  const out = await recalculateScoresHeadless()

  switch (out.status) {
    case "succeeded": {
      const after = await getRecalcPendingState()
      console.log(`✓ recalc concluído: recalculated=${out.recalculated} · recalc_pending agora=${after.pending}`)
      if (after.pending) {
        console.error("⚠ recalc_pending continua true após sucesso — inesperado.")
        process.exit(1)
      }
      return
    }
    case "fresh":
      console.log("✓ Já estava fresh (corrida benigna).")
      return
    case "processing":
      console.log("• Recálculo já em andamento em outro processo — nada iniciado aqui.")
      return
    case "failed":
      console.error(`✗ recalc falhou (sanitizado): ${out.error}`)
      console.error("  recalc_pending preservado=true; job failed resumível. Rode novamente.")
      process.exit(1)
  }
}

main().catch((err) => {
  console.error("FATAL:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})

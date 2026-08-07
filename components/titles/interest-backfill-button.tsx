"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useRefresh } from "@/lib/use-refresh"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { planInterestBackfillForIds, runSynopsisInterestBatchAction } from "@/server/actions/synopsis-quality"
import { runTask, setTaskProgress } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { buildInterestBatchCost } from "@/lib/cost-preview/interest-cost-steps"
import type { SynopsisQueueWork } from "@/server/queries/recommendations"

/** Teto por chamada = SYNOPSIS_BATCH_MAX do servidor. O loop encadeia os lotes. */
const CHUNK = 100
const BACKFILL_TASK_ID = "interest-backfill"

/**
 * Backfill de Interesse Sinopse que RESPEITA os filtros aplicados: opera sobre as
 * obras atualmente EXIBIDAS na aba (já passaram por todos os filtros — status, estado,
 * mín. tags/reviews). Dry-run (remove as já frescas) → confirmação única → encadeia
 * lotes de 100 (reusa `runSynopsisInterestBatchAction`, pula fresco, resumível). Só
 * faz sentido com a flag de preferências ligada (senão a versão ativa é v3, quase
 * tudo já fresco ⇒ "nada a reprocessar").
 */
export function InterestBackfillButton({ works, isPaid = true }: { works: SynopsisQueueWork[]; isPaid?: boolean }) {
  const refresh = useRefresh()
  const confirmCost = useCostConfirm()
  // `planning` (dry-run + modal de custo) fica ANCORADO na página de propósito: é
  // uma decisão que exige a pessoa aqui. Só a execução vira tarefa global.
  const [planning, setPlanning] = useState(false)
  const tasks = useAppTasks()
  const running = planning || tasks.some((t) => t.id === BACKFILL_TASK_ID && t.status === "running")
  if (!isPaid) return null

  // Pendentes = não previstas OU desatualizadas na versão ativa (mesma regra do lote
  // do painel). É o que o backfill vai processar; fresco é pulado. Reflete os filtros.
  const pendingCount = works.filter((w) => w.predictedQuality == null || w.predictionStale).length

  /**
   * O loop de lotes é a parte DURÁVEL (cada chunk persiste antes do próximo), e
   * por isso vai pro indicador global. O `toast.loading` encadeado que existia
   * aqui contava "Lote 2/5" no canto — mas um toast é efêmero por convenção e
   * some numa navegação, justamente numa tarefa de minutos. Agora o mesmo
   * contador vira `progress` no store, e o card mostra barra determinada.
   */
  const runLoop = (targetIds: string[], capUsd: number) => {
    const chunks: string[][] = []
    for (let i = 0; i < targetIds.length; i += CHUNK) chunks.push(targetIds.slice(i, i + CHUNK))
    const total = targetIds.length

    runTask({
      id: BACKFILL_TASK_ID,
      kind: "interest-backfill",
      label: `Reprocessando Interesse: ${total} obra${total !== 1 ? "s" : ""}`,
      run: async () => {
        let spent = 0
        let succeeded = 0
        let fresh = 0
        let failed = 0
        let stoppedByCap = false
        setTaskProgress(BACKFILL_TASK_ID, 0, total)
        for (let i = 0; i < chunks.length; i += 1) {
          if (spent >= capUsd) {
            stoppedByCap = true
            break
          }
          const res = await runSynopsisInterestBatchAction(chunks[i], { maxCostUsd: capUsd - spent })
          if (res.status !== "ok") {
            const msg = "message" in res ? res.message : res.error
            throw new Error(`Lote ${i + 1} falhou: ${msg}. Re-rode pra continuar de onde parou.`)
          }
          succeeded += res.report.succeeded
          fresh += res.report.fresh
          failed += res.report.failed
          spent += res.report.costUsd
          setTaskProgress(BACKFILL_TASK_ID, Math.min((i + 1) * CHUNK, total), total)
        }
        return { succeeded, fresh, failed, spent, stoppedByCap }
      },
      // Refresh nos dois caminhos: um lote que parou no meio já gravou os chunks
      // anteriores, e a tela precisa mostrá-los.
      onDone: () => refresh(),
      onError: () => refresh(),
      successToast: (r) => ({
        message: r.stoppedByCap
          ? `Parou no teto de $${capUsd.toFixed(2)} · ${r.succeeded} estimada(s) · gasto $${r.spent.toFixed(2)}`
          : `Backfill concluído: ${r.succeeded} estimada(s) · ${r.fresh} já ok${r.failed ? ` · ${r.failed} falha(s)` : ""} · custo $${r.spent.toFixed(2)}`,
      }),
    })
  }

  const onClick = async () => {
    if (running) return
    setPlanning(true)
    const plan = await planInterestBackfillForIds(works.map((w) => w.id)).finally(() =>
      setPlanning(false),
    )
    if (plan.status !== "ok") {
      toast.error("message" in plan ? plan.message : plan.error)
      return
    }
    if (plan.needCalls === 0) {
      toast.success(
        `Nada a reprocessar — as ${plan.total} obras do filtro atual já estão frescas. (Flag ligada? Ajuste os filtros.)`,
      )
      return
    }
    const cap = Math.max(plan.upperBoundUsd, 0.01)
    // Itemiza perfil (custo ÚNICO) × previsões quando o perfil vai ser regenerado —
    // e deixa explícito na descrição que ele está defasado.
    const cost = buildInterestBatchCost({
      needCalls: plan.needCalls,
      regenProfile: plan.regenProfile,
      driftPct: plan.driftPct,
      profileLikelyUsd: plan.profileLikelyUsd,
      totalLikelyUsd: plan.likelyUsd,
    })
    const ok = await confirmCost({
      estimate: {
        likelyUsd: plan.likelyUsd,
        upperBoundUsd: plan.upperBoundUsd,
        etaSeconds: cost.etaSeconds,
        model: "claude-sonnet-4-6",
        background: false,
        scale: plan.needCalls,
      },
      steps: cost.steps,
      title: `Reprocessar Interesse — ${plan.needCalls} obra(s)?`,
      description: `${cost.profileSentence}Respeita os filtros: ${plan.needCalls} a prever (de ${plan.total} exibidas). Pula as já frescas.`,
      confirmLabel: "Reprocessar",
    })
    if (ok) runLoop(plan.targetIds, cap)
  }

  return (
    <Button
      variant="secondary"
      onClick={onClick}
      disabled={running || pendingCount === 0}
      title={pendingCount === 0 ? "Nenhuma obra pendente no filtro atual" : "Reprocessa as obras exibidas (respeita os filtros), pulando as já frescas"}
    >
      {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1 h-4 w-4" />}
      {running ? "Reprocessando…" : `Reprocessar Interesse${pendingCount ? ` (${pendingCount})` : ""}`}
    </Button>
  )
}

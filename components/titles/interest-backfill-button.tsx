"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useRefresh } from "@/lib/use-refresh"
import { planInterestBackfillForIds, runSynopsisInterestBatchAction } from "@/server/actions/synopsis-quality"
import type { SynopsisQueueWork } from "@/server/queries/recommendations"

/** Teto por chamada = SYNOPSIS_BATCH_MAX do servidor. O loop encadeia os lotes. */
const CHUNK = 100

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
  const [running, setRunning] = useState(false)
  if (!isPaid) return null

  // Pendentes = não previstas OU desatualizadas na versão ativa (mesma regra do lote
  // do painel). É o que o backfill vai processar; fresco é pulado. Reflete os filtros.
  const pendingCount = works.filter((w) => w.predictedQuality == null || w.predictionStale).length

  const runLoop = async (targetIds: string[], capUsd: number) => {
    setRunning(true)
    const tid = toast.loading("Reprocessando Interesse…")
    let spent = 0
    let succeeded = 0
    let fresh = 0
    let failed = 0
    try {
      const chunks: string[][] = []
      for (let i = 0; i < targetIds.length; i += CHUNK) chunks.push(targetIds.slice(i, i + CHUNK))
      for (let i = 0; i < chunks.length; i += 1) {
        if (spent >= capUsd) {
          toast.warning(`Teto de custo atingido ($${capUsd.toFixed(2)}). Parando.`)
          break
        }
        toast.loading(`Lote ${i + 1}/${chunks.length} · ${succeeded} feitas · $${spent.toFixed(2)}`, { id: tid })
        const res = await runSynopsisInterestBatchAction(chunks[i], { maxCostUsd: capUsd - spent })
        if (res.status !== "ok") {
          const msg = "message" in res ? res.message : res.error
          toast.error(`Lote ${i + 1} falhou: ${msg}. Parando (re-rode pra continuar).`, { id: tid })
          return
        }
        succeeded += res.report.succeeded
        fresh += res.report.fresh
        failed += res.report.failed
        spent += res.report.costUsd
      }
      toast.success(
        `Backfill concluído: ${succeeded} estimada(s) · ${fresh} já ok${failed ? ` · ${failed} falha(s)` : ""} · custo $${spent.toFixed(2)}`,
        { id: tid },
      )
    } catch (err) {
      toast.error(`Backfill interrompido: ${err instanceof Error ? err.message : "erro"} (re-rode pra continuar).`, { id: tid })
    } finally {
      setRunning(false)
      refresh()
    }
  }

  const onClick = async () => {
    if (running) return
    setRunning(true)
    try {
      const plan = await planInterestBackfillForIds(works.map((w) => w.id))
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
      const mins = Math.max(1, Math.round((plan.needCalls * 10) / 3 / 60))
      const cap = Math.max(plan.upperBoundUsd, 0.01)
      toast(
        `Backfill de Interesse (respeita os filtros): ${plan.needCalls} obra(s) a prever (de ${plan.total} exibidas). ` +
          `~$${plan.likelyUsd.toFixed(2)} provável / até $${plan.upperBoundUsd.toFixed(2)} · ~${mins} min.`,
        {
          duration: 20000,
          action: { label: "Reprocessar", onClick: () => void runLoop(plan.targetIds, cap) },
        },
      )
    } finally {
      setRunning(false)
    }
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

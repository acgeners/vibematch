"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"

import { useCostConfirm } from "@/components/cost/cost-confirm"
import { runTask, setTaskProgress } from "@/lib/tasks-store"
import { buildInterestBatchCost } from "@/lib/cost-preview/interest-cost-steps"
import { formatUsd } from "@/lib/format/money"
import { rerankWorksBatchAction } from "@/server/actions/recommendations"
import {
  planSynopsisInterestBatchAction,
  runSynopsisInterestBatchAction,
} from "@/server/actions/synopsis-quality"

/**
 * As DUAS ações de IA em lote que agem sobre uma seleção de obras — Veredito IA
 * e Prever Interesse — num lugar só.
 *
 * Elas nasceram dentro das filas de `/fila-recomendacao` (`stale-rerank-panel`,
 * `synopsis-predict-panel`) e agora também saem da seleção do /ranking. Cada
 * uma carrega detalhes que não sobrevivem a uma segunda cópia:
 *
 * 🔴 As server actions devolvem `{ error }` / `status !== "ok"` em vez de LANÇAR,
 * e o `runTask` só distingue falha por rejeição da promise. Sem o `throw`, o
 * indicador anuncia "pronto" para uma falha — plausível, errado, sem log.
 *
 * ⚠️ O Interesse exige o fluxo dry-run → popup de custo → execução, com o teto
 * (`upperBoundUsd`) governando o gasto. Pular o dry-run é autorizar em branco.
 *
 * Ambas vão pro indicador AZUL (durável): escrevem no banco enquanto rodam, e
 * são lentas — Veredito 14,0s de mediana por obra (p90 47,9s), Interesse 4,9s.
 * Num lote de 20 é mais de um minuto: prender a pessoa na tela seria mentira.
 */

/** O lote de Veredito vai em blocos — a action rankeia sob demanda e é cara por obra. */
const RERANK_CHUNK = 10

/** Um id por tipo: dois lotes do mesmo tipo nunca rodam juntos. */
export const RERANK_TASK_ID = "rerank-batch"
export const INTEREST_TASK_ID = "interest-batch"

export interface BatchAiActions {
  /** Veredito IA das obras — resolve quando o lote foi ENFILEIRADO, não quando termina. */
  rerank: (workIds: string[]) => void
  /** Prever Interesse: dry-run, popup de custo e só então executa. */
  predictInterest: (workIds: string[]) => Promise<void>
  /** True enquanto o dry-run do Interesse roda (antes do popup) — o clique precisa de eco. */
  planning: boolean
}

export function useBatchAiActions(opts: { onSettled?: () => void } = {}): BatchAiActions {
  const { onSettled } = opts
  // O diálogo em si vive no `CostConfirmProvider` do layout raiz — nada a renderizar aqui.
  const confirmCost = useCostConfirm()
  const [planning, setPlanning] = useState(false)

  const rerank = useCallback(
    (workIds: string[]) => {
      const targetIds = Array.from(new Set(workIds))
      const total = targetIds.length
      if (total === 0) return
      runTask({
        id: RERANK_TASK_ID,
        kind: "rerank-batch",
        label: `Veredito IA: ${total} obra${total !== 1 ? "s" : ""}`,
        run: async () => {
          let ranked = 0
          let failed = 0
          setTaskProgress(RERANK_TASK_ID, 0, total)
          for (let i = 0; i < targetIds.length; i += RERANK_CHUNK) {
            const chunk = targetIds.slice(i, i + RERANK_CHUNK)
            const result = await rerankWorksBatchAction(chunk)
            if (result.error || !result.data) throw new Error(result.error ?? "Erro ao re-rankear.")
            ranked += result.data.ranked
            failed += result.data.failed
            setTaskProgress(RERANK_TASK_ID, Math.min(i + RERANK_CHUNK, total), total)
          }
          return { ranked, failed }
        },
        // Refresh nos DOIS caminhos: um lote que abortou no meio já persistiu os
        // blocos anteriores, e a tela precisa mostrá-los.
        onDone: () => onSettled?.(),
        onError: () => onSettled?.(),
        successToast: ({ ranked, failed }) => ({
          message:
            `${ranked} re-rankeada${ranked !== 1 ? "s" : ""}` +
            (failed > 0 ? ` · ${failed} falhou` : "."),
        }),
      })
    },
    [onSettled],
  )

  const executeInterest = useCallback(
    (batchIds: string[], maxCostUsd: number) => {
      runTask({
        id: INTEREST_TASK_ID,
        kind: "interest-batch",
        label: `Estimando Interesse: ${batchIds.length} obra${batchIds.length !== 1 ? "s" : ""}`,
        run: async () => {
          const res = await runSynopsisInterestBatchAction(batchIds, { maxCostUsd })
          // Os três status de não-sucesso viram rejeição: sem isso o store diria
          // "pronto" pra um lote bloqueado por custo.
          if (res.status !== "ok") {
            throw new Error("message" in res ? res.message : res.error)
          }
          return res.report
        },
        onDone: () => onSettled?.(),
        onError: () => onSettled?.(),
        successToast: (r) => ({
          message:
            `${r.succeeded} estimada${r.succeeded !== 1 ? "s" : ""} · ${r.fresh} já ok` +
            (r.failed > 0 ? ` · ${r.failed} falhou` : "") +
            (r.blocked > 0 ? ` · ${r.blocked} bloqueada(s)` : "") +
            ` · custo ${formatUsd(r.costUsd)}`,
        }),
      })
    },
    [onSettled],
  )

  const predictInterest = useCallback(
    async (workIds: string[]) => {
      const batchIds = Array.from(new Set(workIds))
      if (batchIds.length === 0) return
      setPlanning(true)
      const planned = await planSynopsisInterestBatchAction(batchIds).finally(() =>
        setPlanning(false),
      )
      if (planned.status !== "ok") {
        toast.error("message" in planned ? planned.message : planned.error)
        return
      }
      const p = planned.plan
      const needCalls = p.stale + p.absent
      if (needCalls === 0) {
        toast.success("As obras selecionadas já estão atualizadas — nada a estimar.")
        return
      }
      // Itemiza perfil (custo ÚNICO) × previsões quando o perfil vai ser regenerado —
      // deixando explícito que ele está defasado — em vez de amortizar em "N × por-obra".
      const cost = buildInterestBatchCost({
        needCalls,
        regenProfile: planned.regenProfile,
        driftPct: planned.driftPct,
        profileLikelyUsd: p.profileLikelyUsd,
        totalLikelyUsd: p.likelyUsd,
      })
      const maxCostUsd = Math.max(p.upperBoundUsd, 0.01)
      const ok = await confirmCost({
        estimate: {
          likelyUsd: p.likelyUsd,
          upperBoundUsd: p.upperBoundUsd,
          etaSeconds: cost.etaSeconds,
          model: "claude-sonnet-4-6",
          background: false,
          scale: needCalls,
        },
        steps: cost.steps,
        title: `Prever Interesse — ${needCalls} obra(s)?`,
        description: `${cost.profileSentence}Dry-run real: ${needCalls} previsão(ões), uma chamada Sonnet por obra.`,
        confirmLabel: "Executar",
      })
      if (ok) executeInterest(batchIds, maxCostUsd)
    },
    [confirmCost, executeInterest],
  )

  return { rerank, predictInterest, planning }
}

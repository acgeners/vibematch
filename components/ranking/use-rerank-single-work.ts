"use client"

import { useRefresh } from "@/lib/use-refresh"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import { rerankSingleWorkAction } from "@/server/actions/recommendations"

/**
 * Re-rank por IA ("Veredito IA") de UMA obra.
 *
 * Vive num arquivo próprio porque a mesma lógica estava escrita TRÊS vezes —
 * `ranking-cells`, `rerank-ai-rk-button` e um `onClick` solto no menu da
 * `work-table` (esse sem estado de pendência nenhum: o menu fechava e a espera
 * de ~14s acontecia sem sinal algum).
 *
 * Vai pelo `runTask` porque a ação é DURÁVEL: persiste `alignment_score` em
 * `calculated_scores`. A chamada de ranking mede 14,0s de mediana e 47,9s de p90
 * (n=138 em `ai_api_calls`) — tempo mais que suficiente pra pessoa navegar, e é
 * exatamente aí que o spinner-no-botão sumia levando o feedback junto.
 */
export function useRerankSingleWork(workId: string, workTitle?: string) {
  const refresh = useRefresh()
  const confirmCost = useCostConfirm()
  const tasks = useAppTasks()

  const taskId = `rerank:${workId}`
  // A pendência sai do STORE, não de um `useTransition` local: assim os três
  // pontos de entrada da mesma obra concordam entre si, e o botão continua
  // "ocupado" pra quem volta pra página no meio da execução.
  const isPending = tasks.some((t) => t.id === taskId && t.status === "running")

  const run = async () => {
    if (!(await confirmCost({ action: "rerank_single" }))) return
    runTask({
      id: taskId,
      kind: "rerank",
      label: workTitle ? `Veredito IA: ${workTitle}` : "Calculando Veredito IA",
      run: async () => {
        const result = await rerankSingleWorkAction(workId)
        // A action devolve `{ error }` em vez de lançar. Sem converter, o store
        // marcaria a falha como sucesso e mostraria "pronto" pra um erro.
        if (result.error || !result.data) throw new Error(result.error ?? "Erro ao rankear obra.")
        return result.data
      },
      onDone: () => refresh(),
      successToast: (data) => ({ message: `Veredito IA: ${Math.round(data.alignmentScore)}` }),
    })
  }

  return { isPending, run }
}

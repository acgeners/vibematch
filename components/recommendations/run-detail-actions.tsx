"use client"

import { useRouter } from "next/navigation"
import { useRefresh } from "@/lib/use-refresh"
import { Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { rerunRecommendationFromExistingAction } from "@/server/actions/recommendations"

interface RunDetailActionsProps {
  runId: string
}

const TASK_ID = "rerun-recommendation"

/**
 * "Rodar novamente" com o mesmo contexto da run aberta.
 *
 * Vai pelo `runTask` (e não por um `useTransition` local) porque é DURÁVEL: cria
 * uma `recommendation_runs` nova, que continua existindo mesmo se a pessoa sair
 * da página. A chamada de ranking mede 14,0s de mediana e 47,9s de p90 — muito
 * tempo pra prender alguém numa tela olhando um spinner. Mesmo desenho do
 * `recommend-dialog`: navega no `onDone` se ainda estiver aqui, e o toast com
 * "Ver" cobre quem já saiu.
 */
export function RunDetailActions({ runId }: RunDetailActionsProps) {
  const router = useRouter()
  const refresh = useRefresh()
  const tasks = useAppTasks()
  const rerunning = tasks.some((t) => t.id === TASK_ID && t.status === "running")

  const handleRerun = () => {
    runTask({
      id: TASK_ID,
      kind: "recommend",
      label: "Rodando recomendação de novo",
      run: async () => {
        const res = await rerunRecommendationFromExistingAction(runId)
        // A action devolve `{ error }` em vez de lançar; sem converter, o store
        // marcaria a falha como sucesso.
        if (res.error || !res.data) throw new Error(res.error ?? "Erro ao rodar novamente.")
        return res.data
      },
      successToast: (data) => ({
        message: "Recomendação pronta",
        action: { label: "Ver", href: `/recommendations/${data.runSlug}` },
      }),
      onDone: (data) => {
        router.push(`/recommendations/${data.runSlug}`)
        refresh()
      },
      // Sem `onError` com toast: o `runTask` já emite `toast.error` na rejeição.
      // Um segundo aqui mostraria a mesma falha duas vezes — e a caixa vermelha
      // inline que existia antes só apareceria pra quem não saiu da página, que
      // justamente deixou de ser o caso esperado.
    })
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <Button size="sm" onClick={handleRerun} disabled={rerunning} className="w-full px-4 sm:w-auto">
        {rerunning ? (
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
        ) : (
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
        )}
        Rodar novamente
      </Button>
      <span className="select-none text-[10px] font-semibold tracking-wide text-muted-foreground/75">
        com mesmo contexto
      </span>
    </div>
  )
}

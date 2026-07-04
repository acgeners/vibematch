"use client"

import type { ReactNode } from "react"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useRefresh } from "@/lib/use-refresh"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { useCostConfirm } from "@/components/cost/cost-confirm"
import type { CostConfirmRequest } from "@/components/cost/cost-confirm"

/**
 * Botão genérico que dispara uma ação durável via `runTask` (store global →
 * sobrevive à navegação, aparece no indicador de tarefas). Usado nas abas
 * "Sem reviews"/"Sem tags" pra rodar digest/inferência individual ou em fila.
 */
export function TaskButton({
  taskId,
  kind,
  label,
  busyLabel,
  run,
  formatDone,
  variant = "outline",
  size = "sm",
  icon,
  className,
  disabled,
  cost,
}: {
  taskId: string
  kind: string
  label: string
  busyLabel: string
  run: () => Promise<unknown>
  /** Formata o toast de conclusão a partir do resultado da ação. */
  formatDone: (result: unknown) => { message: string; ok: boolean }
  variant?: "default" | "outline" | "secondary" | "ghost"
  size?: "sm" | "default"
  /** Ícone à esquerda do rótulo (trocado por spinner enquanto ocupado). */
  icon?: ReactNode
  className?: string
  disabled?: boolean
  /** Quando presente, exibe o popup de custo (bloqueante) antes de rodar. */
  cost?: CostConfirmRequest
}) {
  const tasks = useAppTasks()
  const refresh = useRefresh()
  const confirmCost = useCostConfirm()
  const busy = tasks.some((t) => t.id === taskId && t.status === "running")

  const start = () =>
    runTask({
      id: taskId,
      kind,
      label,
      run,
      successToast: () => null, // mensagem específica vai no onDone
      onDone: (result) => {
        const { message, ok } = formatDone(result)
        if (ok) toast.success(message)
        else toast.error(message)
        refresh()
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Erro na tarefa."),
    })

  const handleClick = async () => {
    if (cost && !(await confirmCost(cost))) return
    start()
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={busy || disabled}
      className={cn("gap-1.5", className)}
      onClick={() => void handleClick()}
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {busy ? busyLabel : label}
    </Button>
  )
}

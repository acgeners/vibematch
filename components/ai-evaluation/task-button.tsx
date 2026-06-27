"use client"

import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useRefresh } from "@/lib/use-refresh"
import { runTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"

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
  className,
  disabled,
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
  className?: string
  disabled?: boolean
}) {
  const tasks = useAppTasks()
  const refresh = useRefresh()
  const busy = tasks.some((t) => t.id === taskId && t.status === "running")

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={busy || disabled}
      className={className}
      onClick={() =>
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
      }
    >
      {busy ? busyLabel : label}
    </Button>
  )
}

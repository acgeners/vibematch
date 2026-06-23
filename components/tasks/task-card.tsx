"use client"

import Link from "next/link"
import { AlertTriangle, CheckCircle2, Cloud, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { dismissTask, type AppTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"

/**
 * Card de "tarefas em segundo plano". Prominente e moderno de propósito (não é
 * um indicador discreto): accent azul = DURÁVEL ("roda no servidor, pode
 * navegar"), barra de progresso indeterminada animada por tarefa, e o estado de
 * cada uma (rodando / pronto / erro) bem visível. Reusado na sidebar (desktop) e
 * no FAB (mobile).
 */
export function TaskCard() {
  const tasks = useAppTasks()
  if (tasks.length === 0) return null

  const running = tasks.filter((t) => t.status === "running").length
  const errored = tasks.some((t) => t.status === "error")

  const title = running > 0 ? `Em andamento (${running})` : errored ? "Concluído com avisos" : "Concluído"
  const subtitle =
    running > 0 ? "Pode navegar — te aviso ao terminar" : errored ? "Veja os detalhes abaixo" : "Tudo certo ✓"

  return (
    <div className="overflow-hidden rounded-xl border border-sky-400/30 bg-gradient-to-br from-sky-500/20 via-sky-500/8 to-transparent shadow-lg shadow-sky-950/20 backdrop-blur-sm">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="relative grid size-8 shrink-0 place-items-center rounded-lg bg-sky-500/25 text-sky-300">
          {running > 0 ? <Loader2 className="size-4 animate-spin" /> : <Cloud className="size-4" />}
          {running > 0 && (
            <span className="absolute inset-0 rounded-lg ring-2 ring-sky-400/40 motion-safe:animate-ping" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-sky-50">{title}</p>
          <p className="text-[10px] leading-tight text-sky-200/70">{subtitle}</p>
        </div>
      </div>

      <ul className="space-y-2 border-t border-sky-400/15 px-3 py-2.5">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </ul>
    </div>
  )
}

function TaskRow({ task }: { task: AppTask }) {
  const running = task.status === "running"
  const Icon = running ? Loader2 : task.status === "done" ? CheckCircle2 : AlertTriangle
  const tone =
    task.status === "error" ? "text-rose-400" : task.status === "done" ? "text-emerald-400" : "text-sky-300"

  return (
    <li>
      <div className="flex items-center gap-2">
        <Icon className={cn("size-3.5 shrink-0", tone, running && "animate-spin")} />
        {task.href ? (
          <Link
            href={task.href}
            className="min-w-0 flex-1 truncate text-xs font-medium text-sky-50 hover:underline"
            title={task.label}
          >
            {task.label}
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-sky-50" title={task.label}>
            {task.label}
          </span>
        )}
        {!running && (
          <button
            type="button"
            onClick={() => dismissTask(task.id)}
            className="shrink-0 rounded p-0.5 text-sky-200/60 transition-colors hover:bg-sky-400/15 hover:text-sky-50"
            aria-label="Dispensar"
            title="Dispensar"
          >
            <X className="size-3" />
          </button>
        )}
      </div>

      {running && (
        <div className="relative mt-1.5 h-1 overflow-hidden rounded-full bg-sky-400/15">
          <span className="task-indeterminate-bar bg-sky-400" />
        </div>
      )}

      {task.status === "error" && task.error && (
        <p className="mt-1 truncate text-[10px] text-rose-300/80" title={task.error}>
          {task.error}
        </p>
      )}
    </li>
  )
}

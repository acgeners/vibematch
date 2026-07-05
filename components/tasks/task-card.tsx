"use client"

import Link from "next/link"
import { AlertTriangle, CheckCircle2, Cloud, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { dismissTask, type AppTask } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"

/**
 * Card de "tarefas em segundo plano". Prominente e durável de propósito (accent
 * azul = "roda no servidor, pode navegar"). Uma ÚNICA fonte de movimento — a
 * barra indeterminada — em vez de spinners empilhados: o cabeçalho é uma
 * identidade (☁), não um spinner, e cada linha usa um ponto pulsante + a barra.
 * Com 1 tarefa colapsa numa linha só (sem resumo separado, evitando o
 * empilhamento); com 2+ mostra o resumo + a lista. Reusado na sidebar (desktop)
 * e no FAB (mobile).
 */
export function TaskCard() {
  const tasks = useAppTasks()
  if (tasks.length === 0) return null

  // 1 tarefa: linha única — o caso comum, onde os dois spinners empilhados mais
  // incomodavam. Cabeçalho e linha viram a mesma coisa.
  if (tasks.length === 1) {
    return (
      <div className={SHELL}>
        <TaskRow task={tasks[0]} solo />
      </div>
    )
  }

  const running = tasks.filter((t) => t.status === "running").length
  const errored = tasks.some((t) => t.status === "error")

  const title = running > 0 ? `Em andamento (${running})` : errored ? "Concluído com avisos" : "Concluído"
  const subtitle =
    running > 0 ? "Pode navegar — te aviso ao terminar" : errored ? "Veja os detalhes abaixo" : "Tudo certo ✓"
  const HeadIcon = running > 0 ? Cloud : errored ? AlertTriangle : CheckCircle2

  return (
    <div className={SHELL}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", badgeTone(running > 0 ? "running" : errored ? "error" : "done"))}>
          <HeadIcon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold text-sky-50">{title}</p>
          <p className="text-[10px] leading-tight text-sky-200/70">{subtitle}</p>
        </div>
      </div>

      <ul className="space-y-2.5 border-t border-sky-400/15 px-3 py-2.5">
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} />
        ))}
      </ul>
    </div>
  )
}

const SHELL =
  "overflow-hidden rounded-xl border border-sky-400/30 bg-gradient-to-br from-sky-500/20 via-sky-500/8 to-transparent shadow-lg shadow-sky-950/20 backdrop-blur-sm"

function badgeTone(status: AppTask["status"]) {
  if (status === "error") return "bg-rose-500/20 text-rose-300"
  if (status === "done") return "bg-emerald-500/20 text-emerald-300"
  return "bg-sky-500/25 text-sky-300"
}

/**
 * Uma tarefa. `solo` colapsa cabeçalho + linha num só bloco (☁ badge + rótulo +
 * legenda "pode navegar" + barra). Sem `solo`, é um item da lista.
 */
function TaskRow({ task, solo = false }: { task: AppTask; solo?: boolean }) {
  const running = task.status === "running"

  const label = task.href ? (
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
  )

  const dismiss = !running && (
    <button
      type="button"
      onClick={() => dismissTask(task.id)}
      className="shrink-0 rounded p-0.5 text-sky-200/60 transition-colors hover:bg-sky-400/15 hover:text-sky-50"
      aria-label="Dispensar"
      title="Dispensar"
    >
      <X className="size-3" />
    </button>
  )

  const bar = running && (
    <div className="relative mt-1.5 h-1 overflow-hidden rounded-full bg-sky-400/15">
      <span className="task-indeterminate-bar bg-sky-400" />
    </div>
  )

  const error = task.status === "error" && task.error && (
    <p className="mt-1 truncate text-[10px] text-rose-300/80" title={task.error}>
      {task.error}
    </p>
  )

  // Linha única (1 tarefa): badge de identidade + rótulo + legenda + barra.
  if (solo) {
    const HeadIcon = running ? Cloud : task.status === "done" ? CheckCircle2 : AlertTriangle
    return (
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", badgeTone(task.status))}>
          <HeadIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {label}
            {dismiss}
          </div>
          {running && (
            <p className="mt-0.5 text-[10px] leading-tight text-sky-200/70">Pode navegar — te aviso ao terminar</p>
          )}
          {bar}
          {error}
        </div>
      </div>
    )
  }

  // Item da lista (2+ tarefas): ponto de status + rótulo + barra.
  return (
    <li>
      <div className="flex items-center gap-2">
        <StatusDot status={task.status} />
        {label}
        {dismiss}
      </div>
      {bar}
      {error}
    </li>
  )
}

/** Ponto de status: pulsa enquanto roda (via animate-ping); estático quando termina. */
function StatusDot({ status }: { status: AppTask["status"] }) {
  const tone = status === "error" ? "bg-rose-400" : status === "done" ? "bg-emerald-400" : "bg-sky-300"
  return (
    <span className="relative flex size-2 shrink-0 items-center justify-center">
      {status === "running" && (
        <span className="absolute inline-flex size-full rounded-full bg-sky-400/60 motion-safe:animate-ping" />
      )}
      <span className={cn("relative inline-flex size-2 rounded-full", tone)} />
    </span>
  )
}

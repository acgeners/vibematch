"use client"

import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { TaskCard } from "@/components/tasks/task-card"

/** Tarefas em segundo plano na sidebar (desktop). Card prominente, azul = durável. */
export function SidebarTasks() {
  const tasks = useAppTasks()
  if (tasks.length === 0) return null

  return (
    <div className="border-t border-sidebar-border/60 px-3 py-3">
      <TaskCard />
    </div>
  )
}

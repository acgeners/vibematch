"use client"

import { useAppTasks } from "@/components/tasks/use-app-tasks"
import { TaskCard } from "@/components/tasks/task-card"

/**
 * Card flutuante de tarefas em segundo plano no MOBILE (a sidebar não aparece
 * lá). Acima da barra de navegação inferior, ocupando a largura pra ser bem
 * visível (não discreto).
 */
export function TasksFab() {
  const tasks = useAppTasks()
  if (tasks.length === 0) return null

  return (
    <div className="fixed inset-x-3 bottom-24 z-50 md:hidden">
      <TaskCard />
    </div>
  )
}

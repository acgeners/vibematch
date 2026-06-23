"use client"

import { useSyncExternalStore } from "react"
import { readTasks, readTasksServer, subscribeTasks } from "@/lib/tasks-store"

/** Lê a lista de tarefas em andamento do store global (sobrevive à navegação). */
export function useAppTasks() {
  return useSyncExternalStore(subscribeTasks, readTasks, readTasksServer)
}

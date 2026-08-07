// Store global de "tarefas em andamento" (avaliação IA, recomendação, etc.).
//
// Vive em nível de MÓDULO (não em estado de componente), então sobrevive à
// navegação client-side: `runTask` DONA a promise da ação, e os callbacks de
// conclusão (toast + refresh do chrome) rodam aqui mesmo que a página que
// disparou a ação já tenha desmontado. Mesmo padrão de external-store do
// `active-chat` (evento custom + snapshot cacheado pra useSyncExternalStore).
//
// Só tarefas DURÁVEIS entram aqui (resultado persiste no banco enquanto rodam).
// Ações request-scoped (cujo resultado vive na tela) NÃO usam este store — elas
// não sobreviveriam à navegação, então ficam ancoradas à página.

import { toast } from "sonner"
import { refreshChrome, type ChromePatch } from "@/lib/chrome-refresh"

export type TaskStatus = "running" | "done" | "error"

export interface AppTask {
  /** Chave de dedupe (ex.: `ai-eval:<workId>`). Re-disparar com mesmo id enquanto roda é no-op. */
  id: string
  kind: string
  /** Rótulo curto exibido no indicador (ex.: "Avaliando: Born to Be the Grand Duchess"). */
  label: string
  status: TaskStatus
  /** Deep-link pro resultado (review/queue) — vira link no indicador e no toast. */
  href?: string
  startedAt: number
  /** Mensagem curta quando status === "error". */
  error?: string
  /**
   * Andamento de tarefa em LOTE (ex.: re-rank de 12 obras). Quando presente, o
   * indicador troca a barra indeterminada por uma determinada + "3/12".
   *
   * Existe porque o contador dessas ações vivia em estado de componente: quem
   * navegava perdia justamente a informação que importa numa tarefa que dura
   * minutos — quanto falta. O `runTask` não sabe contar sozinho; quem itera
   * chama `setTaskProgress` a cada item.
   */
  progress?: { done: number; total: number }
}

export interface RunTaskSpec<T> {
  id: string
  kind: string
  label: string
  href?: string
  /** A ação demorada. O store dona esta promise (sobrevive à navegação). */
  run: () => Promise<T>
  /** Chamado com o resultado ao concluir. Pode rodar com o caller já desmontado
   *  (setState vira no-op seguro) — não dependa de DOM aqui. */
  onDone?: (result: T) => void
  onError?: (err: unknown) => void
  /** Toast de conclusão. Retorne null pra suprimir (ex.: a ação resolveu num
   *  "gate" que não é sucesso real). Default: toast genérico de pronto. */
  successToast?: (result: T) => { message: string; action?: { label: string; href: string } } | null
  /** Patch otimista do chrome ao concluir (ex.: `{ badgeDelta: { aiEval: 1 } }`).
   *  Sem isto, faz um re-fetch genérico do chrome. */
  chromePatchOnDone?: ChromePatch
  /** ms até auto-remover do indicador após concluir/errar. Default 6000/8000. */
  dismissAfterMs?: number
}

let tasks: AppTask[] = []
const listeners = new Set<() => void>()
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>()

function emit() {
  // Nova referência do array pra useSyncExternalStore detectar a mudança. Entre
  // emits a referência é estável (snapshot seguro).
  tasks = tasks.slice()
  for (const l of listeners) l()
}

export function subscribeTasks(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

export function readTasks(): AppTask[] {
  return tasks
}

/** Snapshot estável pro SSR (sempre vazio no servidor). */
export function readTasksServer(): AppTask[] {
  return EMPTY
}
const EMPTY: AppTask[] = []

function setTask(next: AppTask) {
  const i = tasks.findIndex((t) => t.id === next.id)
  if (i >= 0) tasks[i] = next
  else tasks.push(next)
  emit()
}

/**
 * Atualiza o andamento de uma tarefa em lote. No-op se a tarefa já saiu do store
 * ou não está mais rodando — o caller itera num laço que pode terminar depois de
 * o usuário dispensar, e um `setTask` aqui a ressuscitaria.
 */
export function setTaskProgress(id: string, done: number, total: number) {
  const task = tasks.find((t) => t.id === id)
  if (!task || task.status !== "running") return
  setTask({ ...task, progress: { done, total } })
}

export function dismissTask(id: string) {
  const timer = dismissTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    dismissTimers.delete(id)
  }
  tasks = tasks.filter((t) => t.id !== id)
  emit()
}

function scheduleDismiss(id: string, ms: number) {
  const existing = dismissTimers.get(id)
  if (existing) clearTimeout(existing)
  dismissTimers.set(
    id,
    setTimeout(() => {
      dismissTimers.delete(id)
      tasks = tasks.filter((t) => t.id !== id)
      emit()
    }, ms),
  )
}

export function runTask<T>(spec: RunTaskSpec<T>): void {
  if (typeof window === "undefined") return
  // Dedupe: já há uma tarefa com este id rodando → ignora o re-disparo.
  if (tasks.some((t) => t.id === spec.id && t.status === "running")) return
  // Re-disparo com mesmo id (ex.: confirmar "avaliar mesmo assim" após o gate):
  // cancela o auto-dismiss pendente da tentativa anterior, senão ele removeria
  // esta nova tarefa.
  const pendingDismiss = dismissTimers.get(spec.id)
  if (pendingDismiss) {
    clearTimeout(pendingDismiss)
    dismissTimers.delete(spec.id)
  }

  const base: AppTask = {
    id: spec.id,
    kind: spec.kind,
    label: spec.label,
    href: spec.href,
    status: "running",
    startedAt: Date.now(),
  }
  setTask(base)

  spec.run().then(
    (result) => {
      setTask({ ...base, status: "done" })
      try {
        spec.onDone?.(result)
      } catch {
        // callback do caller não deve derrubar o store
      }
      const toastSpec = spec.successToast ? spec.successToast(result) : { message: `${spec.label}: pronto` }
      if (toastSpec) {
        if (toastSpec.action) {
          const href = toastSpec.action.href
          toast.success(toastSpec.message, {
            action: { label: toastSpec.action.label, onClick: () => window.location.assign(href) },
          })
        } else {
          toast.success(toastSpec.message)
        }
      }
      refreshChrome(spec.chromePatchOnDone)
      scheduleDismiss(spec.id, spec.dismissAfterMs ?? 6000)
    },
    (err) => {
      const message = err instanceof Error ? err.message : String(err)
      setTask({ ...base, status: "error", error: message })
      try {
        spec.onError?.(err)
      } catch {
        // idem
      }
      toast.error(`${spec.label}: ${message}`)
      scheduleDismiss(spec.id, spec.dismissAfterMs ?? 8000)
    },
  )
}

"use client"

import { useCallback, useMemo, useOptimistic, useTransition } from "react"
import { toast } from "sonner"
import { useRefresh } from "@/lib/use-refresh"
import { markAiEvalWorksRead, unmarkAiEvalWork } from "@/server/actions/ai-eval-read"

import type { ReadQueue } from "@/server/queries/ai-eval-read"

type ReadDelta = { op: "add" | "remove"; ids: string[] }

/**
 * Helper das filas de /curation/works e /my-ai-scores pra marcar/desmarcar obras
 * como lidas. `readIds` chega como array (props RSC não serializam Set).
 *
 * Feedback OTIMISTA no SELO: muda na hora (`useOptimistic`) sem esperar o round-trip;
 * a server action + refresh reconciliam em segundo plano (revertendo se falharem).
 * O BADGE, porém, NÃO leva delta otimista: ele é a UNIÃO DISTINTA de attr+veredito+
 * interesse, e uma obra que vive em duas filas faria o `+1` contar em dobro (over-count
 * que só se corrigia no refetch de 30s). refresh() puro re-busca a união REAL — como o
 * selo já mudou, a responsividade percebida não muda.
 */
export function useToggleRead(queue: ReadQueue, readIds: string[]) {
  const refresh = useRefresh()
  const baseReadSet = useMemo(() => new Set(readIds), [readIds])
  const [optimisticRead, applyOptimistic] = useOptimistic(baseReadSet, (set: Set<string>, delta: ReadDelta) => {
    const next = new Set(set)
    for (const id of delta.ids) {
      if (delta.op === "add") next.add(id)
      else next.delete(id)
    }
    return next
  })
  const [, startTransition] = useTransition()

  const isRead = useCallback((workId: string) => optimisticRead.has(workId), [optimisticRead])

  const unmark = useCallback(
    (workId: string) => {
      startTransition(async () => {
        applyOptimistic({ op: "remove", ids: [workId] }) // some o selo instantaneamente
        try {
          await unmarkAiEvalWork(workId, queue)
          refresh()
        } catch (err) {
          // useOptimistic reverte sozinho ao fim da transição (readIds não mudou).
          toast.error(err instanceof Error ? err.message : "Falha ao desmarcar como lida.")
        }
      })
    },
    [queue, refresh, applyOptimistic],
  )

  /** Marca obras como lidas (o "Pular" pessoal). Resolve `true` se gravou. */
  const mark = useCallback(
    (workIds: string[]) =>
      new Promise<boolean>((resolve) => {
        if (workIds.length === 0) return resolve(false)
        startTransition(async () => {
          applyOptimistic({ op: "add", ids: workIds })
          try {
            const res = await markAiEvalWorksRead(workIds, queue)
            if (!res.ok) {
              toast.error("Entre na sua conta para pular obras.")
              return resolve(false)
            }
            refresh()
            resolve(true)
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Falha ao pular.")
            resolve(false)
          }
        })
      }),
    [queue, refresh, applyOptimistic],
  )

  return { isRead, unmark, mark }
}

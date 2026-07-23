"use client"

import { useCallback, useMemo, useOptimistic, useTransition } from "react"
import { toast } from "sonner"
import { useRefresh } from "@/lib/use-refresh"
import { unmarkAiEvalWork } from "@/server/actions/ai-eval-read"

import type { ReadQueue } from "@/server/queries/ai-eval-read"

/**
 * Helper das filas de /ai-evaluation pra desmarcar UMA obra como lida (clicar no
 * selo "Lida" do card). `readIds` chega como array (props RSC não serializam Set).
 *
 * Feedback OTIMISTA no SELO: some na hora (`useOptimistic`) sem esperar o round-trip;
 * a server action + refresh reconciliam em segundo plano (revertendo se falharem).
 * O BADGE, porém, NÃO leva delta otimista: ele é a UNIÃO DISTINTA de attr+veredito+
 * interesse, e uma obra que vive em duas filas faria o `+1` contar em dobro (over-count
 * que só se corrigia no refetch de 30s). refresh() puro re-busca a união REAL — como o
 * selo já sumiu, a responsividade percebida não muda.
 */
export function useToggleRead(queue: ReadQueue, readIds: string[]) {
  const refresh = useRefresh()
  const baseReadSet = useMemo(() => new Set(readIds), [readIds])
  const [optimisticRead, dropOptimistic] = useOptimistic(
    baseReadSet,
    (set: Set<string>, unmarkedId: string) => {
      const next = new Set(set)
      next.delete(unmarkedId)
      return next
    },
  )
  const [, startTransition] = useTransition()

  const isRead = useCallback((workId: string) => optimisticRead.has(workId), [optimisticRead])

  const unmark = useCallback(
    (workId: string) => {
      startTransition(async () => {
        dropOptimistic(workId) // some o selo instantaneamente
        try {
          await unmarkAiEvalWork(workId, queue)
          refresh()
        } catch (err) {
          // useOptimistic reverte sozinho ao fim da transição (readIds não mudou).
          toast.error(err instanceof Error ? err.message : "Falha ao desmarcar como lida.")
        }
      })
    },
    [queue, refresh, dropOptimistic],
  )

  return { isRead, unmark }
}

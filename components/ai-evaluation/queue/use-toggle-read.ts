"use client"

import { useCallback, useMemo, useOptimistic, useTransition } from "react"
import { toast } from "sonner"
import { useRefresh } from "@/lib/use-refresh"
import { unmarkAiEvalWork } from "@/server/actions/ai-eval-read"

import type { ReadQueue } from "@/server/queries/ai-eval-read"

/** Filas cujas não-lidas somam no badge da sidebar (desmarcar uma sobe o badge). */
const BADGE_QUEUES = new Set<ReadQueue>(["attr", "veredito", "interesse"])

/**
 * Helper das filas de /ai-evaluation pra desmarcar UMA obra como lida (clicar no
 * selo "Lida" do card). `readIds` chega como array (props RSC não serializam Set).
 *
 * Feedback OTIMISTA: o selo some na hora (`useOptimistic`) e o badge sobe 1 na
 * hora (patch do chrome), sem esperar o round-trip; a server action + refresh
 * reconciliam em segundo plano (e revertem o otimismo se falharem).
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
          refresh(BADGE_QUEUES.has(queue) ? { badgeDelta: { aiEval: 1 } } : undefined)
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

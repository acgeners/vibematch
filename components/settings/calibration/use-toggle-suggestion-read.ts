"use client"

import { useCallback, useMemo, useOptimistic, useTransition } from "react"
import { toast } from "sonner"
import { useRefresh } from "@/lib/use-refresh"
import { markSuggestionRead, unmarkSuggestionRead } from "@/server/actions/settings-read"

/**
 * Toggle de "lida" por SUGESTÃO da auditoria de critérios IA (card 'ai-audit').
 * Diferente das seções agregadas, aqui a pendência é 1-a-1: cada sugestão pode
 * ser silenciada individualmente (sem aceitar/rejeitar). `readIds` chega como
 * array (props RSC não serializam Set).
 *
 * Feedback OTIMISTA: o selo troca na hora e o badge (sidebar/tópico) sobe/desce 1
 * na hora (`badgeDelta.settings`); a server action + `router.refresh()`
 * reconciliam em segundo plano (e revertem o otimismo se falharem).
 */
export function useToggleSuggestionRead(readIds: string[]) {
  const refresh = useRefresh()
  const baseReadSet = useMemo(() => new Set(readIds), [readIds])
  const [optimisticRead, applyOptimistic] = useOptimistic(
    baseReadSet,
    (set: Set<string>, action: { id: string; read: boolean }) => {
      const next = new Set(set)
      if (action.read) next.add(action.id)
      else next.delete(action.id)
      return next
    },
  )
  const [, startTransition] = useTransition()

  const isRead = useCallback((id: string) => optimisticRead.has(id), [optimisticRead])

  const toggle = useCallback(
    (id: string) => {
      const willRead = !optimisticRead.has(id)
      startTransition(async () => {
        applyOptimistic({ id, read: willRead })
        try {
          if (willRead) {
            await markSuggestionRead(id)
            refresh({ badgeDelta: { settings: -1 } })
          } else {
            await unmarkSuggestionRead(id)
            refresh({ badgeDelta: { settings: 1 } })
          }
        } catch (err) {
          // useOptimistic reverte sozinho ao fim da transição (readIds não mudou).
          toast.error(err instanceof Error ? err.message : "Falha ao atualizar a sugestão.")
        }
      })
    },
    [optimisticRead, applyOptimistic, refresh],
  )

  return { isRead, toggle }
}

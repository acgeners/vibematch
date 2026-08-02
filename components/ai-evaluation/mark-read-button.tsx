"use client"

import { useOptimistic, useTransition } from "react"
import { CheckCheck, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useRefresh } from "@/lib/use-refresh"
import { markAllAiEvalRead, unmarkAllAiEvalRead } from "@/server/actions/ai-eval-read"
import type { ReadQueue } from "@/server/queries/ai-eval-read"
import type { ChromeBadgeDelta } from "@/lib/chrome-refresh"

// refreshChrome faz Math.max(0, prev + delta): um delta bem negativo zera o badge
// na hora, sem precisar saber o valor atual exato (o refresh reconcilia depois).
const BADGE_CLEAR_DELTA = -1_000_000

/**
 * Toggle binário no cabeçalho de /ai-evaluation e /fila-recomendacao. Marca
 * TODAS as pendências das filas passadas como lidas (silencia sem resolver)
 * ou, quando tudo já está lido, desmarca tudo. `queues`/`badgeKey` escopam a
 * ação pra SÓ as filas daquela página — cada página tem seu próprio badge
 * desde que /ai-evaluation virou duas (Curadoria da Obra × Fila de
 * Recomendação). Feedback OTIMISTA: o rótulo troca e o badge zera na hora; a
 * server action + refresh reconciliam os cards/contadores em segundo plano.
 */
export function MarkReadButton({
  allRead,
  queues,
  badgeKey,
}: {
  allRead: boolean
  queues: readonly ReadQueue[]
  badgeKey: keyof ChromeBadgeDelta
}) {
  const refresh = useRefresh()
  const [pending, startTransition] = useTransition()
  const [optimisticAllRead, setOptimisticAllRead] = useOptimistic(allRead, (_prev, next: boolean) => next)

  const handleClick = () => {
    const wasAllRead = optimisticAllRead
    startTransition(async () => {
      setOptimisticAllRead(!wasAllRead) // troca o rótulo na hora
      try {
        if (wasAllRead) {
          await unmarkAllAiEvalRead(queues)
          refresh() // badge sobe pro valor exato (refetch)
          toast.success("Pendências desmarcadas — voltaram a contar.")
        } else {
          const { marked } = await markAllAiEvalRead(queues)
          const delta = { [badgeKey]: BADGE_CLEAR_DELTA } as ChromeBadgeDelta
          refresh({ badgeDelta: delta }) // zera o badge já
          toast.success(
            marked > 0 ? "Tudo marcado como lido — badge silenciado." : "Nada pendente para marcar.",
          )
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao atualizar as pendências.")
      }
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
      {optimisticAllRead ? <RotateCcw /> : <CheckCheck />}
      {optimisticAllRead ? "Desmarcar tudo" : "Marcar tudo como lido"}
    </Button>
  )
}

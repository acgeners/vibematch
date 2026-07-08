"use client"

import { useOptimistic, useTransition } from "react"
import { Check, CheckCheck, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useRefresh } from "@/lib/use-refresh"
import { markSettingsSectionRead, unmarkSettingsSectionRead } from "@/server/actions/settings-read"

type Mode = "unread" | "read" | "none"

/**
 * Controle de "lido" no cabeçalho de um card AGREGADO (batch) de /settings —
 * Embeddings, Sinopse canônica, Síntese de reviews, Comix. A pendência é uma
 * CONTAGEM; marcar como lido grava um snapshot dela (silencia sem resolver).
 *
 * Dois estados visuais:
 *   - não-lido (`unread > 0`): botão "Marcar como lido".
 *   - lido (`unread === 0 && isRead`): selo "Lida" + "Desfazer".
 * (Nada a mostrar quando não há pendência e nada foi lido.)
 *
 * Feedback OTIMISTA: o rótulo troca e o badge (sidebar/tópico) se ajusta na hora
 * via `badgeDelta.settings`; a server action + `router.refresh()` reconciliam a
 * pílula do card em segundo plano.
 */
export function CardMarkRead({
  section,
  pending,
  unread,
  isRead,
}: {
  section: string
  /** Contagem REAL de pendências da seção (pra reverter o badge ao desmarcar). */
  pending: number
  /** Não-lido atual (pendências − snapshot). */
  unread: number
  /** Já existe um snapshot gravado pra esta seção. */
  isRead: boolean
}) {
  const refresh = useRefresh()
  const [saving, startTransition] = useTransition()
  // 3 estados: há não-lido → botão; já silenciado (ack) → selo; nada a fazer → nada.
  const initialMode: Mode = unread > 0 ? "unread" : isRead ? "read" : "none"
  const [mode, setMode] = useOptimistic(initialMode, (_prev, next: Mode) => next)

  const mark = () => {
    startTransition(async () => {
      setMode("read")
      try {
        await markSettingsSectionRead(section)
        refresh({ badgeDelta: { settings: -unread } }) // silencia o que estava não-lido
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao marcar como lida.")
      }
    })
  }

  const undo = () => {
    startTransition(async () => {
      // Desmarcar: volta a contar tudo. Se há pendência real, volta pro botão;
      // se não (silenciava uma contagem já zerada), some.
      setMode(pending > 0 ? "unread" : "none")
      try {
        await unmarkSettingsSectionRead(section)
        // Badge sobe o que estava silenciado (pendências reais − não-lido atual).
        refresh({ badgeDelta: { settings: Math.max(0, pending - unread) } })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao desmarcar.")
      }
    })
  }

  if (mode === "none") return null

  if (mode === "read") {
    return (
      <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 self-start">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-500/30 dark:text-emerald-300">
          <Check className="size-3.5" />
          Lida
        </span>
        <Button variant="ghost" size="sm" onClick={undo} disabled={saving} className="h-7 px-2 text-xs">
          <RotateCcw className="size-3.5" />
          Desfazer
        </Button>
      </span>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={mark}
      disabled={saving}
      className="mt-0.5 h-7 shrink-0 self-start px-2.5 text-xs"
    >
      <CheckCheck className="size-3.5" />
      Marcar como lido
    </Button>
  )
}

"use client"

import { useTransition } from "react"
import { CheckCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useRefresh } from "@/lib/use-refresh"
import { markAllSettingsRead } from "@/server/actions/settings-read"

// refreshChrome faz Math.max(0, prev + delta): um delta bem negativo zera o badge
// na hora, sem precisar saber o valor exato (o refresh reconcilia depois).
const BADGE_CLEAR_DELTA = -1_000_000

/**
 * Botão global no cabeçalho de /curation/settings. Só é renderizado quando HÁ pendências
 * não-lidas (ver `showMarkAll` em page.tsx) — silencia todas de uma vez (as 4
 * seções agregadas + as sugestões pendentes da auditoria) sem resolver. O
 * "desmarcar" por card continua no selo "Lida → Desfazer" de cada item; não faz
 * sentido um "desmarcar tudo" global quando não há nada silenciado a reverter.
 * Feedback OTIMISTA: o badge zera na hora; a action + refresh reconciliam depois.
 */
export function MarkAllReadButton() {
  const refresh = useRefresh()
  const [pending, startTransition] = useTransition()

  const handleClick = () => {
    startTransition(async () => {
      try {
        const { marked } = await markAllSettingsRead()
        refresh({ badgeDelta: { settings: BADGE_CLEAR_DELTA } }) // zera o badge já
        toast.success(
          marked > 0 ? "Tudo marcado como lido — badge silenciado." : "Nada pendente para marcar.",
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Falha ao atualizar as pendências.")
      }
    })
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={pending}>
      <CheckCheck />
      Marcar tudo como lido
    </Button>
  )
}

"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { triggerRecalcNow } from "@/server/actions/recalc-queue"
import { refreshSidebarBadges } from "@/lib/sidebar-badges"

interface RecalcPendingControlProps {
  /** Estado vindo do server (banner) ou do fetch de badges (sidebar). */
  pending: boolean
  /** "banner" = faixa âmbar no topo do /ranking; "compact" = botão na sidebar. */
  variant?: "banner" | "compact"
  /** Callback opcional pra o pai sincronizar o estado após o recálculo. */
  onDone?: () => void
}

/**
 * Botão "Recalcular agora" da fila de recálculo. Aparece quando há edições de
 * nota não recalculadas (recalc_pending). Roda recalculateAll na hora; some ao
 * concluir. O recálculo automático (até 1h após a última edição) é independente
 * deste botão — aqui é só o atalho manual.
 */
export function RecalcPendingControl({
  pending,
  variant = "banner",
  onDone,
}: RecalcPendingControlProps) {
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)

  if (!pending || done) return null

  const handleRecalc = async () => {
    setRunning(true)
    try {
      const res = await triggerRecalcNow()
      toast.success(
        `Notas recalculadas (${res.recalculated} obra${res.recalculated === 1 ? "" : "s"}).`,
      )
      setDone(true)
      onDone?.()
      router.refresh()
      refreshSidebarBadges()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao recalcular")
    } finally {
      setRunning(false)
    }
  }

  if (variant === "compact") {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleRecalc}
        disabled={running}
        className="w-full gap-2 border-amber-500/50 text-amber-600 dark:text-amber-400"
      >
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        {running ? "Recalculando…" : "Recalcular notas"}
      </Button>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium">Notas alteradas — recálculo pendente</p>
        <p className="text-sm text-amber-900/80 dark:text-amber-100/70">
          A Nota Prevista e o ranking ainda não refletem suas últimas edições.
          Recalcule agora ou aguarde o recálculo automático (até 1h após a última
          alteração).
        </p>
      </div>
      <Button
        type="button"
        onClick={handleRecalc}
        disabled={running}
        className="w-full gap-2 sm:w-auto"
      >
        {running ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        {running ? "Recalculando…" : "Recalcular agora"}
      </Button>
    </div>
  )
}

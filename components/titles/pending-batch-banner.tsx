"use client"

import { useState } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { CheckCircle2, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { finalizePendingBatch } from "@/server/actions/works"
import { Button } from "@/components/ui/button"

interface PendingBatchBannerProps {
  initialCount: number
}

export function PendingBatchBanner({ initialCount }: PendingBatchBannerProps) {
  const refresh = useRefresh()
  const [count, setCount] = useState(initialCount)
  const [finalizing, setFinalizing] = useState(false)

  if (count <= 0) return null

  const handleFinalize = async () => {
    setFinalizing(true)
    try {
      const result = await finalizePendingBatch()
      setCount(0)
      toast.success(
        result.finalized > 0
          ? `${result.finalized} obra${result.finalized === 1 ? "" : "s"} recalculada${result.finalized === 1 ? "" : "s"}.`
          : "Nenhuma obra pendente para recalcular."
      )
      refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Erro ao finalizar lote")
    } finally {
      setFinalizing(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          {count} obra{count === 1 ? "" : "s"} aguardando recálculo
        </p>
        <p className="text-sm text-amber-900/80">
          Finalize o lote quando terminar de incluir todos os títulos.
        </p>
      </div>
      <Button
        type="button"
        onClick={handleFinalize}
        disabled={finalizing}
        className="w-full gap-2 sm:w-auto"
      >
        {finalizing ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        {finalizing ? "Finalizando..." : "Finalizar lote"}
      </Button>
    </div>
  )
}

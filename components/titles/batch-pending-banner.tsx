"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { finalizePendingBatch } from "@/server/actions/works"

interface BatchPendingBannerProps {
  count: number
}

export function BatchPendingBanner({ count }: BatchPendingBannerProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  if (count <= 0) return null

  const handleFinalize = () => {
    startTransition(async () => {
      try {
        const result = await finalizePendingBatch()
        toast.success(`${result.finalized} obras calculadas. Lote finalizado.`)
        router.push("/titles")
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro ao finalizar lote")
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
      <div>
        <strong className="text-amber-600 dark:text-amber-400">
          {count} {count === 1 ? "obra aguardando" : "obras aguardando"} cálculo
        </strong>
        <p className="text-xs text-muted-foreground">
          Adicionadas em lote sem disparar o recálculo. Finalize quando tiver incluído todas.
        </p>
      </div>
      <Button onClick={handleFinalize} disabled={isPending} size="sm">
        {isPending ? "Calculando..." : "Finalizar agora"}
      </Button>
    </div>
  )
}

"use client"

import { useTransition } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { Archive, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { unarchiveWork } from "@/server/actions/works"
import { useIsAdmin } from "@/components/layout/admin-context"
import { Button } from "@/components/ui/button"

export function ArchivedBanner({ workId }: { workId: string }) {
  const isAdmin = useIsAdmin()
  const refresh = useRefresh()
  const [isPending, startTransition] = useTransition()

  const handleUnarchive = () => {
    startTransition(async () => {
      const result = await unarchiveWork(workId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success("Obra desarquivada.")
      refresh()
    })
  }

  // O trilho lateral é um elemento com background, não `border-l-red-*`: o
  // `* { border-color }` fora de @layer em globals.css sobrescreve toda utility
  // de cor de borda do Tailwind, então bordas coloridas não pegam neste app.
  return (
    <div className="relative flex flex-wrap items-center gap-3 overflow-hidden rounded-lg border bg-red-50 px-3.5 py-2.5 pl-5 dark:bg-red-950/30">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-red-400 dark:bg-red-500/70" />
      <Archive className="h-[17px] w-[17px] shrink-0 text-red-600 dark:text-red-400" />
      <p className="min-w-[240px] flex-1 text-sm text-red-700 dark:text-red-300">
        <span className="font-bold text-red-900 dark:text-red-200">Esta obra está arquivada.</span>{" "}
        Ela fica fora do ranking, das recomendações e do dashboard — e não conta nas estatísticas.
      </p>
      {isAdmin && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleUnarchive}
          disabled={isPending}
          className="bg-background font-semibold text-red-900 hover:bg-red-100 hover:text-red-950 dark:text-red-200 dark:hover:bg-red-950/50 dark:hover:text-red-100"
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {isPending ? "Desarquivando..." : "Desarquivar"}
        </Button>
      )}
    </div>
  )
}

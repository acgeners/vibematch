"use client"

import { useState, useTransition } from "react"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { syncConstantsNow } from "@/server/actions/settings"

export function SyncConstantsPanel() {
  const [isPending, startTransition] = useTransition()
  const [output, setOutput] = useState<string | null>(null)

  const handleSync = () => {
    startTransition(async () => {
      const result = await syncConstantsNow()
      setOutput(result.output || null)

      if (result.ok) {
        toast.success("Constantes sincronizadas.")
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1 text-sm text-muted-foreground">
          <p>Atualiza os arquivos de constantes a partir das tabelas do Supabase.</p>
          <p>Também sincroniza grupos de tags e reconcilia gêneros legados em work_tags.</p>
          <p className="font-mono text-xs">npm run sync-constants</p>
        </div>
        <Button type="button" onClick={handleSync} disabled={isPending}>
          <RefreshCw className={isPending ? "animate-spin" : ""} />
          {isPending ? "Sincronizando..." : "Sincronizar constantes"}
        </Button>
      </div>

      {output && (
        <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          {output}
        </pre>
      )}
    </div>
  )
}

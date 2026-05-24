"use client"

import { useState, useTransition } from "react"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { LastRunHint } from "@/components/settings/last-run-hint"
import { syncConstantsNow } from "@/server/actions/settings"

interface SyncConstantsPanelProps {
  initialLastRun: string | null
}

export function SyncConstantsPanel({ initialLastRun }: SyncConstantsPanelProps) {
  const [isPending, startTransition] = useTransition()
  const [output, setOutput] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(initialLastRun)

  const handleSync = () => {
    startTransition(async () => {
      const result = await syncConstantsNow()
      setOutput(result.output || null)

      if (result.ok) {
        setLastRun(new Date().toISOString())
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
        <div className="flex flex-col items-end gap-1">
          <Button type="button" onClick={handleSync} disabled={isPending}>
            <RefreshCw className={isPending ? "animate-spin" : ""} />
            {isPending ? "Sincronizando..." : "Sincronizar constantes"}
          </Button>
          <LastRunHint iso={lastRun} label="Última sincronização" />
        </div>
      </div>

      {output && (
        <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          {output}
        </pre>
      )}
    </div>
  )
}

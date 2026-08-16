"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useRefresh } from "@/lib/use-refresh"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { setReadingStatusForWorks } from "@/server/actions/works"
import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { PERSONAL_STATUSES } from "@/types/domain"
import { UNTRACKED_PERSONAL_STATUS } from "@/lib/constants/status-lookups"

// Destinos: todos os status de leitura menos "Untracked" (mover-se pra Untracked é no-op).
const STATUS_OPTIONS = (PERSONAL_STATUSES as readonly string[]).filter((s) => s !== UNTRACKED_PERSONAL_STATUS)
const STATUS_INFO = (s: string) => Object.values(PERSONAL_STATUSES_BY_ID).find((i) => i.status === s)

/**
 * Ação em lote "Mudar status de leitura" — comum a TODAS as abas de /curation/works
 * (antes exclusiva do Untracked). Aplica o status escolhido às obras selecionadas.
 */
export function BulkStatusAction({
  selectedIds,
  onApplied,
}: {
  selectedIds: string[]
  onApplied?: () => void
}) {
  const refresh = useRefresh()
  const [status, setStatus] = useState<string>("")
  const [applying, setApplying] = useState(false)

  const apply = async () => {
    if (selectedIds.length === 0 || !status || applying) return
    setApplying(true)
    const res = await setReadingStatusForWorks(selectedIds, status)
    setApplying(false)
    if ("error" in res && res.error) {
      toast.error(typeof res.error === "string" ? res.error : "Falha ao aplicar status.")
      return
    }
    toast.success(`Status "${status}" aplicado a ${selectedIds.length} obra(s).`)
    onApplied?.()
    refresh()
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger size="sm" className="h-8 w-40 text-xs">
          <SelectValue placeholder="Mudar status…" />
        </SelectTrigger>
        <SelectContent>
          {STATUS_OPTIONS.map((s) => {
            const info = STATUS_INFO(s)
            return (
              <SelectItem key={s} value={s}>
                <span aria-hidden className="mr-1">{info?.symbol}</span>
                {s}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="outline"
        onClick={apply}
        disabled={applying || !status || selectedIds.length === 0}
      >
        {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Aplicar
      </Button>
    </div>
  )
}

"use client"

import { useEffect, useState, useTransition } from "react"
import { Loader2 } from "lucide-react"
import { CollapsibleCard } from "@/components/ui/collapsible-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { listDeepDiveHistoryAction } from "@/server/actions/deep-dive"
import { cn } from "@/lib/utils"
import type { DeepDiveResultRow } from "@/lib/ai-recommendation/types"

interface DeepDiveHistorySectionProps {
  workId: string
  currentId: string
  onSelect: (dive: DeepDiveResultRow) => void
}

function timeAgo(iso: string): string {
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / (1000 * 60))
  if (minutes < 1) return "agora"
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.floor(hours / 24)
  if (days === 1) return "ontem"
  if (days < 30) return `há ${days} dias`
  return date.toLocaleDateString("pt-BR")
}

function whenBadge(when: DeepDiveResultRow["read_when"]) {
  if (when === "agora")
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (when === "guardar")
    return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  if (when === "evitar")
    return "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
  return "border-border/60 bg-muted/40 text-muted-foreground"
}

export function DeepDiveHistorySection({ workId, currentId, onSelect }: DeepDiveHistorySectionProps) {
  const [history, setHistory] = useState<DeepDiveResultRow[] | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    startTransition(async () => {
      const list = await listDeepDiveHistoryAction(workId)
      setHistory(list)
    })
  }, [workId])

  // 1 análise = só a atual. Não mostra a seção.
  if (history && history.length <= 1) return null

  return (
    <CollapsibleCard
      title="Análises anteriores"
      description={`${history?.length ?? 0} análise(s) salva(s) pra esta obra.`}
      defaultOpen={false}
    >
      {isPending && !history ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Carregando histórico…
        </div>
      ) : history ? (
        <div className="space-y-2">
          {history.map((entry) => {
            const isCurrent = entry.id === currentId
            return (
              <div
                key={entry.id}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-md border p-2.5",
                  isCurrent ? "border-violet-500/40 bg-violet-500/5" : "bg-card/30 hover:bg-card/60",
                )}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span>{new Date(entry.created_at).toLocaleString("pt-BR")}</span>
                    <span>·</span>
                    <span>{timeAgo(entry.created_at)}</span>
                    {entry.read_when && (
                      <Badge
                        variant="outline"
                        className={cn("h-4 px-1.5 text-[9px] font-normal", whenBadge(entry.read_when))}
                      >
                        {entry.read_when}
                      </Badge>
                    )}
                  </div>
                  {entry.one_liner && (
                    <p className="line-clamp-2 text-xs italic text-foreground/85">
                      &ldquo;{entry.one_liner}&rdquo;
                    </p>
                  )}
                  {entry.user_context && (
                    <p className="line-clamp-1 text-[10px] text-muted-foreground/80">
                      contexto: {entry.user_context}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {entry.match_score != null ? Math.round(entry.match_score) : "—"}
                  </span>
                  {!isCurrent && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onSelect(entry)}
                      className="h-6 px-2 text-[10px]"
                    >
                      ver
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Não foi possível carregar o histórico.</p>
      )}
    </CollapsibleCard>
  )
}

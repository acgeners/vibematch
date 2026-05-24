"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { BookOpen, ChartNoAxesCombined, ChevronRight, Loader2, Sparkles, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { cn } from "@/lib/utils"
import { formatRelativeDateTime } from "@/lib/date-utils"
import type { RecommendationRunSummary } from "@/server/queries/recommendations"
import { deleteRecommendationRunAction } from "@/server/actions/recommendations"
import type { RecommendationMode } from "@/lib/ai-recommendation/types"

interface RunHistoryListProps {
  runs: RecommendationRunSummary[]
}

function modeLabel(mode: RecommendationMode): string {
  if (mode === "next_read") return "Próxima leitura"
  if (mode === "ranking") return "Ranking (filtrado)"
  return "Análise do gosto"
}

function ModeIcon({ mode }: { mode: RecommendationMode }) {
  if (mode === "next_read") return <BookOpen className="h-3.5 w-3.5" />
  if (mode === "ranking") return <Sparkles className="h-3.5 w-3.5" />
  return <ChartNoAxesCombined className="h-3.5 w-3.5" />
}

function alignmentColor(score: number | null): string {
  if (score == null) return ""
  if (score >= 90) return "text-emerald-600 dark:text-emerald-300"
  if (score >= 70) return "text-lime-600 dark:text-lime-300"
  if (score >= 50) return "text-amber-600 dark:text-amber-300"
  return "text-rose-600 dark:text-rose-300"
}

export function RunHistoryList({ runs }: RunHistoryListProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma execução salva ainda. Gere sua primeira recomendação acima.
      </p>
    )
  }

  const handleDelete = (id: string) => {
    setPendingId(id)
    startTransition(async () => {
      await deleteRecommendationRunAction(id)
      setPendingId(null)
      setConfirmId(null)
    })
  }

  return (
    <>
      <ul className="space-y-2">
        {runs.map((run) => (
          <li
            key={run.id}
            className="group relative rounded-lg border bg-card/40 p-3 transition hover:bg-card/70"
          >
            <Link href={`/recommendations/${run.id}`} className="flex items-start gap-3">
              <div className="flex flex-col items-center gap-1 pt-0.5">
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <ModeIcon mode={run.mode} />
                  {modeLabel(run.mode)}
                </Badge>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2 text-xs text-muted-foreground">
                  <span>{formatRelativeDateTime(run.createdAt)}</span>
                  <span>•</span>
                  <span>{run.nCandidates} candidatos</span>
                  {run.topAlignment != null && (
                    <>
                      <span>•</span>
                      <span className={cn("font-medium", alignmentColor(run.topAlignment))}>
                        top {Math.round(run.topAlignment)}
                      </span>
                    </>
                  )}
                </div>
                {run.userContext && (
                  <p className="mt-1 line-clamp-1 text-xs italic text-foreground/80">
                    “{run.userContext}”
                  </p>
                )}
                {run.topTitles.length > 0 && (
                  <p className="mt-1 line-clamp-1 text-sm">
                    <span className="text-muted-foreground">Top: </span>
                    {run.topTitles.join(" · ")}
                  </p>
                )}
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
            <div className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100">
              <Button
                size="sm"
                variant="ghost"
                onClick={(e) => {
                  e.preventDefault()
                  setConfirmId(run.id)
                }}
                disabled={pendingId === run.id}
                title="Excluir do histórico"
              >
                {pendingId === run.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open) => !open && setConfirmId(null)}
        title="Excluir esta execução?"
        description="A run salva será removida do histórico. Esta ação não pode ser desfeita."
        confirmText="Excluir"
        onConfirm={() => {
          if (confirmId) handleDelete(confirmId)
        }}
      />
    </>
  )
}

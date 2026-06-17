"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import {
  BookOpen,
  ChartNoAxesCombined,
  Loader2,
  MessageCircle,
  Trash2,
} from "lucide-react"
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
  if (mode === "ranking") return "Conversa com IA"
  return "Re-ranquear favoritos"
}

function ModeIcon({ mode }: { mode: RecommendationMode }) {
  if (mode === "next_read") return <BookOpen className="h-4 w-4" />
  if (mode === "ranking") return <MessageCircle className="h-4 w-4" />
  return <ChartNoAxesCombined className="h-4 w-4" />
}

function alignmentColor(score: number): string {
  if (score >= 90) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
  if (score >= 70) return "border-lime-500/40 bg-lime-500/10 text-lime-700 dark:text-lime-300"
  if (score >= 50) return "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
  return "border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300"
}

export function RunHistoryList({ runs }: RunHistoryListProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  if (runs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhuma execução ainda. Converse com a IA ou use o modo rápido pra gerar a primeira.
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
      <ul className="space-y-1.5">
        {runs.map((run) => (
          <li
            key={run.id}
            className="group relative rounded-lg border bg-card/40 transition hover:bg-card/70"
          >
            <Link
              href={`/recommendations/${run.slug}`}
              className="flex items-center gap-3 p-2.5 pr-9"
              title={run.userContext ?? undefined}
            >
              <div
                className="grid size-8 shrink-0 place-items-center rounded-md bg-muted/50 text-muted-foreground"
                title={modeLabel(run.mode)}
              >
                <ModeIcon mode={run.mode} />
              </div>

              <div className="min-w-0 flex-1">
                {run.topTitles.length > 0 ? (
                  <div className="space-y-0.5">
                    {run.topTitles.map((title, i) => (
                      <p
                        key={i}
                        className="flex items-baseline gap-1.5 text-sm font-medium leading-tight"
                      >
                        <span className="text-muted-foreground">•</span>
                        <span className="line-clamp-1">{title}</span>
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Sem resultados salvos</p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {formatRelativeDateTime(run.createdAt)} · {run.nCandidates} candidatos
                </p>
              </div>

              {run.topAlignment != null && (
                <span
                  className={cn(
                    "inline-flex shrink-0 items-baseline gap-1 rounded-md border px-1.5 py-0.5",
                    alignmentColor(run.topAlignment),
                  )}
                  title="Faixa de IA Rk (match) das obras desta execução — do maior ao menor"
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wide opacity-80">
                    IA Rk
                  </span>
                  <span className="text-xs font-bold tabular-nums">
                    {Math.round(run.topAlignment)}
                    {run.lowAlignment != null &&
                      Math.round(run.lowAlignment) !== Math.round(run.topAlignment) && (
                        <span className="font-medium opacity-70">
                          –{Math.round(run.lowAlignment)}
                        </span>
                      )}
                  </span>
                </span>
              )}
            </Link>

            <div className="absolute right-1.5 top-1.5 opacity-0 transition group-hover:opacity-100">
              <Button
                size="icon-sm"
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

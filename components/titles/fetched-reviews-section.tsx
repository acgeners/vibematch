"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { AlertTriangle, Globe, Trash2 } from "lucide-react"
import { deleteFetchedReview } from "@/server/actions/fetched-reviews"
import type { WorkReviewsBySource } from "@/server/queries/work-reviews"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import { useRefresh } from "@/lib/use-refresh"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ExpandableText } from "@/components/ui/expandable-text"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

interface Props {
  workId: string
  bySource: WorkReviewsBySource[]
}

function ratingColor(rating: number | null): string {
  if (rating == null) return "text-muted-foreground"
  if (rating >= 8) return "text-emerald-600 dark:text-emerald-300"
  if (rating >= 6) return "text-lime-600 dark:text-lime-300"
  if (rating >= 4) return "text-amber-600 dark:text-amber-300"
  return "text-rose-600 dark:text-rose-300"
}

/**
 * SEÇÃO "Reviews das fontes" (work_reviews) — só EXCLUSÃO. O pool é apagado e reescrito
 * por inteiro a cada Avaliação IA/refetch (persist-reviews), então a remoção é EFÊMERA:
 * vale só até a próxima avaliação. Útil para tirar reviews-lixo antes de uma avaliação pontual.
 * O texto é read-only — para uma cópia durável e editável, use "Reviews externas (manuais)".
 */
export function FetchedReviewsSection({ workId, bySource }: Props) {
  const refresh = useRefresh()
  const [pending, startTransition] = useTransition()
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const total = bySource.reduce((acc, g) => acc + g.reviews.length, 0)

  const onDelete = (id: string) => {
    startTransition(async () => {
      const result = await deleteFetchedReview(id, workId)
      if (result.ok) {
        toast.success("Review da fonte removida (até a próxima avaliação).")
        refresh()
      } else {
        toast.error(result.message)
      }
      setConfirmId(null)
    })
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Globe className="h-4 w-4 text-muted-foreground" />
          Reviews das fontes
          <Badge variant="outline" className="text-[11px]">local · dev</Badge>
          {total > 0 && <Badge variant="secondary" className="text-[11px]">{total}</Badge>}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Reviews buscadas automaticamente das fontes externas. Aqui só dá para <strong>excluir</strong>
          {" "}(o texto não é editável). Para uma cópia editável e durável, adicione em &ldquo;Reviews
          externas (manuais)&rdquo;.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-muted-foreground">
          A exclusão é <strong>efêmera</strong>: este conjunto é apagado e reescrito por inteiro a cada
          Avaliação IA / nova busca de reviews. A review removida pode voltar na próxima avaliação.
        </p>
      </div>

      {total === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma review buscada das fontes ainda.</p>
      ) : (
        <div className="space-y-5">
          {bySource.map(({ source, reviews }) => (
            <div key={source} className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-sm font-semibold">{PLATFORM_LABELS[source] ?? source}</h4>
                <span className="text-xs text-muted-foreground">{reviews.length} review(s)</span>
              </div>
              <ul className="space-y-2">
                {reviews.map((r) => (
                  <li key={r.id} className="rounded-md border bg-card/40 p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                      <div className="flex items-baseline gap-2">
                        {r.sourceTitle && (
                          <span className="line-clamp-1 max-w-[28rem] text-muted-foreground" title={r.sourceTitle}>
                            <span className="text-foreground/70">como </span>“{r.sourceTitle}”
                          </span>
                        )}
                        <Badge variant="outline" className="text-[11px]">match {Math.round(r.matchScore * 100)}%</Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        {r.userRating != null && (
                          <span className={cn("font-mono font-semibold tabular-nums", ratingColor(r.userRating))}>
                            {r.userRating.toFixed(1)}/10
                          </span>
                        )}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-muted-foreground hover:text-destructive"
                          disabled={pending}
                          onClick={() => setConfirmId(r.id)}
                          aria-label="Remover review da fonte"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    <ExpandableText
                      text={r.text}
                      maxLines={4}
                      className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground/90"
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmId != null}
        onOpenChange={(o) => !o && setConfirmId(null)}
        title="Remover review da fonte?"
        description="A review buscada será excluída deste conjunto. Pode voltar na próxima Avaliação IA / nova busca."
        confirmText="Remover"
        onConfirm={() => {
          if (confirmId) onDelete(confirmId)
        }}
      />
    </section>
  )
}

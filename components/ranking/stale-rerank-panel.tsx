"use client"

import { useMemo, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, Loader2, RotateCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PersonalStatusBadge, PublicationStatusBadge } from "@/components/ui/status-badge"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { RerankAiRkButton } from "@/components/titles/rerank-ai-rk-button"
import { CoverThumb } from "@/components/ai-evaluation/cover-thumb"
import { rerankStaleBatchAction } from "@/server/actions/recommendations"
import type { AlignmentQueueWork } from "@/server/queries/recommendations"

type SortField = "default" | "expected" | "alignment"

/**
 * Fila de IA Rk (aba /ai-evaluation?tab=ia-rk): obras desatualizadas (re-rank
 * velho) e/ou não avaliadas (sem IA Rk). Mesmo layout de cards da aba de
 * atributos. O re-rank em LOTE cobre só os desatualizados (rerankStaleBatchAction);
 * não avaliados são re-rankeados item a item pelo RerankAiRkButton.
 */
export function StaleRerankPanel({ works }: { works: AlignmentQueueWork[] }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const [sortField, setSortField] = useState<SortField>("default")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const hasStale = works.some((w) => w.alignmentStale && w.alignmentScore != null)

  const sortedWorks = useMemo(() => {
    if (sortField === "default") {
      // Desatualizados primeiro, depois não avaliados; cada grupo por título.
      return [...works].sort((a, b) => {
        const aStale = a.alignmentStale && a.alignmentScore != null ? 0 : 1
        const bStale = b.alignmentStale && b.alignmentScore != null ? 0 : 1
        if (aStale !== bStale) return aStale - bStale
        return a.title.localeCompare(b.title, "pt-BR")
      })
    }
    const key = (w: AlignmentQueueWork) =>
      sortField === "expected" ? w.expectedScore : w.alignmentScore
    const mult = sortDir === "asc" ? 1 : -1
    return [...works].sort((a, b) => {
      const ka = key(a)
      const kb = key(b)
      // Nulos sempre no fim, independente da direção.
      if (ka == null && kb == null) return 0
      if (ka == null) return 1
      if (kb == null) return -1
      return (ka - kb) * mult
    })
  }, [works, sortField, sortDir])

  const handleRerankAll = () => {
    startTransition(async () => {
      const result = await rerankStaleBatchAction()
      if (result.error || !result.data) {
        toast.error(result.error ?? "Erro ao re-rankear.")
        return
      }
      const { ranked, truncated, available } = result.data
      toast.success(
        truncated
          ? `${ranked} re-rankeadas (de ${available}). Rode de novo pro restante.`
          : `${ranked} obra${ranked !== 1 ? "s" : ""} re-rankeada${ranked !== 1 ? "s" : ""}.`,
      )
      router.refresh()
    })
  }

  if (works.length === 0) {
    return (
      <div className="rounded-xl border border-border/70 bg-card/55 p-8 text-center text-sm text-muted-foreground">
        Nenhuma obra nesse filtro. 🎉
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Ordenar:</span>
          <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
            <SelectTrigger size="sm" className="h-7 w-[150px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Padrão</SelectItem>
              <SelectItem value="expected">Nota prevista</SelectItem>
              <SelectItem value="alignment">IA Rk</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon-xs"
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            disabled={sortField === "default"}
            title={sortDir === "asc" ? "Crescente" : "Decrescente"}
          >
            {sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          </Button>
        </div>

        {hasStale && (
          <Button onClick={handleRerankAll} disabled={isPending}>
            {isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RotateCw className="mr-1 h-4 w-4" />
            )}
            {isPending ? "Re-rankeando..." : "Re-rankear desatualizados"}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {sortedWorks.map((w) => {
          const isStale = w.alignmentStale && w.alignmentScore != null
          return (
            <Card
              key={w.id}
              className="transition-all hover:border-primary/30 hover:bg-card hover:shadow-md hover:shadow-primary/10"
            >
              <CardContent className="py-2.5">
                <div className="flex items-center gap-3">
                  {/* Capa (esquerda) — aspect 2:3 de manga */}
                  <CoverThumb url={w.coverUrl} />

                  {/* Conteúdo central */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <WorkTitleLink
                        title={w.title}
                        workId={w.id}
                        className="text-sm font-semibold hover:underline line-clamp-2 break-words"
                      />
                      {w.expectedScore != null && (
                        <span title="Nota prevista" className="inline-flex shrink-0">
                          <ScoreBadge score={w.expectedScore} size="sm" />
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <PublicationStatusBadge statusId={w.publicationStatusId} />
                      <PersonalStatusBadge statusId={w.personalStatusId} />
                      {w.synopsisQuality && (
                        <span
                          title="Interesse na sinopse"
                          className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600 dark:border-rose-400/25 dark:bg-rose-400/10 dark:text-rose-300"
                        >
                          {w.synopsisQuality}
                        </span>
                      )}
                      {isStale ? (
                        <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:border-amber-400/25 dark:bg-amber-400/12 dark:text-amber-200">
                          desatualizado
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-700 dark:border-slate-400/20 dark:bg-slate-400/10 dark:text-slate-300">
                          não avaliado
                        </span>
                      )}
                    </div>

                    <p className="font-mono text-xs text-muted-foreground tabular-nums">
                      IA Rk: {w.alignmentScore != null ? Math.round(w.alignmentScore) : "—"}
                    </p>
                  </div>

                  {/* Ações (direita) */}
                  <div className="flex shrink-0 flex-col items-stretch gap-2.5">
                    <RerankAiRkButton workId={w.id} hasScore={w.alignmentScore != null} />
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

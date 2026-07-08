"use client"

import { useEffect, useState, type ReactNode } from "react"
import { BookOpen, MessageSquare, Star, StickyNote, Tag, Users } from "lucide-react"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { CoverImage } from "@/components/ui/cover-image"
import { InterestAppliedMark } from "@/components/ui/interest-applied-mark"
import { cn } from "@/lib/utils"
import { getWorkHoverCounts, type WorkPreview } from "@/server/actions/works"

interface WorkHoverPreviewProps {
  preview: WorkPreview
  anchorRect: DOMRect
}

interface WorkCounts {
  tagCount: number
  reviewCount: number
}

// Contagens são as mesmas em qualquer surface, então cacheamos por obra pra não
// refazer a RPC a cada re-hover.
const countsCache = new Map<string, WorkCounts>()

function formatVotes(votes: number): string {
  if (votes === 0) return "—"
  if (votes < 1000) return String(votes)
  const k = Math.floor(votes / 100) / 10
  const formatted = k % 1 === 0 ? String(k) : k.toFixed(1).replace(".", ",")
  return `${formatted}K`
}

/** Escala de 4 corações (preenchidos = valor, resto esmaecido) — mesma da lista do ranking. */
function Hearts({ quality, variant }: { quality: string; variant: "manual" | "pred" }) {
  const filled = Math.min(4, Math.max(0, [...quality].length))
  const empty = 4 - filled
  return (
    <span
      className={cn(
        "text-[15px] leading-none tracking-[0.12em]",
        variant === "manual" ? "text-red-500" : "text-orange-500",
      )}
    >
      {"♥".repeat(filled)}
      {empty > 0 && <span className="opacity-25">{"♥".repeat(empty)}</span>}
    </span>
  )
}

/** Interesse: manual (rosa) + previsto (salmão + selo IA), mesma paleta do filtro. */
function InterestHearts({
  manual,
  manualFromPrediction = false,
  predicted,
  predictedStale,
}: {
  manual: string | null
  /** Manual foi aplicado da previsão (não definido à mão) → selo ✨. */
  manualFromPrediction?: boolean
  predicted: string | null
  predictedStale: boolean
}) {
  if (!manual && !predicted) return null
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" aria-label="Interesse na obra">
      {manual && <Hearts quality={manual} variant="manual" />}
      {manual && manualFromPrediction && <InterestAppliedMark size={12} />}
      {manual && predicted && <span className="h-3 w-px bg-border/70" aria-hidden />}
      {predicted && (
        <span className="inline-flex items-center gap-1">
          <Hearts quality={predicted} variant="pred" />
          <span
            className={cn(
              "rounded border border-orange-500/40 px-[3px] text-[8px] font-extrabold leading-[1.4] tracking-wide text-orange-500 dark:text-orange-400",
              predictedStale && "opacity-60",
            )}
          >
            IA
          </span>
        </span>
      )}
    </span>
  )
}

/** Status curto e discreto: emoji + código, sem pill/borda, na cor do status (hex do DB). */
function StatusFacet({ statusId }: { statusId: number }) {
  const info = PUBLICATION_STATUSES_BY_ID[statusId]
  if (!info) return null
  return (
    <span className="inline-flex items-center gap-1" title={info.status}>
      <span aria-hidden>{info.symbol}</span>
      <span className="font-medium" style={info.color ? { color: info.color } : undefined}>
        {info.short}
      </span>
    </span>
  )
}

/** Bloco da tira de notas: rótulo minúsculo + ícone/valor — igual aos cards do ranking. */
function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="whitespace-nowrap text-[8px] font-bold uppercase tracking-wide text-muted-foreground/70">
        {label}
      </span>
      <span className="inline-flex items-center gap-1 text-[13px] font-bold leading-none tabular-nums">
        {children}
      </span>
    </div>
  )
}

export function WorkHoverPreview({ preview, anchorRect }: WorkHoverPreviewProps) {
  const margin = 2
  const screenMargin = 8
  const popupWidth = 420
  const popupHeight = 250
  const willOverflowRight = anchorRect.right + margin + popupWidth > window.innerWidth
  const left = willOverflowRight
    ? Math.max(screenMargin, anchorRect.left - popupWidth - margin)
    : anchorRect.right + margin
  const top = Math.min(
    Math.max(screenMargin, anchorRect.top),
    window.innerHeight - popupHeight - screenMargin
  )

  // Tags + reviews sob demanda no hover (1 chamada por obra, cacheada).
  const [counts, setCounts] = useState<WorkCounts | null>(
    () => countsCache.get(preview.workId) ?? null
  )
  useEffect(() => {
    if (counts) return
    let alive = true
    getWorkHoverCounts(preview.workId)
      .then((c) => {
        countsCache.set(preview.workId, c)
        if (alive) setCounts(c)
      })
      .catch(() => {
        // silencioso — o rodapé só fica com "—"
      })
    return () => {
      alive = false
    }
  }, [preview.workId, counts])

  const hasMeta1 = preview.year != null || preview.totalChapters != null || preview.publicationStatusId != null
  const hasInterest = Boolean(preview.synopsisQuality || preview.predictedSynopsisQuality)
  const hasComment = Boolean(preview.observations && preview.observations.trim())

  return (
    <div
      className="fixed z-50 w-[420px] overflow-hidden rounded-xl border border-black/10 bg-[#f4f6fb] text-popover-foreground shadow-2xl pointer-events-none dark:border-white/12 dark:bg-[#1c2230]"
      style={{ left, top }}
    >
      <div className="flex gap-4 p-4">
        {preview.coverUrl ? (
          <div className="relative h-44 w-32 shrink-0 rounded-md overflow-hidden bg-muted">
            <CoverImage url={preview.coverUrl} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div className="h-44 w-32 shrink-0 rounded-md bg-muted flex items-center justify-center text-xs text-muted-foreground">
            Sem capa
          </div>
        )}
        <div className="flex flex-col min-w-0 flex-1 h-44">
          <p className="font-semibold text-[15px] leading-tight line-clamp-2 shrink-0 break-words">{preview.title}</p>

          {(hasMeta1 || hasInterest) && (
            <div className="mt-1.5 pb-2 border-b border-border/60 shrink-0 flex flex-col gap-1.5">
              {/* Linha 1: ano · capítulos · status curto (discreto) */}
              {hasMeta1 && (
                <div className="flex items-center gap-1.5 flex-wrap text-xs font-medium text-foreground/75">
                  {preview.year != null && <span className="opacity-90">{preview.year}</span>}
                  {preview.year != null && preview.totalChapters != null && (
                    <span className="text-foreground/40">·</span>
                  )}
                  {preview.totalChapters != null && (
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <BookOpen className="size-3 text-muted-foreground/70" />
                      {preview.totalChapters}
                    </span>
                  )}
                  {(preview.year != null || preview.totalChapters != null) &&
                    preview.publicationStatusId != null && <span className="text-foreground/40">·</span>}
                  {preview.publicationStatusId != null && (
                    <StatusFacet statusId={preview.publicationStatusId} />
                  )}
                </div>
              )}
              {/* Linha 2: interesses (manual + previsto) */}
              {hasInterest && (
                <InterestHearts
                  manual={preview.synopsisQuality}
                  manualFromPrediction={preview.synopsisFromPrediction}
                  predicted={preview.predictedSynopsisQuality}
                  predictedStale={preview.predictedSynopsisStale}
                />
              )}
            </div>
          )}

          {preview.synopsis && (
            <div className="flex-1 min-h-0 overflow-hidden mt-2">
              <p className="text-[13px] italic text-muted-foreground line-clamp-5 break-words whitespace-normal leading-snug">{preview.synopsis}</p>
            </div>
          )}
        </div>
      </div>

      {/* Rodapé: tags + reviews à esquerda · externa + votos à direita */}
      <div className="border-t border-border/60 bg-black/[0.015] px-4 py-2 flex items-center justify-between gap-3 dark:bg-white/[0.025]">
        {/* Cada indicador só aparece quando o item existe (tags>0, reviews>0, comentário).
            Enquanto as contagens carregam (counts === null), tags/reviews ficam ocultos. */}
        <div className="inline-flex items-center gap-3.5 text-xs text-muted-foreground">
          {counts != null && counts.tagCount > 0 && (
            <span title="Tags da obra" className="inline-flex items-center gap-1 tabular-nums">
              <Tag className="size-3.5" />
              {counts.tagCount}
            </span>
          )}
          {counts != null && counts.reviewCount > 0 && (
            <span title="Reviews úteis (≥40 caracteres)" className="inline-flex items-center gap-1 tabular-nums">
              <MessageSquare className="size-3.5" />
              {counts.reviewCount}
            </span>
          )}
          {hasComment && (
            <span title="Você comentou nesta obra" className="inline-flex items-center">
              <StickyNote className="size-3.5" />
            </span>
          )}
        </div>
        <div className="inline-flex items-stretch gap-4">
          <Metric label="Externa">
            {preview.platformAvg != null ? (
              <>
                <Star className="size-3 fill-amber-500 text-amber-500" />
                {preview.platformAvg.toFixed(1).replace(".", ",")}
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Metric>
          <Metric label="Votos">
            {preview.totalVotes > 0 ? (
              <>
                <Users className="size-3 text-muted-foreground/70" />
                {formatVotes(preview.totalVotes)}
              </>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Metric>
        </div>
      </div>
    </div>
  )
}

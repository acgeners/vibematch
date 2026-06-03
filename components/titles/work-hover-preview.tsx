"use client"

import { PublicationStatusBadge } from "@/components/ui/status-badge"
import { CoverImage } from "@/components/ui/cover-image"
import type { WorkPreview } from "@/server/actions/works"

interface WorkHoverPreviewProps {
  preview: WorkPreview
  anchorRect: DOMRect
}

function formatVotes(votes: number): string {
  if (votes === 0) return "—"
  if (votes < 1000) return String(votes)
  const k = Math.floor(votes / 100) / 10
  const formatted = k % 1 === 0 ? String(k) : k.toFixed(1).replace(".", ",")
  return `${formatted}K`
}

export function WorkHoverPreview({ preview, anchorRect }: WorkHoverPreviewProps) {
  const margin = 2
  const screenMargin = 8
  const popupWidth = 420
  const popupHeight = 240
  const willOverflowRight = anchorRect.right + margin + popupWidth > window.innerWidth
  const left = willOverflowRight
    ? Math.max(screenMargin, anchorRect.left - popupWidth - margin)
    : anchorRect.right + margin
  const top = Math.min(
    Math.max(screenMargin, anchorRect.top),
    window.innerHeight - popupHeight - screenMargin
  )

  return (
    <div
      className="fixed z-50 w-[420px] rounded-lg border bg-popover text-popover-foreground shadow-lg overflow-hidden pointer-events-none"
      style={{ left, top }}
    >
      <div className="flex gap-4 p-4">
        {preview.coverUrl ? (
          <div className="relative h-44 w-32 shrink-0 rounded-md overflow-hidden bg-muted">
            <CoverImage
              url={preview.coverUrl}
              className="h-full w-full object-cover"
            />
          </div>
        ) : (
          <div className="h-44 w-32 shrink-0 rounded-md bg-muted flex items-center justify-center text-xs text-muted-foreground">
            Sem capa
          </div>
        )}
        <div className="flex flex-col min-w-0 flex-1 h-44">
          <p className="font-semibold text-[15px] leading-tight line-clamp-2 shrink-0 break-words">{preview.title}</p>
          {(preview.year || preview.synopsisQuality || preview.publicationStatusId != null) && (
            <div className="flex items-center gap-1.5 flex-wrap text-xs font-medium text-foreground/70 mt-1.5 pb-1.5 shrink-0 border-b border-border/60">
              {[preview.year, preview.synopsisQuality].filter(Boolean).join(" · ") && (
                <span>{[preview.year, preview.synopsisQuality].filter(Boolean).join(" · ")}</span>
              )}
              {preview.publicationStatusId != null && (
                <>
                  {(preview.year || preview.synopsisQuality) && <span className="text-foreground/40">·</span>}
                  <PublicationStatusBadge statusId={preview.publicationStatusId} />
                </>
              )}
            </div>
          )}
          {preview.synopsis && (
            <div className="flex-1 min-h-0 overflow-hidden mt-2">
              <p className="text-[13px] italic text-muted-foreground line-clamp-6 break-words whitespace-normal leading-snug">{preview.synopsis}</p>
            </div>
          )}
        </div>
      </div>
      <div className="border-t px-4 py-2 flex items-center gap-3">
        {preview.observations ? (
          <p className="text-xs text-muted-foreground line-clamp-2 break-words whitespace-normal flex-1 min-w-0">{preview.observations}</p>
        ) : (
          <span className="flex-1" />
        )}
        <span className="text-xs shrink-0">
          <span className="text-muted-foreground">Nota média: </span>
          <span className="font-medium">
            {preview.platformAvg != null ? preview.platformAvg.toFixed(1).replace(".", ",") : "—"}
          </span>
          <span className="text-muted-foreground"> ({formatVotes(preview.totalVotes)})</span>
        </span>
      </div>
    </div>
  )
}

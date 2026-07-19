"use client"

import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, ImageIcon, X, ZoomIn } from "lucide-react"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import type { WorkCover } from "@/types/domain"

interface WorkCoverGalleryProps {
  title: string
  fallbackUrl?: string | null
  covers: WorkCover[]
}

export function WorkCoverGallery({ title, fallbackUrl, covers }: WorkCoverGalleryProps) {
  // Order: primary first, then by position. Fall back to the legacy single cover.
  const ordered = [...covers].sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
    return a.position - b.position
  })

  // Lista única de itens exibíveis (capa + rótulo de fonte), já cobrindo o caso
  // legado sem `work_covers` (só `fallbackUrl`).
  const items: { id: string; url: string; source: string | null }[] =
    ordered.length > 0
      ? ordered.map((c) => ({ id: c.id, url: c.url, source: c.source }))
      : fallbackUrl
        ? [{ id: "fallback", url: fallbackUrl, source: null }]
        : []

  const [activeIndex, setActiveIndex] = useState(0)
  const [lightboxOpen, setLightboxOpen] = useState(false)

  const hasMultiple = items.length > 1
  const safeIndex = items.length > 0 ? Math.min(activeIndex, items.length - 1) : 0
  const active = items[safeIndex]

  const go = (delta: number) => {
    if (items.length === 0) return
    setActiveIndex((i) => (i + delta + items.length) % items.length)
  }

  // Setas do teclado navegam no lightbox (Esc/clique-fora já vêm do Radix Dialog).
  useEffect(() => {
    if (!lightboxOpen || !hasMultiple) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault()
        go(-1)
      } else if (e.key === "ArrowRight") {
        e.preventDefault()
        go(1)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxOpen, hasMultiple, items.length])

  const sourceLabel = (s: string | null) => (s ? (PLATFORM_LABELS[s] ?? s) : null)

  return (
    <div className="flex flex-col gap-2">
      {/* Capa grande — clique abre o lightbox */}
      <div className="aspect-[2/3] overflow-hidden rounded-lg border bg-muted shadow-sm">
        {active ? (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="group relative block h-full w-full cursor-zoom-in"
            aria-label="Ampliar capa"
            title="Ampliar imagem"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getCoverImageSrc(active.url)}
              alt={`Capa de ${title}`}
              className="h-full w-full object-cover"
            />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-all group-hover:bg-black/30 group-hover:opacity-100">
              <ZoomIn className="h-8 w-8 text-white drop-shadow" />
            </span>
          </button>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-10 w-10" />
          </div>
        )}
      </div>

      {/* Miniaturas — clique seleciona e abre o lightbox naquela capa */}
      {hasMultiple && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((cover, i) => {
            const isActive = i === safeIndex
            return (
              <button
                key={cover.id}
                type="button"
                onClick={() => {
                  setActiveIndex(i)
                  setLightboxOpen(true)
                }}
                className={`relative h-16 w-12 cursor-zoom-in overflow-hidden rounded border transition-all ${
                  isActive
                    ? "border-primary ring-2 ring-primary/40"
                    : "border-muted opacity-70 hover:opacity-100"
                }`}
                title={sourceLabel(cover.source) ?? "Ampliar imagem"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getCoverImageSrc(cover.url)}
                  alt={cover.source ?? ""}
                  className="h-full w-full object-cover"
                />
                {cover.source && (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-1 text-center text-[8px] font-medium text-white">
                    {(sourceLabel(cover.source) ?? "").slice(0, 8)}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          className="w-fit max-w-[95vw] border-0 bg-transparent p-0 shadow-none sm:max-w-[95vw]"
        >
          <DialogTitle className="sr-only">{`Capa de ${title}`}</DialogTitle>
          {active && (
            <div className="relative flex flex-col items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={getCoverImageSrc(active.url)}
                alt={`Capa de ${title}`}
                className="max-h-[85vh] w-auto max-w-full rounded-lg object-contain shadow-2xl"
              />

              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="absolute right-2 top-2 z-10 rounded-full bg-black/50 p-1.5 text-white transition hover:bg-black/70"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>

              {hasMultiple && (
                <>
                  <button
                    type="button"
                    onClick={() => go(-1)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
                    aria-label="Capa anterior"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    onClick={() => go(1)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
                    aria-label="Próxima capa"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                </>
              )}

              {(sourceLabel(active.source) || hasMultiple) && (
                <div className="flex items-center gap-2 text-xs text-white/90">
                  {sourceLabel(active.source) && (
                    <span className="rounded bg-black/60 px-2 py-0.5 font-medium">
                      {sourceLabel(active.source)}
                    </span>
                  )}
                  {hasMultiple && (
                    <span className="rounded bg-black/60 px-2 py-0.5 tabular-nums">
                      {safeIndex + 1} / {items.length}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

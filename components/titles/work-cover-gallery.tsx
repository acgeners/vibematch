"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, ImageIcon, Maximize2, X, ZoomIn } from "lucide-react"
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
  const railRef = useRef<HTMLDivElement | null>(null)
  // Dimensões reais, medidas no navegador quando a imagem termina de carregar —
  // `work_covers` não guarda largura/altura, e medir aqui não custa requisição.
  const [dims, setDims] = useState<Record<string, { w: number; h: number }>>({})

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

  // Navegar pelas setas pode levar a uma miniatura fora da parte visível da
  // tira; trazê-la de volta mantém a posição atual sempre à vista.
  useEffect(() => {
    if (!lightboxOpen) return
    const el = railRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: "nearest", inline: "center" })
  }, [lightboxOpen, safeIndex])

  const sourceLabel = (s: string | null) => (s ? (PLATFORM_LABELS[s] ?? s) : null)

  return (
    <div className="flex flex-col gap-2">
      {/* Capa grande — clique abre a imagem completa */}
      <div className="aspect-[2/3] overflow-hidden rounded-lg border bg-muted shadow-sm">
        {active ? (
          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            className="group relative block h-full w-full cursor-zoom-in"
            aria-label="Ver imagem completa"
            title="Ver imagem completa"
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

      {/* Link explícito para a imagem completa — a lupa da capa só aparece no
          hover, que não existe no toque. */}
      {active && (
        <button
          type="button"
          onClick={() => setLightboxOpen(true)}
          className="inline-flex items-center justify-center gap-1.5 text-xs text-primary hover:underline"
        >
          <Maximize2 className="h-3 w-3" />
          Ver imagem completa
        </button>
      )}

      {/* Miniaturas — clique só troca a capa exibida acima (padrão Amazon).
          Abrir o lightbox daqui era o bug: com ele aberto, a miniatura fica
          atrás do overlay do Dialog e o Radix trata o clique como clique-fora. */}
      {hasMultiple && (
        /* Grade de 5 colunas: a miniatura se ajusta à largura da sidebar. Com
           largura fixa (48px) a 5ª estourava a linha e caía sozinha embaixo. */
        <div className="grid grid-cols-5 gap-1.5">
          {items.map((cover, i) => {
            const isActive = i === safeIndex
            return (
              <button
                key={cover.id}
                type="button"
                onClick={() => setActiveIndex(i)}
                aria-current={isActive}
                className={`relative aspect-[2/3] cursor-pointer overflow-hidden rounded transition-all ${
                  isActive
                    ? "ring-2 ring-primary"
                    : "opacity-70 ring-1 ring-border hover:opacity-100"
                }`}
                title={sourceLabel(cover.source) ?? "Ver esta capa"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getCoverImageSrc(cover.url)}
                  alt={cover.source ?? ""}
                  className="h-full w-full object-cover"
                />
                {cover.source && (
                  <span className="absolute inset-x-0 bottom-0 truncate bg-black/70 px-0.5 text-center text-[7px] font-medium text-white">
                    {(sourceLabel(cover.source) ?? "").slice(0, 7)}
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
          overlayClassName="bg-black/70 backdrop-blur-[8px]"
        >
          <DialogTitle className="sr-only">{`Capa de ${title}`}</DialogTitle>
          {active && (
            /* Moldura de tamanho FIXO: a imagem se encaixa dentro dela em vez de
               ditá-lo. Sem isto, cada capa de proporção diferente redimensiona o
               diálogo e a tira/legenda saltam de lugar a cada navegação. */
            <div className="relative flex h-[82vh] w-[min(92vw,880px)] flex-col items-center gap-3">
              <div className="flex min-h-0 w-full flex-1 items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={active.id}
                  src={getCoverImageSrc(active.url)}
                  alt={`Capa de ${title}`}
                  onLoad={(e) => {
                    const img = e.currentTarget
                    if (!img.naturalWidth) return
                    setDims((prev) =>
                      prev[active.id]
                        ? prev
                        : { ...prev, [active.id]: { w: img.naturalWidth, h: img.naturalHeight } },
                    )
                  }}
                  className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
                />
              </div>

              <button
                type="button"
                onClick={() => setLightboxOpen(false)}
                className="absolute right-0 top-0 z-10 rounded-full bg-black/50 p-1.5 text-white transition hover:bg-black/70"
                aria-label="Fechar"
              >
                <X className="h-5 w-5" />
              </button>

              {hasMultiple && (
                <>
                  <button
                    type="button"
                    onClick={() => go(-1)}
                    className="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
                    aria-label="Capa anterior"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>
                  <button
                    type="button"
                    onClick={() => go(1)}
                    className="absolute right-0 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/50 p-2 text-white transition hover:bg-black/70"
                    aria-label="Próxima capa"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>
                </>
              )}

              <div className="flex shrink-0 items-center gap-2 text-xs text-white/90">
                {sourceLabel(active.source) && (
                  <span className="rounded bg-black/60 px-2 py-0.5 font-medium">
                    {sourceLabel(active.source)}
                  </span>
                )}
                <span className="rounded bg-black/60 px-2 py-0.5 tabular-nums">
                  {dims[active.id]
                    ? `${dims[active.id].w} × ${dims[active.id].h}`
                    : "medindo…"}
                </span>
                {hasMultiple && (
                  <span className="rounded bg-black/60 px-2 py-0.5 tabular-nums">
                    {safeIndex + 1} / {items.length}
                  </span>
                )}
              </div>

              {/* Tira de miniaturas — pular direto para uma capa, sem passar
                  pelas do meio uma a uma. */}
              {hasMultiple && (
                <div ref={railRef} className="w-full shrink-0 overflow-x-auto pb-1">
                  <div className="mx-auto flex w-max gap-2 px-1">
                    {items.map((cover, i) => {
                      const isActive = i === safeIndex
                      return (
                        <button
                          key={cover.id}
                          type="button"
                          data-active={isActive}
                          aria-current={isActive}
                          onClick={() => setActiveIndex(i)}
                          title={sourceLabel(cover.source) ?? "Ver esta capa"}
                          className={`h-16 w-12 shrink-0 cursor-pointer overflow-hidden rounded transition ${
                            isActive
                              ? "opacity-100 ring-2 ring-white"
                              : "opacity-60 ring-1 ring-white/30 hover:opacity-100"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={getCoverImageSrc(cover.url)}
                            alt={cover.source ?? ""}
                            className="h-full w-full object-cover"
                          />
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

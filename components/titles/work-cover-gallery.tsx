"use client"

import { useState } from "react"
import { ImageIcon } from "lucide-react"
import { PLATFORM_LABELS } from "@/lib/constants/criteria"
import { getCoverImageSrc } from "@/lib/image-proxy"
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
  const initialUrl = ordered.find((c) => c.is_primary)?.url ?? ordered[0]?.url ?? fallbackUrl ?? null
  const [activeUrl, setActiveUrl] = useState<string | null>(initialUrl)

  return (
    <div className="flex flex-col gap-2">
      <div className="aspect-[2/3] overflow-hidden rounded-lg border bg-muted shadow-sm">
        {activeUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={getCoverImageSrc(activeUrl)} alt={`Capa de ${title}`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageIcon className="h-10 w-10" />
          </div>
        )}
      </div>

      {ordered.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {ordered.map((cover) => {
            const isActive = cover.url === activeUrl
            return (
              <button
                key={cover.id}
                type="button"
                onClick={() => setActiveUrl(cover.url)}
                className={`relative h-16 w-12 overflow-hidden rounded border transition-all ${
                  isActive
                    ? "border-primary ring-2 ring-primary/40"
                    : "border-muted opacity-70 hover:opacity-100"
                }`}
                title={PLATFORM_LABELS[cover.source] ?? cover.source}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={getCoverImageSrc(cover.url)} alt={cover.source} className="h-full w-full object-cover" />
                <span className="absolute inset-x-0 bottom-0 bg-black/70 px-1 text-[8px] font-medium text-white truncate text-center">
                  {(PLATFORM_LABELS[cover.source] ?? cover.source).slice(0, 8)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

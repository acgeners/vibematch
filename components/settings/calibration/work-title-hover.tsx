"use client"

import { useState } from "react"
import Link from "next/link"
import { ExternalLink, Heart, ImageOff, Star } from "lucide-react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"

interface WorkTitleHoverProps {
  title: string
  href: string
  coverUrl?: string | null
  userScore?: number | null
  isFavorite?: boolean
  year?: number | null
  totalChapters?: number | null
  publicationStatusId?: number | null
}

/**
 * Título da obra na fila de calibração + prévia dos dados da obra ao passar o
 * mouse. O conteúdo é portalado (escapa do `overflow-hidden` do card) e monta só
 * no hover. Dados escalares leves vindos do join de `loadSuggestions`; a capa é
 * a URL primária já colapsada no server (1 string por linha, não o array).
 */
export function WorkTitleHover({
  title,
  href,
  coverUrl,
  userScore,
  isFavorite,
  year,
  totalChapters,
  publicationStatusId,
}: WorkTitleHoverProps) {
  const [imgFailed, setImgFailed] = useState(false)
  const pub = publicationStatusId != null ? PUBLICATION_STATUSES_BY_ID[publicationStatusId] : undefined
  const meta = [year ?? undefined, totalChapters ? `${totalChapters} caps` : undefined]
    .filter(Boolean)
    .join(" · ")
  const showCover = coverUrl && !imgFailed

  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>
        <Link
          href={href}
          className="line-clamp-1 text-sm font-medium decoration-dotted underline-offset-2 hover:underline"
        >
          {title}
        </Link>
      </HoverCardTrigger>
      <HoverCardContent className="w-80">
        <div className="flex gap-3">
          <div className="relative h-[76px] w-[54px] shrink-0 overflow-hidden rounded-md bg-gradient-to-br from-violet-500/40 to-cyan-500/40 ring-1 ring-border/60">
            {showCover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverUrl}
                alt=""
                loading="lazy"
                onError={() => setImgFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <ImageOff className="absolute left-1/2 top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-white/70" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold leading-snug">{title}</p>
              <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            </div>
            {(pub || meta) && (
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {[pub?.status, meta].filter(Boolean).join(" · ")}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {userScore != null ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                  <Star className="size-3 fill-current" />
                  <span className="tabular-nums">nota {userScore.toFixed(1)}</span>
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  sem nota pessoal
                </span>
              )}
              {isFavorite && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                  <Heart className="size-3 fill-current" />
                  favorita
                </span>
              )}
            </div>
          </div>
        </div>
        <p className="mt-2.5 text-[11px] text-muted-foreground">Abrir a página da obra →</p>
      </HoverCardContent>
    </HoverCard>
  )
}

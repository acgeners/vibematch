"use client"

import { useState } from "react"
import Image from "next/image"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { cn } from "@/lib/utils"

/**
 * Thumb de capa (aspect 2:3 de manga) com fallback. Quando a URL falha
 * (link morto, hotlink bloqueado, CDN fora), mostra o placeholder "—" em vez
 * do ícone de imagem quebrada do browser. Usado nos cards das filas de
 * /ai-evaluation (atributos e IA Rk).
 */
export function CoverThumb({
  url,
  className,
}: {
  url: string | null | undefined
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  return (
    <div
      className={cn(
        "relative h-36 w-24 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted shadow-sm",
        className,
      )}
    >
      {url && !failed ? (
        <Image
          src={getCoverImageSrc(url)}
          alt=""
          fill
          sizes="96px"
          unoptimized
          className="object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          —
        </div>
      )}
    </div>
  )
}

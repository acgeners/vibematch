"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { cn } from "@/lib/utils"

/**
 * Thumb de capa (aspect 2:3 de manga) com fallback. Aceita uma capa única
 * (`url`) ou várias candidatas (`urls`, primária primeiro): ao falhar uma
 * (link morto, hotlink bloqueado, CDN fora), tenta a próxima automaticamente.
 * Só mostra o placeholder "—" quando TODAS falham. Usado nos cards das filas de
 * /curation/works (atributos, IA Rk, Interesse Sinopse).
 */
export function CoverThumb({
  url,
  urls,
  className,
}: {
  url?: string | null | undefined
  /** Candidatas em ordem de preferência (primária primeiro). Tem prioridade sobre `url`. */
  urls?: (string | null | undefined)[]
  className?: string
}) {
  const candidates = useMemo(() => {
    const raw = urls && urls.length > 0 ? urls : url != null ? [url] : []
    const seen = new Set<string>()
    const out: string[] = []
    for (const u of raw) {
      if (!u) continue
      const src = getCoverImageSrc(u)
      if (src && !seen.has(src)) {
        seen.add(src)
        out.push(src)
      }
    }
    return out
  }, [urls, url])

  // Índice da candidata atual; avança no onError. Os cards são keyed por work_id
  // no parent, então trocar de obra remonta o componente e zera o índice.
  const [idx, setIdx] = useState(0)
  const src = candidates[idx]

  return (
    <div
      className={cn(
        "relative h-36 w-24 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted shadow-sm",
        className,
      )}
    >
      {src ? (
        <Image
          key={src}
          src={src}
          alt=""
          fill
          sizes="96px"
          unoptimized
          className="object-cover"
          onError={() => setIdx((i) => i + 1)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
          —
        </div>
      )}
    </div>
  )
}

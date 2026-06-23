"use client"
/* eslint-disable @next/next/no-img-element -- ponto único de <img> de capa, com fallback/proxy próprios; next/image não cabe (urls externas variadas + unoptimized) */

import { useMemo, useState } from "react"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { cn } from "@/lib/utils"

/**
 * Capa de obra com tratamento de erro embutido: roteia hosts problemáticos pelo
 * proxy (`getCoverImageSrc`), e ao falhar uma imagem (link morto, hotlink
 * bloqueado, CDN fora) tenta a próxima candidata; quando todas falham, mostra um
 * placeholder "—" em vez do ícone de imagem quebrada do browser.
 *
 * Drop-in pros `<img>` de capa espalhados pelo app. Passe `url` (capa única) ou
 * `urls` (várias, primária primeiro) pra habilitar o fallback entre capas.
 */
export function CoverImage({
  url,
  urls,
  alt = "",
  className,
  loading = "lazy",
}: {
  url?: string | null | undefined
  /** Candidatas em ordem de preferência (primária primeiro). Tem prioridade sobre `url`. */
  urls?: (string | null | undefined)[]
  alt?: string
  className?: string
  loading?: "lazy" | "eager"
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

  // Avança no onError; cards keyed por work_id no parent remontam ao trocar de obra.
  const [idx, setIdx] = useState(0)
  const src = candidates[idx]

  if (!src) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted text-[11px] text-muted-foreground",
          className,
        )}
        aria-hidden
      >
        —
      </div>
    )
  }

  return (
    <img
      key={src}
      src={src}
      alt={alt}
      loading={loading}
      // Decode fora da main thread — ganho nas views com dezenas de capas (grid/ranking),
      // sem risco de CLS: o espaço já é reservado pelo container/className do caller.
      decoding="async"
      className={className}
      onError={() => setIdx((i) => i + 1)}
    />
  )
}

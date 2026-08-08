import { Heart } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Tons dos corações de Interesse na obra, em UM lugar só: manual em rosa, previsão
 * da IA em laranja. É a mesma paleta do `SynopsisQualityPicker` — que importa daqui,
 * pra que o valor editável e o exibido nunca discordem de cor no mesmo bloco.
 */
export const HEART_TONE = {
  manual: {
    filled: "fill-rose-500 text-rose-500",
    empty: "fill-transparent text-rose-300 dark:text-rose-400/40",
    glyph: "text-red-500",
  },
  pred: {
    filled: "fill-orange-500 text-orange-500",
    empty: "fill-transparent text-orange-300 dark:text-orange-400/40",
    glyph: "text-orange-500",
  },
} as const

export type HeartVariant = keyof typeof HEART_TONE

/**
 * Corações de Interesse na obra — manual em rosa, previsão da IA em laranja.
 * `quality` é a string de corações (ex.: "♥♥♥"); rende sempre a escala cheia de 4
 * (n preenchidos + resto vazio).
 *
 * ⚠️ Dois modos, e a diferença é DENSIDADE, não estilo:
 *  - `glyph` (padrão) — o caractere ♥, compacto. É o de listas densas (/ranking,
 *    cards, hover), onde 200 linhas de ícone SVG pesam e o glifo alinha com o texto.
 *  - `icon` — o `Heart` do lucide, do mesmo tamanho e ritmo dos corações CLICÁVEIS do
 *    `SynopsisQualityPicker`. É o de bloco, onde um valor exibido aparece ao lado de
 *    um editável: em `glyph` os dois ficavam visivelmente diferentes lado a lado.
 */
export function QualityHearts({
  quality,
  variant = "manual",
  showEmpty = true,
  render = "glyph",
  className,
}: {
  quality: string
  variant?: HeartVariant
  /** Mostra a escala cheia de 4 (n preenchidos + resto apagado). Em `false` mostra
   *  só o número EXATO de corações, todos coloridos (chips de filtro). */
  showEmpty?: boolean
  /** `icon` = SVG do lucide (igual ao picker); `glyph` = caractere ♥ (compacto). */
  render?: "glyph" | "icon"
  className?: string
}) {
  const tone = HEART_TONE[variant]
  const filled = Math.min(4, Math.max(0, [...quality].length))
  const empty = showEmpty ? 4 - filled : 0

  if (render === "icon") {
    return (
      <span className={cn("inline-flex items-center gap-1", className)}>
        {Array.from({ length: filled + empty }, (_, i) => (
          <Heart key={i} className={cn("h-4 w-4 shrink-0", i < filled ? tone.filled : tone.empty)} />
        ))}
      </span>
    )
  }

  return (
    <span className={cn("leading-none tracking-[0.12em]", tone.glyph, className)}>
      {"♥".repeat(filled)}
      {empty > 0 && <span className="opacity-25">{"♥".repeat(empty)}</span>}
    </span>
  )
}

import { Tag, MessageSquare } from "lucide-react"

/**
 * Badges compactos de nº de tags e nº de reviews ÚTEIS (≥40 chars) de uma obra.
 * Usados nos cards das abas IA atributos e Veredito IA. Renderiza nada quando
 * ambas as contagens estão ausentes (ex.: aba sem hidratação).
 */
export function CountBadges({
  tagCount,
  reviewCount,
}: {
  tagCount?: number | null
  reviewCount?: number | null
}) {
  if (tagCount == null && reviewCount == null) return null
  return (
    <>
      <span
        title="Tags da obra"
        className="inline-flex items-center gap-1 rounded-full border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground"
      >
        <Tag className="h-3 w-3" />
        {tagCount ?? 0}
      </span>
      <span
        title="Reviews úteis (≥40 caracteres)"
        className="inline-flex items-center gap-1 rounded-full border border-border/70 px-1.5 py-0.5 text-[11px] text-muted-foreground"
      >
        <MessageSquare className="h-3 w-3" />
        {reviewCount ?? 0}
      </span>
    </>
  )
}

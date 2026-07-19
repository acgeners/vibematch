import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Selo "🔞 18+" — indicador de conteúdo adulto nos cards das obras. Mesmo
 * tratamento visual do chip da página da obra (app/titles/[id]/page.tsx), só que
 * dimensionado pelo `Badge` base pra alinhar com os badges de status vizinhos
 * (PublicationStatusBadge/PersonalStatusBadge) em cada card.
 *
 * Só deve ser renderizado quando `works.is_adult` é true. Quem optou por ocultar
 * 18+ nem chega aqui — a obra é filtrada no servidor (getRanking etc.), então o
 * selo aparece apenas pra quem escolheu ver conteúdo adulto.
 *
 * Passe `className` pra casar o tamanho do vizinho quando o card usa badges
 * compactos (ex.: no /ranking, `className="px-1.5 py-0 text-[10px]"`).
 */
export function AdultBadge({
  className,
  iconOnly = false,
}: {
  className?: string
  /** Mostra só o 🔞 (sem "18+"), pra clusters muito apertados. */
  iconOnly?: boolean
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 border-red-500/40 bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-200",
        className,
      )}
      title="Conteúdo adulto (18+)"
    >
      <span aria-hidden>🔞</span>
      {!iconOnly && "18+"}
    </Badge>
  )
}

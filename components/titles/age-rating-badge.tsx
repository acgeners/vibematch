import { AGE_RATING_LABEL, ageRatingExplanation } from "@/lib/age-rating/age-rating"
import type { AgeRatingView } from "@/lib/age-rating/age-rating"
import { cn } from "@/lib/utils"

/**
 * Selo de classificação etária ao lado do título. A regra (o que é exibido para cada versão) é de
 * `ageRatingFor`; aqui só o desenho. Texto visível em vez de só cor — e o porquê no `title`.
 */
export function AgeRatingBadge({ view, className }: { view: AgeRatingView; className?: string }) {
  const texto = view.faixa == null ? "Sem classificação" : `Classificação ${AGE_RATING_LABEL[view.faixa].toLowerCase()}`
  return (
    <span
      data-testid="age-rating-badge"
      data-faixa={view.faixa ?? "sem"}
      title={ageRatingExplanation(view)}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold",
        view.faixa == null ? "border-border/60 text-muted-foreground" : "border-border text-foreground",
        className,
      )}
    >
      {texto}
      {view.pendente && <span className="text-xs font-normal text-muted-foreground">(em revisão)</span>}
    </span>
  )
}

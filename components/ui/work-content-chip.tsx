import { AdultBadge } from "@/components/ui/adult-badge"
import { Badge } from "@/components/ui/badge"
import { workContentBadge } from "@/lib/editions/mixed-edition"
import { cn } from "@/lib/utils"

/** Cor do selo de versão — a mesma no cabeçalho da obra (`EditionNoteBadge`) e nas listas. */
export const EDITION_BADGE_TONE =
  "border-transparent bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-500/30 dark:bg-sky-950/30 dark:text-sky-200"

/**
 * O chip de conteúdo das LISTAS e CARDS: a MESMA decisão do cabeçalho da obra (`workContentBadge`) —
 * mixed ⇒ "R19" (versão adulta alternativa, nunca "18+"), adulta sem versão mais leve ⇒ "🔞 18+",
 * demais ⇒ nada. Só o selo: filtro e ocultação seguem `is_adult` / `r19_edition`, nunca isto.
 * `className` casa o tamanho dos badges vizinhos de cada card.
 */
export function WorkContentChip({
  isAdult,
  isMixed,
  className,
}: {
  isAdult: boolean
  isMixed: boolean
  className?: string
}) {
  const badge = workContentBadge({ isMixed, isAdult })
  if (badge === "adult") return <AdultBadge className={className} />
  if (badge === "r19_edition") return <R19EditionChip className={className} />
  return null
}

/** O texto completo do selo de versão — vai no `title` do chip curto. */
export const R19_EDITION_TITLE = "Versão R19 disponível — esta obra tem uma versão normal e uma versão R18"

/** "ℹ️ R19" — o selo de versão no tamanho do chip "18+" (o texto completo fica no `title`). */
export function R19EditionChip({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("gap-1", EDITION_BADGE_TONE, className)} title={R19_EDITION_TITLE}>
      <span aria-hidden>ℹ️</span>
      <span className="sr-only">Versão </span>R19<span className="sr-only"> disponível</span>
    </Badge>
  )
}

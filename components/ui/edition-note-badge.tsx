"use client"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { EDITION_BADGE_TONE } from "@/components/ui/work-content-chip"

/**
 * Selo "ℹ️ Edição R19 disponível" — informativo, NÃO um aviso de conteúdo.
 * Distinto do `AdultBadge` (🔞) de propósito: uma obra pode ter isto sem ser
 * `is_adult` (edição catalogada é limpa, a alternativa é que é adulta), e
 * pode ser `is_adult` sem ter isto (a própria obra já é a edição explícita).
 * Quem decide se ele aparece é o estado de edição (`workContentBadge`, lib/editions/mixed-edition.ts).
 *
 * Cor por bg/text, não por `border-<cor>` — utilities de cor de borda não
 * funcionam neste app (globals.css reseta fora de @layer); usa `ring` pro
 * contorno.
 */
export function EditionNoteBadge({ className }: { className?: string }) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn("gap-1", EDITION_BADGE_TONE, className)}
          >
            <span aria-hidden>ℹ️</span>
            Versão R19 disponível
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          Esta obra tem uma versão R15 e uma R19. Por isso ela aparece no filtro &quot;Só 18+&quot; e não é
          ocultada para quem esconde conteúdo adulto.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

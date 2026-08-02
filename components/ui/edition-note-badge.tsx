"use client"

import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Selo "ℹ️ Edição R19 disponível" — informativo, NÃO um aviso de conteúdo.
 * Distinto do `AdultBadge` (🔞) de propósito: uma obra pode ter isto sem ser
 * `is_adult` (edição catalogada é limpa, a alternativa é que é adulta), e
 * pode ser `is_adult` sem ter isto (a própria obra já é a edição explícita).
 * Ver lib/tags/edition-note-tags.ts pras tags que acionam este selo.
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
            className={cn(
              "gap-1 border-transparent bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-500/30 dark:bg-sky-950/30 dark:text-sky-200",
              className,
            )}
          >
            <span aria-hidden>ℹ️</span>
            Edição R19 disponível
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">
          Existe uma versão R19/não-censurada desta obra em outra fonte. Isto NÃO significa que os dados
          cadastrados aqui são explícitos — se forem, a obra também leva o selo 🔞.
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

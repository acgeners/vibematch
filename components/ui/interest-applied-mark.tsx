"use client"

import { Sparkles } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/**
 * Selo ✨ ao lado dos corações de Interesse na Obra manual quando o valor foi
 * APLICADO da previsão da IA (`synopsis_quality_source === "prediction_applied"`),
 * e não definido à mão. Mantém a paleta rosa (família do manual) e reaproveita o
 * glifo Sparkles que já significa "IA" no app. Some quando você confirma à mão.
 */
export function InterestAppliedMark({
  size = 12,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn("inline-flex cursor-help items-center align-middle text-rose-400", className)}
            aria-label="Interesse aplicado da previsão da IA — ainda não confirmado à mão"
          >
            <Sparkles style={{ width: size, height: size }} strokeWidth={2.5} aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent>Aplicado da previsão da IA — você ainda não confirmou à mão.</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

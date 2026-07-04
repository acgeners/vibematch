"use client"

import type { ReactNode } from "react"
import { AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { InputConfidenceSeal } from "./input-confidence-seal"
import type { UiReadiness } from "@/lib/orchestration/ui-readiness"

/**
 * Envolve o botão de um gerador com os 3 níveis de aviso de prontidão:
 *   - block  → o botão fica desabilitado (o CALLER passa `disabled={!ready}`) e
 *              ganha um tooltip com o que falta + a instrução;
 *   - importa → alerta âmbar abaixo do botão ("pode sair fraco: falta X");
 *   - ajuda  → só o selo de confiança (InputConfidenceSeal).
 *
 * O gate NÃO força o disable do filho (não dá pra injetar `disabled` num nó
 * arbitrário de forma robusta): quem renderiza o botão passa `disabled` a partir
 * de `readiness.ready`. O gate cuida do tooltip/âmbar/selo.
 */
export function GenerationGate({
  readiness,
  children,
  showSeal = true,
  stretch = false,
  className,
}: {
  readiness: UiReadiness
  children: ReactNode
  showSeal?: boolean
  /** Filhos ocupam a largura toda (trilhos de ação); default = largura natural. */
  stretch?: boolean
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", stretch ? "items-stretch" : "items-start", className)}>
      {readiness.ready ? (
        children
      ) : (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            {/* span-trigger: o botão desabilitado não dispara eventos de hover;
                o span por fora garante que o tooltip apareça. */}
            <TooltipTrigger asChild>
              <span className={cn("inline-flex cursor-not-allowed", stretch && "w-full")}>{children}</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-left leading-relaxed">
              <p className="font-semibold">
                Falta {readiness.blocking.map((b) => b.label).join(", ")}
              </p>
              {readiness.blocking[0]?.instruction && (
                <p className="mt-0.5 text-xs opacity-90">{readiness.blocking[0].instruction}</p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {readiness.ready && readiness.weakening.length > 0 && (
        <p className="inline-flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] leading-snug text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>Pode sair fraco: falta {readiness.weakening.map((w) => w.label).join(", ")}.</span>
        </p>
      )}

      {showSeal && readiness.ready && (
        <InputConfidenceSeal readiness={readiness} className="self-start" />
      )}
    </div>
  )
}

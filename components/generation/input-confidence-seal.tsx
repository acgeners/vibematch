"use client"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import type { InputConfidence, UiReadiness } from "@/lib/orchestration/ui-readiness"

const TONE: Record<InputConfidence, string> = {
  alta: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300",
  média: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
  baixa: "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-300",
}

/**
 * Selo "confiança dos inputs" (alta/média/baixa). Agrega todo opcional ausente
 * num sinal só — o hover lista o que melhoraria a geração. Não interrompe nada
 * (o bloqueio/âmbar são do GenerationGate); é sempre passivo.
 */
export function InputConfidenceSeal({
  readiness,
  className,
}: {
  readiness: UiReadiness
  className?: string
}) {
  const missing = [...readiness.weakening, ...readiness.softMissing]
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex cursor-default items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold",
              TONE[readiness.confidence],
              className,
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" aria-hidden />
            Inputs: {readiness.confidence}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-left leading-relaxed">
          {missing.length === 0 ? (
            <span>Todos os inputs presentes.</span>
          ) : (
            <div className="space-y-1">
              <p className="font-semibold">Melhora a confiança:</p>
              {missing.map((m) => (
                <p key={m.dataKey} className="text-xs">
                  + {m.label}
                  {m.hint ? ` — ${m.hint}` : ""}
                </p>
              ))}
            </div>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

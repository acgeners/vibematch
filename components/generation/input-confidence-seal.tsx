"use client"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { STATUS_CHIP_BASE, STATUS_TONE } from "@/lib/ui/status-tone"
import type { StatusTone } from "@/lib/ui/status-tone"
import type { InputConfidence, UiReadiness } from "@/lib/orchestration/ui-readiness"

/**
 * ⚠️ **A confiança dos inputs deixou de disputar cor com "desatualizado" (2026-08-12).**
 *
 * O nível médio era âmbar — a mesma cor de "Desatualizado" no Veredito e de "Previsão
 * desatualizada" logo ao lado, no MESMO card do Interesse. Só que este selo é passivo:
 * ele não pede ação nenhuma, só qualifica o que entrou. Quem pede ação ficou com o
 * âmbar sozinho (`lib/ui/status-tone.ts`), e o nível daqui passou a ser dito pela
 * FORMA — três pontos, dos quais N acesos —, com cor apenas nos extremos.
 */
const LEVEL: Record<InputConfidence, { tone: StatusTone; filled: number }> = {
  alta: { tone: "ok", filled: 3 },
  média: { tone: "absent", filled: 2 },
  baixa: { tone: "failed", filled: 1 },
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
  const level = LEVEL[readiness.confidence]
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              STATUS_CHIP_BASE,
              "cursor-default",
              STATUS_TONE[level.tone].chip,
              className,
            )}
          >
            <span className="flex items-center gap-[3px]" aria-hidden>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1.5 w-1.5 rounded-full bg-current",
                    i < level.filled ? "opacity-90" : "opacity-25",
                  )}
                />
              ))}
            </span>
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

"use client"

import { useSyncExternalStore } from "react"
import { Layers, Target } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  readAttrColorMode,
  subscribeAttrColorMode,
  writeAttrColorMode,
} from "@/lib/ui/attr-color-mode"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { AttrColorScaleInfo } from "@/components/titles/attr-color-scale-info"

/**
 * Toggle de como colorir as notas de atributo: percentil no catálogo vs.
 * distância à faixa ideal do perfil. Só faz sentido quando há perfil com
 * faixas — o pai esconde quando não há (`criterion_preferences` vazio).
 * A explicação completa (legenda de cor) vive no `AttrColorScaleInfo` ao lado.
 */
export function AttrColorModeToggle() {
  const mode = useSyncExternalStore(subscribeAttrColorMode, readAttrColorMode, () => "catalog" as const)
  return (
    <TooltipProvider delayDuration={200}>
      <div className="inline-flex items-center rounded-md border border-border/70 bg-background/60 p-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => writeAttrColorMode("catalog")}
              aria-label="Colorir por percentil no catálogo"
              aria-pressed={mode === "catalog"}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
                mode === "catalog" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              Catálogo
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[220px] text-center">
            Cor = quão <strong>alta</strong> a nota é dentro do catálogo
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => writeAttrColorMode("range")}
              aria-label="Colorir pela minha faixa ideal"
              aria-pressed={mode === "range"}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
                mode === "range" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Target className="h-3.5 w-3.5" />
              Minha faixa
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-[220px] text-center">
            Cor = quão dentro da <strong>sua faixa ideal</strong> a nota está
          </TooltipContent>
        </Tooltip>
        <span className="mx-0.5 h-4 w-px bg-border/70" aria-hidden="true" />
        <AttrColorScaleInfo />
      </div>
    </TooltipProvider>
  )
}

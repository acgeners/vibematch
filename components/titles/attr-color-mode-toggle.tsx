"use client"

import { useSyncExternalStore } from "react"
import { Layers, Target } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  readAttrColorMode,
  subscribeAttrColorMode,
  writeAttrColorMode,
} from "@/lib/ui/attr-color-mode"

/**
 * Toggle de como colorir as notas de atributo: percentil no catálogo vs.
 * distância à faixa ideal do perfil. Só faz sentido quando há perfil com
 * faixas — o pai esconde quando não há (`criterion_preferences` vazio).
 */
export function AttrColorModeToggle() {
  const mode = useSyncExternalStore(subscribeAttrColorMode, readAttrColorMode, () => "catalog" as const)
  return (
    <div className="inline-flex items-center rounded-md border border-border/70 bg-background/60 p-0.5">
      <button
        type="button"
        onClick={() => writeAttrColorMode("catalog")}
        aria-label="Colorir por percentil no catálogo"
        aria-pressed={mode === "catalog"}
        title="Cor = quão alta a nota é dentro do catálogo"
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
          mode === "catalog" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Layers className="h-3.5 w-3.5" />
        Catálogo
      </button>
      <button
        type="button"
        onClick={() => writeAttrColorMode("range")}
        aria-label="Colorir pela minha faixa ideal"
        aria-pressed={mode === "range"}
        title="Cor = quão dentro da sua faixa ideal a nota está"
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
          mode === "range" ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Target className="h-3.5 w-3.5" />
        Minha faixa
      </button>
    </div>
  )
}

"use client"

import { useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { Info, Layers, Target } from "lucide-react"
import { cn } from "@/lib/utils"
import { readAttrColorMode, subscribeAttrColorMode } from "@/lib/ui/attr-color-mode"
import { criterionTierPillClass } from "@/components/ui/score-badge"
import type { AttrColorMode, CriterionTier } from "@/components/ui/score-badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * Botão (ⓘ) ao lado do `AttrColorModeToggle` que abre um popover explicando o
 * que as cores das notas de atributo significam. A legenda é CONTEXTUAL: muda
 * conforme o modo ativo (percentil no catálogo vs. distância à faixa ideal).
 * Reusa a paleta real das células via `criterionTierPillClass`.
 */

interface LegendRow {
  tier: CriterionTier
  label: string
  hint?: string
}

const LEGEND: Record<AttrColorMode, { sub: string; rows: LegendRow[] }> = {
  catalog: {
    sub: "A cor mostra quão alta a nota é dentro de todo o catálogo.",
    rows: [
      { tier: "top", label: "Top do catálogo" },
      { tier: "high", label: "Acima da média" },
      { tier: "mid", label: "Mediano" },
      { tier: "bottom", label: "No fundo", hint: "drama/tragédia altos entram aqui" },
    ],
  },
  range: {
    sub: "A cor mostra quão perto a nota está da sua faixa ideal (do seu perfil de gosto).",
    rows: [
      { tier: "top", label: "No coração da sua faixa" },
      { tier: "high", label: "Dentro da sua faixa" },
      { tier: "mid", label: "Perto", hint: "a ±1 da faixa" },
      { tier: "low", label: "Longe", hint: "a ±2,5 da faixa" },
      { tier: "bottom", label: "Bem fora" },
      { tier: "neutral", label: "Critério que você ignora" },
    ],
  },
}

export function AttrColorScaleInfo() {
  const mode = useSyncExternalStore(
    subscribeAttrColorMode,
    readAttrColorMode,
    () => "catalog" as const,
  )
  const legend = LEGEND[mode]

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="O que significam as cores das notas?"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 data-[state=open]:bg-muted/60 data-[state=open]:text-primary"
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <p className="text-sm font-semibold">Cor das notas dos atributos</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{legend.sub}</p>

        <div className="mt-3 grid gap-1.5">
          <ModeRow
            icon={<Layers className="h-3.5 w-3.5" />}
            title="Catálogo"
            desc="Verde = nota alta vs. todo o catálogo · vermelho = no fundo."
            active={mode === "catalog"}
          />
          <ModeRow
            icon={<Target className="h-3.5 w-3.5" />}
            title="Minha faixa"
            desc="Verde = dentro do que você curte · vermelho = longe · cinza = você ignora."
            active={mode === "range"}
          />
        </div>

        <div className="my-3 h-px bg-border/70" />

        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Escala de cor
        </p>
        <div className="grid gap-1.5">
          {legend.rows.map((row) => (
            <div key={row.tier} className="flex items-center gap-2.5 text-xs">
              <span
                className={cn(
                  "h-4 w-6 flex-none rounded",
                  criterionTierPillClass(row.tier),
                )}
              />
              <span className="text-foreground">
                {row.label}
                {row.hint && <span className="text-muted-foreground"> ({row.hint})</span>}
              </span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ModeRow({
  icon,
  title,
  desc,
  active,
}: {
  icon: ReactNode
  title: string
  desc: string
  active: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border p-2 text-xs",
        active ? "border-primary/35 bg-primary/10" : "border-transparent",
      )}
    >
      <span
        className={cn(
          "flex h-6 w-6 flex-none items-center justify-center rounded-md bg-background/60",
          active ? "text-primary" : "text-muted-foreground",
        )}
      >
        {icon}
      </span>
      <div>
        <div className={cn("font-semibold", active ? "text-primary" : "text-foreground")}>
          {title}
        </div>
        <div className="mt-0.5 leading-snug text-muted-foreground">{desc}</div>
      </div>
    </div>
  )
}

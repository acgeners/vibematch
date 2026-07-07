"use client"

import { cn } from "@/lib/utils"
import type { WorkForces } from "@/lib/calculations/forces"

/**
 * As 3 forças da Bússola de Leitura (ver PLANO-BUSSOLA-3-FORCAS.md), como
 * medidores rotulados. Reusa o vocabulário de cor do app (violet = teu lado,
 * amber = crítica, slate = popularidade). Valor = comprimento da barra; a cor é
 * a IDENTIDADE da força (não muda com o valor).
 *
 * Usado na página da obra e (compacto) no card do ranking. Presentational puro.
 */

interface ForceDef {
  key: keyof WorkForces
  label: string
  /** Rótulo curto pro modo compacto (card estreito). */
  short: string
  suffix: string
  fill: string
  text: string
  tooltip: string
}

const FORCES: ForceDef[] = [
  {
    key: "chance",
    label: "Chance de gostar",
    short: "Chance",
    suffix: "%",
    fill: "bg-violet-500",
    text: "text-violet-600 dark:text-violet-400",
    tooltip:
      "Probabilidade calibrada de VOCÊ gostar (chance de a nota passar de 8), a partir do teu perfil + preferências declaradas + interesse na obra.",
  },
  {
    key: "avaliacao",
    label: "Avaliação",
    short: "Avaliação",
    suffix: "",
    fill: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    tooltip: "Quão bem avaliada a obra é pela crítica externa (média das plataformas, 0–100).",
  },
  {
    key: "alcance",
    label: "Alcance",
    short: "Alcance",
    suffix: "",
    fill: "bg-slate-400 dark:bg-slate-500",
    text: "text-slate-600 dark:text-slate-300",
    tooltip: "Quão popular / consolidada — volume de votos externos (escala logarítmica, 0–100).",
  },
]

export function ForceMeters({
  forces,
  size = "md",
  className,
}: {
  forces: WorkForces
  size?: "sm" | "md"
  className?: string
}) {
  // "md" (página da obra, largo): rótulo | barra | valor na horizontal.
  // "sm" (card do ranking, estreito): rótulo+valor em cima, barra full-width embaixo.
  if (size === "sm") {
    return (
      <div className={cn("flex flex-col gap-1.5", className)}>
        {FORCES.map((f) => {
          const v = forces[f.key]
          return (
            <div key={f.key} title={f.tooltip}>
              <div className="flex items-center justify-between gap-1.5 text-[10px] leading-tight">
                <span className="truncate text-muted-foreground">{f.short}</span>
                <span className={cn("shrink-0 font-mono tabular-nums", v == null ? "text-muted-foreground" : f.text)}>
                  {v == null ? "—" : `${v}${f.suffix}`}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className={cn("h-full rounded-full", f.fill)} style={{ width: `${v ?? 0}%` }} />
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {FORCES.map((f) => {
        const v = forces[f.key]
        return (
          <div key={f.key} className="flex items-center gap-2" title={f.tooltip}>
            <span className="w-28 shrink-0 text-xs text-muted-foreground">{f.label}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full transition-all", f.fill)} style={{ width: `${v ?? 0}%` }} />
            </div>
            <span
              className={cn(
                "w-11 shrink-0 text-right font-mono text-xs tabular-nums",
                v == null ? "text-muted-foreground" : f.text,
              )}
            >
              {v == null ? "—" : `${v}${f.suffix}`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

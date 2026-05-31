"use client"

import { Scale } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Banda inserida entre linhas do ranking quando 2+ obras ficam tecnicamente
 * empatadas na Nota Final (diferença dentro de `TIE_DELTA`). Sinaliza o
 * empate e oferece um atalho "Comparar empatadas" que abre o drawer de
 * comparação JÁ com essas obras selecionadas — é lá, na comparação, que mora o
 * "Desempatar com IA" (veredito + justificativa por obra).
 */
export function TieBreakBand({
  workIds,
  count,
  colSpan,
  onCompare,
}: {
  workIds: string[]
  count: number
  colSpan: number
  onCompare: (workIds: string[]) => void
}) {
  return (
    <tr className="bg-muted/25">
      <td colSpan={colSpan} className="px-3 py-1">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            <span className="font-mono text-amber-500">≈</span>
            {count} obras tecnicamente empatadas na Nota Final
          </span>

          <button
            type="button"
            onClick={() => onCompare(workIds)}
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-dashed border-muted-foreground/40 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors",
              "hover:border-primary/60 hover:text-primary",
            )}
            title="Abre a comparação lado-a-lado já com estas obras selecionadas. Lá você desempata com IA."
          >
            <Scale className="h-3 w-3" />
            <span>Comparar empatadas</span>
          </button>
        </div>
      </td>
    </tr>
  )
}

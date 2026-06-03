"use client"

import { Scale } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Divisor de TIER inserido entre faixas de Prioridade no ranking. A tabela não
 * mostra mais o número da Prioridade: ela separa as obras em tiers (faixas
 * equivalentes, dentro do erro do modelo) e este divisor marca a fronteira.
 *
 * Híbrido divisor/seção: uma linha destacada com um rótulo "Tier N · N obras".
 * Em tiers de 2+ (`onCompare` definido), oferece "Comparar / Refinar" — abre o
 * fluxo de refino por mood pra desempatar dentro da incerteza.
 */
export function TierDividerRow({
  tierNumber,
  workIds,
  count,
  colSpan,
  onCompare,
}: {
  tierNumber: number
  workIds: string[]
  count: number
  colSpan: number
  /** Quando ausente (tier de 1 obra), o divisor é só separador. */
  onCompare?: (workIds: string[]) => void
}) {
  return (
    <tr className="bg-gradient-to-r from-primary/10 via-muted/40 to-transparent">
      <td colSpan={colSpan} className="border-y border-primary/25 px-3 py-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 px-1.5 py-0.5 text-primary">
              <span className="font-mono">≈</span>
              Tier {tierNumber}
            </span>
            <span className="font-normal normal-case tracking-normal">
              {count} {count === 1 ? "obra" : "obras"} de prioridade equivalente
            </span>
          </span>

          {onCompare && (
            <button
              type="button"
              onClick={() => onCompare(workIds)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border border-dashed border-primary/40 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors",
                "hover:border-primary hover:bg-primary/10",
              )}
              title="Compara estas obras lado a lado. Antes, você pode refinar por mood (o que quer priorizar agora) pra desempatar."
            >
              <Scale className="h-3 w-3" />
              <span>Comparar / Refinar</span>
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

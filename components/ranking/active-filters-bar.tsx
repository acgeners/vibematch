"use client"

import Link from "next/link"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Chip de filtro ativo exibido acima da view "Faixas". Puramente descritivo +
 * navegação por URL (não altera fórmula/ordenação/dados). `removeHref` é sempre
 * uma URL do próprio /ranking usando os parâmetros já suportados
 * (`pub_status`, `per_status`, `min_expected`, `top_n`…).
 */
export interface ActiveFilterChip {
  /** Chave estável pro React. */
  key: string
  /** Rótulo legível (ex.: "Publicação: Completed"). */
  label: string
  /** Aplicado por padrão (não veio da URL) → recebe o selo PADRÃO. */
  isDefault: boolean
  /** URL que remove/relaxa este filtro (parâmetros já existentes). */
  removeHref: string
}

/**
 * Barra de "Filtros ativos" da view Faixas. Torna visíveis os filtros que o
 * /ranking aplica por padrão (antes silenciosos). Só apresentação: os chips
 * removíveis apenas navegam pra uma URL com os filtros já suportados.
 */
export function ActiveFiltersBar({
  chips,
  clearHref,
}: {
  chips: ActiveFilterChip[]
  clearHref: string
}) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-gradient-to-r from-primary/[0.06] to-transparent px-3 py-2.5">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Filtros ativos
      </span>
      {chips.map((c) => (
        <span
          key={c.key}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border bg-primary/10 py-1 pl-2.5 pr-1 text-xs text-foreground",
            c.isDefault ? "border-dashed border-primary/30" : "border-primary/25",
          )}
        >
          {c.isDefault && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-primary/80">
              Padrão
            </span>
          )}
          <span>{c.label}</span>
          <Link
            href={c.removeHref}
            aria-label={`Remover filtro: ${c.label}`}
            className="inline-grid h-4 w-4 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-primary/20 hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </Link>
        </span>
      ))}
      <Link
        href={clearHref}
        className="ml-auto whitespace-nowrap text-xs font-semibold text-primary hover:underline"
      >
        Ver tudo / limpar padrões
      </Link>
    </div>
  )
}

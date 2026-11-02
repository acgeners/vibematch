"use client"

import type { ReactNode } from "react"
import { FilterCount } from "@/components/ui/filter-count"

/**
 * Os ♥ do filtro de Interesse. Moram fora do `ranking-filters.tsx` porque o /reading usa os mesmos:
 * importar aquele painel arrastaria 3.800 linhas para a página.
 */

/** Toggles ♥ do Interesse — tom rosa (manual) ou salmão (Prev. IA). */
export function QualityToggles({
  values,
  selected,
  onToggle,
  tone,
  extra,
  counts,
}: {
  values: readonly string[]
  selected: ReadonlySet<string>
  onToggle: (v: string) => void
  tone: "rose" | "salmon"
  /** Chip que não é um ♥ (o travessão "sem avaliação"), no mesmo container para quebrar junto. */
  extra?: ReactNode
  /** Quantas obras sobram em cada ♥. Ausente = o chip só com os corações, como no /ranking. */
  counts?: Readonly<Record<string, number>>
}) {
  const base = tone === "rose" ? "text-red-500" : "text-orange-500"
  const onCls =
    tone === "rose"
      ? "border-red-500/60 bg-red-500/15 text-red-500"
      : "border-orange-500/60 bg-orange-500/15 text-orange-500"
  return (
    <div className="flex flex-wrap items-center gap-1">
      {values.map((q) => {
        const on = selected.has(q)
        const count = counts?.[q]
        return (
          <button
            key={q}
            type="button"
            onClick={() => onToggle(q)}
            aria-pressed={on}
            className={`inline-flex h-8 items-center justify-center rounded-full border px-2 text-xs font-semibold tracking-tight transition-colors ${
              on ? onCls : `border-border/70 bg-background/45 hover:border-border ${base}`
            } ${count === 0 && !on ? "opacity-45" : ""}`}
          >
            <span className="text-[13px] leading-none tracking-[0.06em]">{q}</span>
            {count != null && <FilterCount value={count} className={`ml-1.5 ${on ? "" : "text-muted-foreground"}`} />}
          </button>
        )
      })}
      {extra}
    </div>
  )
}

/**
 * Chip da ausência de nota, ao lado dos ♥.
 *
 * É um **Ø**, não a palavra: escrito por extenso ele empurrava os ♥ para uma segunda linha.
 * Dois símbolos foram descartados, e por motivos diferentes:
 * - **traço/`Minus`**: neste MESMO painel ele já é a ação "excluir (NOT)" das abas Gêneros
 *   e Tags (ver FacetLegend). O mesmo desenho significaria "inclua as sem nota" aqui e
 *   "tire estas" ali.
 * - **♡**: no QualityHearts o coração vazio é "posição não preenchida DENTRO da nota"
 *   (a escala mostra sempre 4). Leria como nota zero, não como "não avaliada".
 *
 * O que ele quer dizer vai no aria-label e no tooltip, e por extenso na barra de filtros
 * ativos — o símbolo sozinho nunca é a única pista.
 */
export function InterestOtherToggle({
  active,
  onToggle,
  label,
  tone,
  count,
}: {
  active: boolean
  onToggle: () => void
  /** Texto por extenso: vira aria-label e tooltip (ex.: "Sem avaliação"). */
  label: string
  tone: "rose" | "salmon"
  count?: number
}) {
  const onCls =
    tone === "rose"
      ? "border-red-500/60 bg-red-500/15 text-red-500"
      : "border-orange-500/60 bg-orange-500/15 text-orange-500"
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold leading-none transition-colors ${
        count != null ? "px-2" : "w-8"
      } ${active ? onCls : "border-border/70 bg-background/45 text-muted-foreground hover:border-border"}`}
    >
      <span aria-hidden>Ø</span>
      {count != null && <FilterCount value={count} className="ml-1.5" />}
    </button>
  )
}

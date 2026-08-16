"use client"

import type { ReactNode } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  selectedOptionLabel,
} from "@/components/ui/select"
import { BulkStatusAction } from "./bulk-status-action"

export interface QueueSortOption {
  value: string
  label: string
  disabled?: boolean
}

/**
 * Um dropdown de ordenação + toggle de direção — reusável entre as filas.
 * A aba de Atributos compõe dois (ordenação primária + secundária).
 */
export function QueueSortSelect({
  label = "Ordenar:",
  value,
  onChange,
  options,
  dir,
  onToggleDir,
  dirDisabled,
  width = "w-[150px]",
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  options: QueueSortOption[]
  dir: "asc" | "desc"
  onToggleDir: () => void
  dirDisabled?: boolean
  width?: string
}) {
  return (
    <>
      <span className="text-xs text-muted-foreground">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className={`h-7 ${width} text-xs`}>
          {/* Rótulo derivado das MESMAS `options` que viram os itens — sem ele o gatilho
              sai vazio no SSR e só é preenchido na hidratação (medido: até 634 ms nesta
              página). Ver `selectedOptionLabel`. */}
          <SelectValue>{selectedOptionLabel(options, value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="icon-xs"
        onClick={onToggleDir}
        disabled={dirDisabled}
        title={dir === "asc" ? "Crescente" : "Decrescente"}
      >
        {dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      </Button>
    </>
  )
}

/**
 * Barra de ferramentas + seleção unificada das filas de /curation/works. Uma só
 * casca pra todas as abas: checkbox "selecionar tudo", ordenação (slot `sort`,
 * visível no estado ocioso), extras da aba (slot `idleExtras`, empurrado à
 * direita) e, quando há ≥1 selecionada, as ações em lote da aba (slot
 * `selectedActions`) + Limpar. "Mudar status" (`showStatusAction`) é opt-in — só
 * a aba Untracked liga.
 */
export function QueueToolbar({
  count,
  allSelected,
  onToggleAll,
  onClear,
  selectedIds,
  sort,
  idleExtras,
  selectedActions,
  showStatusAction = false,
}: {
  count: number
  allSelected: boolean
  onToggleAll: (on: boolean) => void
  onClear: () => void
  selectedIds: string[]
  sort?: ReactNode
  idleExtras?: ReactNode
  selectedActions?: ReactNode
  showStatusAction?: boolean
}) {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-card/95 p-2.5 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <Checkbox
        checked={allSelected}
        onCheckedChange={(v) => onToggleAll(!!v)}
        aria-label="Selecionar tudo"
        className="ml-1"
      />

      {count === 0 ? (
        <>
          <span className="ml-1 text-xs text-muted-foreground">Selecionar tudo</span>
          {sort && (
            <>
              <div className="mx-1 h-4 w-px bg-border/80" />
              {sort}
            </>
          )}
          {idleExtras && (
            <>
              <div className="flex-1" />
              {idleExtras}
            </>
          )}
        </>
      ) : (
        <>
          <span className="ml-1 text-sm font-medium text-foreground">{count} selecionada(s)</span>
          <div className="flex-1" />
          {selectedActions}
          {showStatusAction && <BulkStatusAction selectedIds={selectedIds} onApplied={onClear} />}
          <Button size="sm" variant="ghost" onClick={onClear}>
            Limpar
          </Button>
        </>
      )}
    </div>
  )
}

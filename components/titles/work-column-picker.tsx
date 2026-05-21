"use client"

import { useMemo, useSyncExternalStore } from "react"
import { Columns3, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  WORK_COLUMN_GROUP_LABELS,
  WORK_COLUMN_PRESETS,
  WORK_TABLE_COLUMNS,
  getActivePreset,
  getDefaultWorkColumnConfig,
  getPresetConfig,
  normalizeWorkColumnConfig,
  readWorkColumnConfig,
  subscribeWorkColumnConfig,
  writeWorkColumnConfig,
  type WorkColumnConfig,
  type WorkColumnDef,
  type WorkColumnGroup,
  type WorkColumnNamespace,
  type WorkColumnPreset,
} from "@/components/titles/work-table-config"

interface WorkColumnPickerProps {
  namespace?: WorkColumnNamespace
}

export function WorkColumnPicker({ namespace = "titles" }: WorkColumnPickerProps = {}) {
  const config = useSyncExternalStore(
    (onChange) => subscribeWorkColumnConfig(onChange, namespace),
    () => readWorkColumnConfig(namespace),
    () => getDefaultWorkColumnConfig(namespace)
  )

  const columnsByKey = useMemo(
    () => new Map(WORK_TABLE_COLUMNS.map((column) => [column.key, column])),
    []
  )
  const orderedColumns = config.order
    .map((key) => columnsByKey.get(key))
    .filter((column): column is WorkColumnDef => Boolean(column))
  const hiddenSet = new Set(config.hidden)

  const apply = (next: WorkColumnConfig) =>
    writeWorkColumnConfig(normalizeWorkColumnConfig(next), namespace)

  const toggleColumn = (key: string) => {
    const column = columnsByKey.get(key)
    if (column?.locked) return
    const next = new Set(config.hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    apply({ ...config, hidden: [...next] })
  }

  const resetDefaults = () => apply(getDefaultWorkColumnConfig(namespace))

  const applyPreset = (preset: WorkColumnPreset) => apply(getPresetConfig(preset))
  const activePreset = getActivePreset(config)

  const togglableColumns = orderedColumns.filter((c) => !c.locked)
  const visibleCount = togglableColumns.filter((c) => !hiddenSet.has(c.key)).length

  const grouped: Array<{ group: WorkColumnGroup; items: WorkColumnDef[] }> = []
  const groupIndex = new Map<WorkColumnGroup, number>()
  for (const column of togglableColumns) {
    const existing = groupIndex.get(column.group)
    if (existing != null) {
      grouped[existing].items.push(column)
    } else {
      groupIndex.set(column.group, grouped.length)
      grouped.push({ group: column.group, items: [column] })
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <Columns3 className="h-3.5 w-3.5" />
          Colunas
          <span className="rounded-full bg-muted/70 px-1.5 py-0 text-[10px] font-medium tabular-nums text-muted-foreground">
            {visibleCount}/{togglableColumns.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-80 flex-col p-3 max-h-[var(--radix-popover-content-available-height)]"
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Colunas visíveis
          </p>
          <Button
            variant="ghost"
            size="xs"
            onClick={resetDefaults}
            className="h-6 gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3 w-3" />
            Padrão
          </Button>
        </div>
        <div className="mb-3 flex flex-wrap gap-1">
          {WORK_COLUMN_PRESETS.map((preset) => {
            const active = activePreset === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => applyPreset(preset.id)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border/70 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {grouped.map((section) => (
            <div key={section.group} className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {WORK_COLUMN_GROUP_LABELS[section.group]}
              </p>
              <div className="space-y-1">
                {section.items.map((column) => {
                  const id = `work-col-${column.key}`
                  const checked = !hiddenSet.has(column.key)
                  return (
                    <label
                      key={column.key}
                      htmlFor={id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm transition-colors hover:bg-muted/60"
                    >
                      <Checkbox
                        id={id}
                        checked={checked}
                        onCheckedChange={() => toggleColumn(column.key)}
                      />
                      <span className="truncate">{column.configLabel ?? column.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

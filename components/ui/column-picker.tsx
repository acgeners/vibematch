"use client"

import { useMemo } from "react"
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Columns3, GripVertical, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export interface ColumnPickerColumnDef {
  key: string
  label: string
  configLabel?: string
  group: string
  locked?: boolean
}

export interface ColumnPickerConfig {
  order: string[]
  hidden: string[]
}

export interface ColumnPickerPreset {
  id: string
  label: string
}

interface ColumnPickerProps {
  columns: ReadonlyArray<ColumnPickerColumnDef>
  groupLabels: Record<string, string>
  presets?: ReadonlyArray<ColumnPickerPreset>
  config: ColumnPickerConfig
  onChange: (next: ColumnPickerConfig) => void
  activePresets?: Set<string>
  onTogglePreset?: (presetId: string) => void
  onReset?: () => void
  /** Texto do botão que abre o popover. Default "Colunas". */
  triggerLabel?: string
  /** Ícone do botão que abre o popover. Default <Columns3 />. */
  triggerIcon?: React.ReactNode
  /**
   * Desabilita o gatilho SEM escondê-lo — para quem quer manter o controle no
   * mesmo lugar da barra em contextos onde ele não se aplica. O `title` explica
   * por quê; sem ele, um botão apagado é só um botão quebrado.
   */
  disabled?: boolean
  disabledTitle?: string
}

export function ColumnPicker({
  columns,
  groupLabels,
  presets,
  config,
  onChange,
  activePresets,
  onTogglePreset,
  onReset,
  triggerLabel = "Colunas",
  triggerIcon,
  disabled = false,
  disabledTitle,
}: ColumnPickerProps) {
  const columnsByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column])),
    [columns]
  )
  const orderedColumns = useMemo(
    () =>
      config.order
        .map((key) => columnsByKey.get(key))
        .filter((column): column is ColumnPickerColumnDef => Boolean(column)),
    [config.order, columnsByKey]
  )
  const hiddenSet = useMemo(() => new Set(config.hidden), [config.hidden])
  const togglableColumns = orderedColumns.filter((column) => !column.locked)
  const visibleCount = togglableColumns.filter((column) => !hiddenSet.has(column.key)).length

  const toggleColumn = (key: string) => {
    const column = columnsByKey.get(key)
    if (column?.locked) return
    const next = new Set(config.hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange({ ...config, hidden: [...next] })
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = config.order.indexOf(String(active.id))
    const newIndex = config.order.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    onChange({ ...config, order: arrayMove(config.order, oldIndex, newIndex) })
  }

  // Collect items per group — each group renders once. Within a group, items
  // keep their relative order from `config.order`. Cross-group drags still
  // update the underlying order, but the visual grouping always reflects each
  // column's canonical `group` field.
  const sections: Array<{ group: string; items: ColumnPickerColumnDef[] }> = []
  const sectionIndexByGroup = new Map<string, number>()
  for (const column of togglableColumns) {
    const existing = sectionIndexByGroup.get(column.group)
    if (existing != null) {
      sections[existing].items.push(column)
    } else {
      sectionIndexByGroup.set(column.group, sections.length)
      sections.push({ group: column.group, items: [column] })
    }
  }
  const sortableItems = sections.flatMap((section) => section.items.map((c) => c.key))

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={disabled}
          title={disabled ? disabledTitle : undefined}
        >
          {triggerIcon ?? <Columns3 className="h-3.5 w-3.5" />}
          {triggerLabel}
          <span className="rounded-full bg-muted/70 px-1.5 py-0 text-[11px] font-medium tabular-nums text-muted-foreground">
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
          {onReset && (
            <Button
              variant="ghost"
              size="xs"
              onClick={onReset}
              className="h-6 gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Padrão
            </Button>
          )}
        </div>
        {presets && presets.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {presets.map((preset) => {
              const active = activePresets?.has(preset.id) ?? false
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onTogglePreset?.(preset.id)}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
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
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sortableItems} strategy={verticalListSortingStrategy}>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
              {sections.map((section) => (
                <div key={section.group} className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {groupLabels[section.group] ?? section.group}
                  </p>
                  <div className="space-y-1">
                    {section.items.map((column) => (
                      <SortableColumnRow
                        key={column.key}
                        column={column}
                        hidden={hiddenSet.has(column.key)}
                        onToggle={() => toggleColumn(column.key)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </PopoverContent>
    </Popover>
  )
}

function SortableColumnRow({
  column,
  hidden,
  onToggle,
}: {
  column: ColumnPickerColumnDef
  hidden: boolean
  onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.key,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }
  const id = `column-picker-${column.key}`
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/row flex items-center gap-1.5 rounded-md px-1 py-1 transition-colors hover:bg-muted/60",
        isDragging && "z-10 bg-card shadow-lg ring-1 ring-primary/30"
      )}
    >
      <button
        type="button"
        aria-label="Arrastar para reordenar"
        className="flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-background hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <Checkbox id={id} checked={!hidden} onCheckedChange={onToggle} />
      <label htmlFor={id} className="flex flex-1 cursor-pointer items-center gap-2 text-sm">
        <span className="truncate">{column.configLabel ?? column.label}</span>
      </label>
    </div>
  )
}

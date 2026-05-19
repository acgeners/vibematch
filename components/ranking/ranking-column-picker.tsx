"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
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
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, GripVertical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import {
  RANKING_COLUMN_GROUP_LABELS,
  RANKING_COLUMN_PRESETS,
  RANKING_TABLE_COLUMNS,
  getActivePreset,
  getDefaultRankingColumnConfig,
  getPresetConfig,
  normalizeRankingColumnConfig,
  readRankingColumnConfig,
  subscribeRankingColumnConfig,
  writeRankingColumnConfig,
  type RankingColumnConfig,
  type RankingColumnDef,
  type RankingColumnGroup,
  type RankingColumnPreset,
} from "@/components/ranking/ranking-table-config"

export function RankingColumnPicker() {
  const config = useSyncExternalStore(
    subscribeRankingColumnConfig,
    readRankingColumnConfig,
    getDefaultRankingColumnConfig
  )

  const columnsByKey = useMemo(
    () => new Map(RANKING_TABLE_COLUMNS.map((column) => [column.key, column])),
    []
  )
  const orderedColumns = config.order
    .map((key) => columnsByKey.get(key))
    .filter((column): column is RankingColumnDef => Boolean(column))
  const hiddenSet = new Set(config.hidden)
  const visibleCount = orderedColumns.filter((c) => c.locked || !hiddenSet.has(c.key)).length
  const totalCount = orderedColumns.length

  const apply = (next: RankingColumnConfig) => {
    writeRankingColumnConfig(normalizeRankingColumnConfig(next))
  }

  const toggleColumn = (key: string) => {
    const column = columnsByKey.get(key)
    if (column?.locked) return
    const next = new Set(config.hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    apply({ ...config, hidden: [...next] })
  }

  const moveColumn = (key: string, direction: -1 | 1) => {
    const index = config.order.indexOf(key)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= config.order.length) return
    apply({ ...config, order: arrayMove(config.order, index, nextIndex) })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = config.order.indexOf(String(active.id))
    const newIndex = config.order.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    apply({ ...config, order: arrayMove(config.order, oldIndex, newIndex) })
  }

  const applyPreset = (preset: RankingColumnPreset) => apply(getPresetConfig(preset))
  const resetToDefault = () => apply(getDefaultRankingColumnConfig())

  const activePreset = getActivePreset(config)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const groupedColumns: Array<{
    group: RankingColumnGroup
    items: Array<{ column: RankingColumnDef; globalIndex: number }>
  }> = []
  orderedColumns.forEach((column, globalIndex) => {
    const last = groupedColumns[groupedColumns.length - 1]
    if (last && last.group === column.group) {
      last.items.push({ column, globalIndex })
    } else {
      groupedColumns.push({ group: column.group, items: [{ column, globalIndex }] })
    }
  })

  const [collapsedGroups, setCollapsedGroups] = useState<Set<RankingColumnGroup>>(new Set())
  const toggleGroup = (group: RankingColumnGroup) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  return (
    <div className="space-y-4">
      <ColumnsToolbar
        visibleCount={visibleCount}
        totalCount={totalCount}
        activePreset={activePreset}
        onPreset={applyPreset}
        onReset={resetToDefault}
      />

      <ColumnsPreview
        columns={orderedColumns.filter((c) => c.locked || !hiddenSet.has(c.key))}
      />

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={config.order} strategy={rectSortingStrategy}>
          <div className="space-y-4 rounded-lg border border-border/65 bg-background/40 p-3 sm:p-4">
            {groupedColumns.map((section) => {
              const collapsed = collapsedGroups.has(section.group)
              const visibleInGroup = section.items.filter(
                ({ column }) => column.locked || !hiddenSet.has(column.key)
              ).length
              return (
                <section key={section.group} className="space-y-2">
                  <GroupHeader
                    group={section.group}
                    total={section.items.length}
                    visible={visibleInGroup}
                    collapsed={collapsed}
                    onToggle={() => toggleGroup(section.group)}
                  />
                  {!collapsed && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {section.items.map(({ column, globalIndex }) => (
                        <SortableColumnRow
                          key={column.key}
                          column={column}
                          hidden={hiddenSet.has(column.key)}
                          isFirst={globalIndex === 0}
                          isLast={globalIndex === orderedColumns.length - 1}
                          onToggle={() => toggleColumn(column.key)}
                          onMoveUp={() => moveColumn(column.key, -1)}
                          onMoveDown={() => moveColumn(column.key, 1)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}

interface ColumnsToolbarProps {
  visibleCount: number
  totalCount: number
  activePreset: RankingColumnPreset | null
  onPreset: (preset: RankingColumnPreset) => void
  onReset: () => void
}

function ColumnsToolbar({
  visibleCount,
  totalCount,
  activePreset,
  onPreset,
  onReset,
}: ColumnsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          <Eye className="size-3.5" />
          <span>
            <span className="font-semibold text-foreground">{visibleCount}</span>
            <span className="mx-1 text-muted-foreground/70">de</span>
            <span className="font-medium">{totalCount}</span>
          </span>
          <span className="text-muted-foreground/80">visíveis</span>
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {RANKING_COLUMN_PRESETS.map((preset) => {
          const active = activePreset === preset.id
          return (
            <Button
              key={preset.id}
              type="button"
              size="xs"
              variant={active ? "default" : "outline"}
              onClick={() => onPreset(preset.id)}
              className={cn(!active && "border-border/70 bg-background/60")}
            >
              {preset.label}
            </Button>
          )
        })}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          onClick={onReset}
          className="text-muted-foreground hover:text-foreground"
        >
          Resetar
        </Button>
      </div>
    </div>
  )
}

function ColumnsPreview({ columns }: { columns: RankingColumnDef[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="overflow-hidden rounded-lg border border-border/65 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-card/60 px-3 py-2 text-left transition-colors hover:bg-card/80"
      >
        <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pré-visualização
          <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal text-muted-foreground/90">
            {columns.length} colunas
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open ? "" : "-rotate-90"
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border/60 bg-background/30 px-3 py-2">
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {columns.map((col) => (
              <span
                key={col.key}
                className="inline-flex h-7 shrink-0 items-center rounded-md border border-border/60 bg-card/70 px-2 text-xs text-muted-foreground"
                title={col.configLabel ?? col.label}
              >
                {col.configLabel ?? col.label}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface GroupHeaderProps {
  group: RankingColumnGroup
  total: number
  visible: number
  collapsed: boolean
  onToggle: () => void
}

function GroupHeader({ group, total, visible, collapsed, onToggle }: GroupHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="flex w-full items-center gap-3 rounded-md px-1 py-1 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 transition-colors hover:text-foreground"
    >
      <ChevronDown
        className={cn(
          "size-3.5 shrink-0 text-muted-foreground/70 transition-transform",
          collapsed && "-rotate-90"
        )}
      />
      <span>{RANKING_COLUMN_GROUP_LABELS[group]}</span>
      <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-muted-foreground/80">
        {visible}/{total}
      </span>
      <span className="h-px flex-1 bg-border/50" />
    </button>
  )
}

interface SortableColumnRowProps {
  column: RankingColumnDef
  hidden: boolean
  isFirst: boolean
  isLast: boolean
  onToggle: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

function SortableColumnRow({
  column,
  hidden,
  isFirst,
  isLast,
  onToggle,
  onMoveUp,
  onMoveDown,
}: SortableColumnRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.key,
    disabled: column.locked,
  })

  const checked = column.locked || !hidden
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/row relative flex items-center gap-2 rounded-md border border-border/60 bg-card/50 px-2.5 py-2 transition-colors hover:border-border hover:bg-card/80",
        isDragging && "z-10 border-primary/40 bg-card shadow-lg",
        hidden && !column.locked && "opacity-55"
      )}
    >
      <button
        type="button"
        aria-label="Arrastar para reordenar"
        className={cn(
          "flex size-6 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted/60 hover:text-foreground active:cursor-grabbing",
          column.locked && "cursor-not-allowed opacity-30 hover:bg-transparent hover:text-muted-foreground/60"
        )}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      <Checkbox
        id={`ranking-column-${column.key}`}
        checked={checked}
        disabled={column.locked}
        onCheckedChange={onToggle}
      />

      <label
        htmlFor={`ranking-column-${column.key}`}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm",
          column.locked && "cursor-default"
        )}
      >
        <span className="truncate">{column.configLabel ?? column.label}</span>
        {column.locked && (
          <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            fixa
          </span>
        )}
        {hidden && !column.locked && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            <EyeOff className="size-3" />
            oculta
          </span>
        )}
      </label>

      <div
        className={cn(
          "flex items-center gap-0.5 opacity-0 transition-opacity",
          "group-hover/row:opacity-100 group-focus-within/row:opacity-100",
          column.locked && "hidden"
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={isFirst}
          onClick={onMoveUp}
          title="Mover para cima"
          aria-label="Mover para cima"
        >
          <ArrowUp />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={isLast}
          onClick={onMoveDown}
          title="Mover para baixo"
          aria-label="Mover para baixo"
        >
          <ArrowDown />
        </Button>
      </div>
    </div>
  )
}

"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo, useState, useSyncExternalStore, useTransition } from "react"
import { ArrowDown, ArrowUp, ChevronDown, Filter, Minus, Plus, Save, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CRITERION_SLUGS, SYNOPSIS_QUALITIES } from "@/types/domain"
import { updateRankingPreferences } from "@/server/actions/settings"
import {
  getDefaultRankingColumnConfig,
  normalizeRankingColumnConfig,
  RANKING_TABLE_COLUMNS,
  readRankingColumnConfig,
  subscribeRankingColumnConfig,
  writeRankingColumnConfig,
} from "@/components/ranking/ranking-table-config"

const CRITERION_LABELS: Record<string, string> = {
  romance: "Romance",
  couple_dynamics: "Casal",
  fantasy_nobility: "Fantasia/Nobreza",
  action_adventure: "Ação/Aventura",
  adult_content: "Conteúdo adulto",
  protagonist: "Protagonista",
  humor: "Humor",
  drama: "Drama",
  tragedy: "Tragédia",
}

const SORTABLE_FIELDS: Array<{ value: string; label: string }> = [
  { value: "final_score", label: "Nota.Final" },
  { value: "calc_score", label: "Nota.IA" },
  { value: "pred_score", label: "Nota.Pr" },
  { value: "title", label: "Título" },
  { value: "chapters", label: "Capítulos" },
  ...CRITERION_SLUGS.map((slug) => ({
    value: `crit_${slug}`,
    label: CRITERION_LABELS[slug] ?? slug,
  })),
]

// Personal statuses que devem ser excluídos do filtro (sempre ocultos no ranking)
const HIDDEN_PERSONAL_STATUSES = new Set(["Completed", "Dropped"])

interface SortLevel {
  field: string
  dir: "asc" | "desc"
}

function parseSortLevels(raw: string | null): SortLevel[] {
  const src = raw ?? "final_score:desc"
  return src.split(",").map((seg) => {
    const [field, dir] = seg.trim().split(":")
    const validField = SORTABLE_FIELDS.some((f) => f.value === field) ? field : "final_score"
    return { field: validField, dir: dir === "asc" ? "asc" : "desc" }
  })
}

function encodeSortLevels(levels: SortLevel[]): string {
  return levels.map((l) => `${l.field}:${l.dir}`).join(",")
}

interface SortLevelsSectionProps {
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
}

function SortLevelsSection({ searchParams, updateParams }: SortLevelsSectionProps) {
  const levels = parseSortLevels(searchParams.get("sort"))

  const setLevels = (next: SortLevel[]) => {
    updateParams({ sort: encodeSortLevels(next) })
  }

  const updateField = (i: number, field: string) => {
    const next = levels.map((l, idx) => idx === i ? { ...l, field } : l)
    setLevels(next)
  }

  const toggleDir = (i: number) => {
    const next = levels.map((l, idx) => idx === i ? { ...l, dir: l.dir === "desc" ? "asc" : "desc" } : l) as SortLevel[]
    setLevels(next)
  }

  const remove = (i: number) => {
    const next = levels.filter((_, idx) => idx !== i)
    setLevels(next.length ? next : [{ field: "final_score", dir: "desc" }])
  }

  const add = () => {
    if (levels.length >= 5) return
    const used = new Set(levels.map((l) => l.field))
    const next = SORTABLE_FIELDS.find((f) => !used.has(f.value))
    setLevels([...levels, { field: next?.value ?? "calc_score", dir: "desc" }])
  }

  return (
    <FilterSection title="Ordenação">
      <div className="space-y-2">
        {levels.map((level, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-4 shrink-0 text-right">{i + 1}.</span>
            <Select value={level.field} onValueChange={(v) => updateField(i, v)}>
              <SelectTrigger className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTABLE_FIELDS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => toggleDir(i)}
              className="flex items-center gap-1 h-8 px-2 rounded border text-xs hover:bg-muted transition-colors shrink-0"
              title={level.dir === "desc" ? "Decrescente" : "Crescente"}
            >
              {level.dir === "desc"
                ? <><ArrowDown className="h-3 w-3" /><span>Dec</span></>
                : <><ArrowUp className="h-3 w-3" /><span>Cre</span></>}
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={levels.length === 1}
              className="h-8 w-8 flex items-center justify-center rounded border hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        {levels.length < 5 && (
          <Button type="button" variant="ghost" size="sm" onClick={add} className="h-7 text-xs px-2">
            <Plus className="h-3 w-3 mr-1" /> Adicionar nível
          </Button>
        )}
      </div>
    </FilterSection>
  )
}

interface StatusOption {
  id: number
  status: string
  slug: string
  color: string | null
  symbol: string | null
  previous: string
  comment: string | null
}

interface RankingFiltersProps {
  availableGenres: string[]
  availableTags: Array<{ slug: string; name: string; tag_group_id?: string | null; groupName?: string }>
  publicationStatuses?: StatusOption[]
  personalStatuses?: StatusOption[]
  defaultTopN: number | null
  defaultMinCalc: number | null
  defaultMinPredicted: number | null
  defaultMinFinal: number | null
}

interface FilterSectionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
  className?: string
}

function FilterSection({ title, defaultOpen = true, children, className }: FilterSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`rounded-lg border bg-background shadow-sm ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && <div className="border-t px-4 py-4">{children}</div>}
    </div>
  )
}

function FilterField({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}

function RangeFilterRow({
  label,
  minKey,
  maxKey,
  searchParams,
  updateParams,
  step = 0.5,
  max = 10,
}: {
  label: string
  minKey: string
  maxKey: string
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
  step?: number
  max?: number
}) {
  return (
    <div className="grid grid-cols-[minmax(7rem,1fr)_4.75rem_auto_4.75rem] items-center gap-2 rounded-lg border bg-muted/10 p-2">
      <Label className="truncate text-xs font-medium">{label}</Label>
      <Input
        type="number"
        min={0}
        max={max}
        step={step}
        placeholder="Mín"
        className="h-8 text-xs"
        value={searchParams.get(minKey) ?? ""}
        onChange={(e) => updateParams({ [minKey]: e.target.value || null })}
      />
      <span className="text-xs text-muted-foreground">-</span>
      <Input
        type="number"
        min={0}
        max={max}
        step={step}
        placeholder="Máx"
        className="h-8 text-xs"
        value={searchParams.get(maxKey) ?? ""}
        onChange={(e) => updateParams({ [maxKey]: e.target.value || null })}
      />
    </div>
  )
}

function num(v: string | null | undefined): number | undefined {
  if (!v) return undefined
  const n = parseFloat(v)
  return isNaN(n) ? undefined : n
}

function csvValueToSet(value: string | null | undefined): Set<string> {
  if (!value) return new Set()
  return new Set(value.split(",").map((s) => s.trim()).filter(Boolean))
}

function encodeCsvSet(set: Set<string>): string | null {
  return set.size === 0 ? null : [...set].join(",")
}

function StatusButton({
  option,
  active,
  onClick,
  tooltip,
}: {
  option: StatusOption
  active: boolean
  onClick: () => void
  tooltip?: string | null
}) {
  const style = active && option.color
    ? { backgroundColor: option.color, borderColor: option.color, color: "#fff" }
    : option.color
      ? { borderColor: option.color, color: option.color }
      : undefined
  const button = (
    <button onClick={onClick} type="button">
      <Badge
        variant={active ? "default" : "outline"}
        className="cursor-pointer gap-1 rounded-full px-2.5 py-1 text-xs"
        style={style}
      >
        {option.symbol && <span className="text-[10px]">{option.symbol}</span>}
        {option.status}
      </Badge>
    </button>
  )

  if (!tooltip?.trim()) return button

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-left">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

function dedupeStatusOptions(options: StatusOption[]): StatusOption[] {
  const byStatus = new Map<string, StatusOption>()

  for (const option of options) {
    const current = byStatus.get(option.status)
    if (!current) {
      byStatus.set(option.status, option)
      continue
    }

    const currentHasDisplay = Boolean(current.color || current.symbol)
    const nextHasDisplay = Boolean(option.color || option.symbol)
    if (!currentHasDisplay && nextHasDisplay) {
      byStatus.set(option.status, option)
    }
  }

  return [...byStatus.values()]
}

interface FacetedChoice {
  value: string
  label: string
}

interface GroupedFacetedChoice extends FacetedChoice {
  groupName: string
}

type FacetRule = "all" | "any" | "exclude" | null

interface GenreRuleGridProps {
  items: string[]
  selectedAll: Set<string>
  selectedAny: Set<string>
  selectedExclude: Set<string>
  onSetRule: (value: string, rule: FacetRule) => void
}

function GenreRuleGrid({
  items,
  selectedAll,
  selectedAny,
  selectedExclude,
  onSetRule,
}: GenreRuleGridProps) {
  const [expanded, setExpanded] = useState(false)
  const selectedCount = selectedAll.size + selectedAny.size + selectedExclude.size
  const visibleLimit = 36

  const getRule = (value: string): FacetRule => {
    if (selectedAll.has(value)) return "all"
    if (selectedAny.has(value)) return "any"
    if (selectedExclude.has(value)) return "exclude"
    return null
  }

  const orderedItems = useMemo(() => {
    const weight = (value: string) => {
      const rule = getRule(value)
      if (rule === "all") return 0
      if (rule === "any") return 1
      if (rule === "exclude") return 2
      return 3
    }
    return [...items].sort((a, b) => {
      const diff = weight(a) - weight(b)
      return diff !== 0 ? diff : a.localeCompare(b)
    })
    // getRule depends on the selected sets above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedAll, selectedAny, selectedExclude])

  const visibleItems = expanded
    ? orderedItems
    : orderedItems.slice(0, Math.max(visibleLimit, selectedCount))

  const stateClass: Record<Exclude<FacetRule, null> | "none", string> = {
    none: "border-border bg-background text-foreground",
    all: "border-emerald-300 bg-emerald-50 text-emerald-950",
    any: "border-sky-300 bg-sky-50 text-sky-950",
    exclude: "border-rose-300 bg-rose-50 text-rose-950",
  }

  const stateLabel: Record<Exclude<FacetRule, null>, string> = {
    all: "AND",
    any: "OR",
    exclude: "EXCLUDE",
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1">
            <Plus className="h-3 w-3 text-emerald-600" /> 1 clique: AND
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1">
            <Plus className="h-3 w-3 text-sky-600" /> 2 cliques: OR
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1">
            <Minus className="h-3 w-3 text-rose-600" /> remover: EXCLUDE
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1">
            clique no gênero marcado: desmarcar
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1">
            sem marca: não selecionado
          </span>
        </div>
      </div>

      <div className="rounded-lg border bg-background p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visibleItems.map((item) => {
            const rule = getRule(item)
            const addTitle =
              rule === "all"
                ? `Mudar ${item} para OR`
                : rule === "any"
                  ? `Remover ${item} dos filtros`
                  : `Adicionar ${item} como AND`
            const removeTitle = rule === "exclude"
              ? `Remover ${item} dos excluídos`
              : `Excluir ${item}`

            return (
              <div
                key={item}
                className={`grid h-10 grid-cols-[2rem_minmax(0,1fr)_2rem] items-center overflow-hidden rounded-lg border text-sm transition-colors ${stateClass[rule ?? "none"]}`}
              >
                <button
                  type="button"
                  onClick={() => onSetRule(item, rule === "exclude" ? null : "exclude")}
                  aria-label={removeTitle}
                  title={removeTitle}
                  className={`flex h-full items-center justify-center border-r transition-colors hover:bg-rose-100 ${
                    rule === "exclude" ? "bg-rose-100 text-rose-700" : "text-muted-foreground"
                  }`}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (rule) onSetRule(item, null)
                  }}
                  disabled={!rule}
                  aria-label={rule ? `Desmarcar ${item}` : `${item} não selecionado`}
                  title={rule ? `Desmarcar ${item}` : undefined}
                  className="flex h-full min-w-0 items-center justify-between gap-2 px-2 text-left disabled:cursor-default"
                >
                  <span className="truncate font-medium">{item}</span>
                  {rule && (
                    <span className="shrink-0 rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold">
                      {stateLabel[rule]}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => onSetRule(item, rule === "all" ? "any" : rule === "any" ? null : "all")}
                  aria-label={addTitle}
                  title={addTitle}
                  className={`flex h-full items-center justify-center border-l transition-colors ${
                    rule === "all"
                      ? "bg-emerald-100 text-emerald-700 hover:bg-sky-100 hover:text-sky-700"
                      : rule === "any"
                        ? "bg-sky-100 text-sky-700 hover:bg-muted"
                        : "text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"
                  }`}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            )
          })}
        </div>
        {items.length === 0 && (
          <span className="text-xs text-muted-foreground">Sem resultados</span>
        )}
        {orderedItems.length > visibleLimit && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-3 h-8 px-2 text-xs text-muted-foreground"
            onClick={() => setExpanded((prev) => !prev)}
          >
            {expanded ? "Mostrar menos" : `Mostrar mais (${orderedItems.length - visibleLimit})`}
          </Button>
        )}
      </div>
    </div>
  )
}

interface GroupedTagRuleGridProps {
  items: GroupedFacetedChoice[]
  selectedAll: Set<string>
  selectedAny: Set<string>
  selectedExclude: Set<string>
  onSetRule: (value: string, rule: FacetRule) => void
}

function GroupedTagRuleGrid({
  items,
  selectedAll,
  selectedAny,
  selectedExclude,
  onSetRule,
}: GroupedTagRuleGridProps) {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const getRule = (value: string): FacetRule => {
    if (selectedAll.has(value)) return "all"
    if (selectedAny.has(value)) return "any"
    if (selectedExclude.has(value)) return "exclude"
    return null
  }

  const groups = useMemo(() => {
    const byGroup = new Map<string, GroupedFacetedChoice[]>()
    for (const item of items) {
      const groupName = item.groupName || "Sem grupo"
      const groupItems = byGroup.get(groupName) ?? []
      groupItems.push(item)
      byGroup.set(groupName, groupItems)
    }
    return [...byGroup.entries()]
      .map(([groupName, groupItems]) => ({
        groupName,
        items: groupItems.sort((a, b) => {
          const aRule = getRule(a.value)
          const bRule = getRule(b.value)
          const weight = (rule: FacetRule) => rule === "all" ? 0 : rule === "any" ? 1 : rule === "exclude" ? 2 : 3
          const diff = weight(aRule) - weight(bRule)
          return diff !== 0 ? diff : a.label.localeCompare(b.label)
        }),
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName))
    // getRule depends on the selected sets above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedAll, selectedAny, selectedExclude])

  const stateClass: Record<Exclude<FacetRule, null> | "none", string> = {
    none: "border-border bg-background text-foreground",
    all: "border-emerald-300 bg-emerald-50 text-emerald-950",
    any: "border-sky-300 bg-sky-50 text-sky-950",
    exclude: "border-rose-300 bg-rose-50 text-rose-950",
  }

  const stateLabel: Record<Exclude<FacetRule, null>, string> = {
    all: "AND",
    any: "OR",
    exclude: "EXCLUDE",
  }

  const renderItem = (item: GroupedFacetedChoice) => {
    const rule = getRule(item.value)
    const addTitle =
      rule === "all"
        ? `Mudar ${item.label} para OR`
        : rule === "any"
          ? `Remover ${item.label} dos filtros`
          : `Adicionar ${item.label} como AND`
    const removeTitle = rule === "exclude"
      ? `Remover ${item.label} dos excluídos`
      : `Excluir ${item.label}`

    return (
      <div
        key={item.value}
        className={`grid h-10 grid-cols-[2rem_minmax(0,1fr)_2rem] items-center overflow-hidden rounded-lg border text-sm transition-colors ${stateClass[rule ?? "none"]}`}
      >
        <button
          type="button"
          onClick={() => onSetRule(item.value, rule === "exclude" ? null : "exclude")}
          aria-label={removeTitle}
          title={removeTitle}
          className={`flex h-full items-center justify-center border-r transition-colors hover:bg-rose-100 ${
            rule === "exclude" ? "bg-rose-100 text-rose-700" : "text-muted-foreground"
          }`}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (rule) onSetRule(item.value, null)
          }}
          disabled={!rule}
          aria-label={rule ? `Desmarcar ${item.label}` : `${item.label} não selecionado`}
          title={rule ? `Desmarcar ${item.label}` : undefined}
          className="flex h-full min-w-0 items-center justify-between gap-2 px-2 text-left disabled:cursor-default"
        >
          <span className="truncate font-medium">{item.label}</span>
          {rule && (
            <span className="shrink-0 rounded-full bg-background/80 px-1.5 py-0.5 text-[10px] font-semibold">
              {stateLabel[rule]}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onSetRule(item.value, rule === "all" ? "any" : rule === "any" ? null : "all")}
          aria-label={addTitle}
          title={addTitle}
          className={`flex h-full items-center justify-center border-l transition-colors ${
            rule === "all"
              ? "bg-emerald-100 text-emerald-700 hover:bg-sky-100 hover:text-sky-700"
              : rule === "any"
                ? "bg-sky-100 text-sky-700 hover:bg-muted"
                : "text-muted-foreground hover:bg-emerald-100 hover:text-emerald-700"
          }`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1">
            <Plus className="h-3 w-3 text-emerald-600" /> 1 clique: AND
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1">
            <Plus className="h-3 w-3 text-sky-600" /> 2 cliques: OR
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1">
            <Minus className="h-3 w-3 text-rose-600" /> remover: EXCLUDE
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1">
            clique na tag marcada: desmarcar
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1">
            sem marca: não selecionada
          </span>
        </div>
      </div>

      <div className="space-y-2">
        {groups.map((group) => {
          const selectedCount = group.items.filter((item) => Boolean(getRule(item.value))).length
          const isOpen = Boolean(openGroups[group.groupName])
          return (
            <div key={group.groupName} className="overflow-hidden rounded-lg border bg-background">
              <button
                type="button"
                onClick={() => setOpenGroups((prev) => ({ ...prev, [group.groupName]: !prev[group.groupName] }))}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
              >
                <span className="min-w-0 truncate text-sm font-semibold">{group.groupName}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {selectedCount > 0 && (
                    <span className="rounded-full bg-muted px-2 py-0.5 font-medium">
                      {selectedCount} selecionada{selectedCount !== 1 ? "s" : ""}
                    </span>
                  )}
                  <span>{group.items.length}</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                </span>
              </button>
              {isOpen && (
                <div className="border-t p-3">
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                    {group.items.map(renderItem)}
                  </div>
                </div>
              )}
            </div>
          )
        })}
        {items.length === 0 && (
          <div className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
            Sem resultados
          </div>
        )}
      </div>
    </div>
  )
}

function TableColumnsSection() {
  const config = useSyncExternalStore(
    subscribeRankingColumnConfig,
    readRankingColumnConfig,
    getDefaultRankingColumnConfig
  )

  const applyConfig = (next: ReturnType<typeof getDefaultRankingColumnConfig>) => {
    const normalized = normalizeRankingColumnConfig(next)
    writeRankingColumnConfig(normalized)
  }

  const columnsByKey = useMemo(
    () => new Map(RANKING_TABLE_COLUMNS.map((column) => [column.key, column])),
    []
  )
  const orderedColumns = config.order
    .map((key) => columnsByKey.get(key))
    .filter((column): column is (typeof RANKING_TABLE_COLUMNS)[number] => Boolean(column))
  const hidden = new Set(config.hidden)

  const toggleColumn = (key: string) => {
    const column = columnsByKey.get(key)
    if (column?.locked) return
    const nextHidden = new Set(config.hidden)
    if (nextHidden.has(key)) nextHidden.delete(key)
    else nextHidden.add(key)
    applyConfig({ ...config, hidden: [...nextHidden] })
  }

  const moveColumn = (key: string, direction: -1 | 1) => {
    const index = config.order.indexOf(key)
    const nextIndex = index + direction
    if (index < 0 || nextIndex < 0 || nextIndex >= config.order.length) return
    const nextOrder = [...config.order]
    const [item] = nextOrder.splice(index, 1)
    nextOrder.splice(nextIndex, 0, item)
    applyConfig({ ...config, order: nextOrder })
  }

  const resetColumns = () => applyConfig(getDefaultRankingColumnConfig())

  return (
    <FilterSection title="Colunas da tabela">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Escolha quais colunas aparecem e ajuste a ordem de exibição.
        </p>
        <Button type="button" variant="outline" size="sm" className="h-8" onClick={resetColumns}>
          Resetar
        </Button>
      </div>

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {orderedColumns.map((column, index) => {
          const checked = column.locked || !hidden.has(column.key)
          return (
            <div
              key={column.key}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border bg-muted/10 px-3 py-2"
            >
              <Checkbox
                id={`ranking-column-${column.key}`}
                checked={checked}
                disabled={column.locked}
                onCheckedChange={() => toggleColumn(column.key)}
              />
              <Label
                htmlFor={`ranking-column-${column.key}`}
                className="flex min-w-0 items-center gap-2 text-sm font-medium"
              >
                <span className="truncate">{column.configLabel ?? column.label}</span>
                {column.locked && (
                  <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    fixa
                  </span>
                )}
              </Label>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={index === 0}
                  onClick={() => moveColumn(column.key, -1)}
                  title="Mover para cima"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  disabled={index === orderedColumns.length - 1}
                  onClick={() => moveColumn(column.key, 1)}
                  title="Mover para baixo"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </FilterSection>
  )
}

export function RankingFilters({
  availableGenres,
  availableTags,
  publicationStatuses = [],
  personalStatuses = [],
  defaultTopN,
  defaultMinCalc,
  defaultMinPredicted,
  defaultMinFinal,
}: RankingFiltersProps) {
  const router = useRouter()
  const appliedSearchParams = useSearchParams()
  const appliedSearchString = appliedSearchParams.toString()
  const [draftSearch, setDraftSearch] = useState(appliedSearchString)
  const searchParams = useMemo(() => new URLSearchParams(draftSearch), [draftSearch])
  const [, startTransition] = useTransition()

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setDraftSearch((current) => {
        const params = new URLSearchParams(current)
        for (const [key, value] of Object.entries(updates)) {
          if (value === null || value === "") {
            params.delete(key)
          } else {
            params.set(key, value)
          }
        }
        return params.toString()
      })
    },
    []
  )

  const filtersDirty = draftSearch !== appliedSearchString
  const hasFilters = draftSearch !== "" || appliedSearchString !== ""

  // Top N + min scores (URL pode sobrescrever as preferências do DB)
  const urlTopN = num(searchParams.get("top_n"))
  const urlMinCalc = num(searchParams.get("min_calc"))
  const urlMinPr = num(searchParams.get("min_pr"))
  const urlMinFinal = num(searchParams.get("min_final"))

  const currentTopN = urlTopN ?? defaultTopN ?? undefined
  const currentMinCalc = urlMinCalc ?? defaultMinCalc ?? undefined
  const currentMinPr = urlMinPr ?? defaultMinPredicted ?? undefined
  const currentMinFinal = urlMinFinal ?? defaultMinFinal ?? undefined

  const prefsDirty =
    (urlTopN !== undefined && urlTopN !== (defaultTopN ?? undefined)) ||
    (urlMinCalc !== undefined && urlMinCalc !== (defaultMinCalc ?? undefined)) ||
    (urlMinPr !== undefined && urlMinPr !== (defaultMinPredicted ?? undefined)) ||
    (urlMinFinal !== undefined && urlMinFinal !== (defaultMinFinal ?? undefined))

  const savePrefs = async () => {
    const result = await updateRankingPreferences({
      top_n: currentTopN ?? null,
      min_calc_score: currentMinCalc ?? null,
      min_predicted_score: currentMinPr ?? null,
      min_final_score: currentMinFinal ?? null,
    })
    if (result.error) {
      toast.error(`Erro ao salvar: ${result.error}`)
      return
    }
    toast.success("Preferências de ranking atualizadas")
  }

  const applyAllFilters = () => {
    const target = draftSearch ? `/ranking?${draftSearch}` : "/ranking"
    startTransition(() => router.replace(target))
  }

  const discardDraftFilters = () => setDraftSearch(appliedSearchString)

  const clearAll = () => setDraftSearch("")

  // Multi-select helpers (CSV em URL)
  const csvSet = (key: string): Set<string> => {
    return csvValueToSet(searchParams.get(key))
  }
  const toggleCsv = (key: string, item: string) => {
    const set = csvSet(key)
    if (set.has(item)) set.delete(item)
    else set.add(item)
    updateParams({ [key]: set.size === 0 ? null : [...set].join(",") })
  }
  const selectedGenreAll = csvSet("genres_all")
  const selectedGenreAny = csvSet("genres_any")
  const selectedGenreExclude = csvSet("genres_exclude")

  const setGenreRule = (item: string, rule: FacetRule) => {
    const nextAll = new Set(selectedGenreAll)
    const nextAny = new Set(selectedGenreAny)
    const nextExclude = new Set(selectedGenreExclude)
    nextAll.delete(item)
    nextAny.delete(item)
    nextExclude.delete(item)

    if (rule === "all") nextAll.add(item)
    if (rule === "any") nextAny.add(item)
    if (rule === "exclude") nextExclude.add(item)

    updateParams({
      genres_all: encodeCsvSet(nextAll),
      genres_any: encodeCsvSet(nextAny),
      genres_exclude: encodeCsvSet(nextExclude),
    })
  }

  const selectedTagAll = csvSet("tags_all")
  const selectedTagAny = csvSet("tags_any")
  const selectedTagExclude = csvSet("tags_exclude")

  const setTagRule = (item: string, rule: FacetRule) => {
    const nextAll = new Set(selectedTagAll)
    const nextAny = new Set(selectedTagAny)
    const nextExclude = new Set(selectedTagExclude)
    nextAll.delete(item)
    nextAny.delete(item)
    nextExclude.delete(item)

    if (rule === "all") nextAll.add(item)
    if (rule === "any") nextAny.add(item)
    if (rule === "exclude") nextExclude.add(item)

    updateParams({
      tags_all: encodeCsvSet(nextAll),
      tags_any: encodeCsvSet(nextAny),
      tags_exclude: encodeCsvSet(nextExclude),
    })
  }

  const selectedSynopsisQ = csvSet("synopsis_q")
  const selectedPublicationStatuses = csvSet("pub_status")
  const perStatusParam = searchParams.get("per_status")
  const isAllPersonal = perStatusParam === "all"
  const selectedPerStatuses = isAllPersonal
    ? new Set<string>()
    : perStatusParam
      ? csvSet("per_status")
      : new Set<string>()

  const [genreSearch, setGenreSearch] = useState("")
  const filteredGenres = useMemo(
    () =>
      availableGenres.filter((g) => g.toLowerCase().includes(genreSearch.toLowerCase())),
    [availableGenres, genreSearch]
  )
  const [tagSearch, setTagSearch] = useState("")
  const filteredTags = useMemo(
    () =>
      availableTags.filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase())),
    [availableTags, tagSearch]
  )
  const filteredTagChoices = useMemo(
    () => filteredTags.map((tag) => ({
      value: tag.slug,
      label: tag.name,
      groupName: tag.groupName ?? "Sem grupo",
    })),
    [filteredTags]
  )

  const visiblePublicationStatuses = useMemo(
    () => dedupeStatusOptions(publicationStatuses),
    [publicationStatuses]
  )

  // Filtra os status pessoais — Completed e Dropped nunca aparecem
  const visiblePersonalStatuses = useMemo(
    () => dedupeStatusOptions(personalStatuses).filter((s) => !HIDDEN_PERSONAL_STATUSES.has(s.status)),
    [personalStatuses]
  )

  return (
    <div className="rounded-xl border bg-muted/10 p-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Filter className="h-4 w-4 text-muted-foreground" />
          Filtros
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {filtersDirty && (
            <Badge variant="secondary" className="h-9 rounded-md px-3 text-xs">
              alterações pendentes
            </Badge>
          )}
          {filtersDirty && (
            <Button variant="ghost" size="sm" onClick={discardDraftFilters} className="h-9 px-2">
              Descartar
            </Button>
          )}
          <Button size="sm" onClick={applyAllFilters} disabled={!filtersDirty} className="h-9">
            Aplicar filtros
          </Button>
          {prefsDirty && (
            <Button variant="outline" size="sm" onClick={savePrefs} className="h-9">
              <Save className="mr-1.5 h-3.5 w-3.5" /> Salvar padrão
            </Button>
          )}
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearAll} className="h-9 px-2">
              <X className="mr-1.5 h-3.5 w-3.5" />
              Limpar
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="geral" className="gap-3">
        <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-muted/60 p-1 sm:grid-cols-3 xl:grid-cols-6">
          <TabsTrigger value="geral" className="h-9">Geral</TabsTrigger>
          <TabsTrigger value="status" className="h-9">Status</TabsTrigger>
          <TabsTrigger value="notas" className="h-9">Notas</TabsTrigger>
          <TabsTrigger value="generos" className="h-9">Gêneros</TabsTrigger>
          <TabsTrigger value="tags" className="h-9">Tags</TabsTrigger>
          <TabsTrigger value="tabela" className="h-9">Tabela</TabsTrigger>
        </TabsList>

        <TabsContent value="geral" className="space-y-3">
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
            <FilterSection title="Resultado">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <FilterField label="Top N">
                  <Input
                    type="number"
                    min={1}
                    max={10000}
                    placeholder="Todas"
                    className="h-9"
                    value={urlTopN ?? defaultTopN ?? ""}
                    onChange={(e) => updateParams({ top_n: e.target.value || null })}
                  />
                </FilterField>
                <FilterField label="Mín Nota.Final">
                  <Input
                    type="number"
                    step={0.1}
                    min={0}
                    max={10}
                    placeholder="—"
                    className="h-9"
                    value={urlMinFinal ?? defaultMinFinal ?? ""}
                    onChange={(e) => updateParams({ min_final: e.target.value || null })}
                  />
                </FilterField>
                <FilterField label="Mín Calc">
                  <Input
                    type="number"
                    step={0.1}
                    min={0}
                    max={10}
                    placeholder="—"
                    className="h-9"
                    value={urlMinCalc ?? defaultMinCalc ?? ""}
                    onChange={(e) => updateParams({ min_calc: e.target.value || null })}
                  />
                </FilterField>
                <FilterField label="Mín PR">
                  <Input
                    type="number"
                    step={0.1}
                    min={0}
                    max={10}
                    placeholder="—"
                    className="h-9"
                    value={urlMinPr ?? defaultMinPredicted ?? ""}
                    onChange={(e) => updateParams({ min_pr: e.target.value || null })}
                  />
                </FilterField>
                <FilterField label="Capítulos">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      placeholder="Mín"
                      className="h-9"
                      value={searchParams.get("min_chapters") ?? ""}
                      onChange={(e) => updateParams({ min_chapters: e.target.value || null })}
                    />
                    <span className="text-xs text-muted-foreground">-</span>
                    <Input
                      type="number"
                      min={0}
                      placeholder="Máx"
                      className="h-9"
                      value={searchParams.get("max_chapters") ?? ""}
                      onChange={(e) => updateParams({ max_chapters: e.target.value || null })}
                    />
                  </div>
                </FilterField>
              </div>
            </FilterSection>

            <SortLevelsSection searchParams={searchParams} updateParams={updateParams} />
          </div>
        </TabsContent>

        <TabsContent value="status" className="space-y-3">
          <div className="grid gap-3 xl:grid-cols-3">
            <FilterSection title={`Publicação${selectedPublicationStatuses.size ? ` (${selectedPublicationStatuses.size})` : ""}`}>
              <div className="flex flex-wrap gap-2">
                {visiblePublicationStatuses.map((s) => (
                  <StatusButton
                    key={`publication-${s.status}`}
                    option={s}
                    active={selectedPublicationStatuses.has(s.status)}
                    onClick={() => toggleCsv("pub_status", s.status)}
                  />
                ))}
              </div>
            </FilterSection>

            <FilterSection title={`Status pessoal${isAllPersonal ? " (todos)" : selectedPerStatuses.size ? ` (${selectedPerStatuses.size})` : ""}`}>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => updateParams({ per_status: isAllPersonal ? null : "all" })}
                >
                  <Badge
                    variant={isAllPersonal ? "default" : "outline"}
                    className="cursor-pointer rounded-full px-2.5 py-1 text-xs"
                  >
                    Todos
                  </Badge>
                </button>
                {visiblePersonalStatuses.map((s) => (
                  <StatusButton
                    key={`personal-${s.status}`}
                    option={s}
                    active={!isAllPersonal && selectedPerStatuses.has(s.status)}
                    tooltip={s.comment}
                    onClick={() => {
                      if (isAllPersonal) {
                        updateParams({ per_status: s.status })
                      } else {
                        toggleCsv("per_status", s.status)
                      }
                    }}
                  />
                ))}
              </div>
            </FilterSection>

            <FilterSection title={`Interesse na sinopse${selectedSynopsisQ.size ? ` (${selectedSynopsisQ.size})` : ""}`}>
              <div className="flex flex-wrap gap-2">
                {SYNOPSIS_QUALITIES.map((q) => (
                  <button key={q} type="button" onClick={() => toggleCsv("synopsis_q", q)}>
                    <Badge
                      variant={selectedSynopsisQ.has(q) ? "default" : "outline"}
                      className="cursor-pointer rounded-full px-2.5 py-1 text-xs"
                    >
                      {q}
                    </Badge>
                  </button>
                ))}
              </div>
            </FilterSection>
          </div>
        </TabsContent>

        <TabsContent value="notas">
          <div className="grid gap-3 xl:grid-cols-2">
            <FilterSection title="Notas por critério">
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {CRITERION_SLUGS.map((slug) => (
                  <RangeFilterRow
                    key={slug}
                    label={CRITERION_LABELS[slug]}
                    minKey={`min_${slug}`}
                    maxKey={`max_${slug}`}
                    searchParams={searchParams}
                    updateParams={updateParams}
                  />
                ))}
              </div>
            </FilterSection>

            <FilterSection title="Notas gerais">
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                <RangeFilterRow
                  label="Nota.Final"
                  minKey="min_final"
                  maxKey="max_final"
                  searchParams={searchParams}
                  updateParams={updateParams}
                  step={0.1}
                />
                <RangeFilterRow
                  label="Nota.Pr"
                  minKey="min_pr"
                  maxKey="max_pr"
                  searchParams={searchParams}
                  updateParams={updateParams}
                  step={0.1}
                />
                <RangeFilterRow
                  label="Nota.IA"
                  minKey="min_calc"
                  maxKey="max_calc"
                  searchParams={searchParams}
                  updateParams={updateParams}
                  step={0.1}
                />
                <RangeFilterRow
                  label="Nota.M"
                  minKey="min_platform_avg"
                  maxKey="max_platform_avg"
                  searchParams={searchParams}
                  updateParams={updateParams}
                  step={0.1}
                />
                <RangeFilterRow
                  label="Votos"
                  minKey="min_votes"
                  maxKey="max_votes"
                  searchParams={searchParams}
                  updateParams={updateParams}
                  step={1}
                  max={10000000}
                />
              </div>
            </FilterSection>
          </div>
        </TabsContent>

        <TabsContent value="generos">
          <FilterSection
            title={`Gêneros${
              selectedGenreAll.size + selectedGenreAny.size + selectedGenreExclude.size
                ? ` (${selectedGenreAll.size + selectedGenreAny.size + selectedGenreExclude.size})`
                : ""
            }`}
          >
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar gênero..."
                className="h-9 pl-9 text-sm"
                value={genreSearch}
                onChange={(e) => setGenreSearch(e.target.value)}
              />
            </div>
            <GenreRuleGrid
              items={filteredGenres}
              selectedAll={selectedGenreAll}
              selectedAny={selectedGenreAny}
              selectedExclude={selectedGenreExclude}
              onSetRule={setGenreRule}
            />
          </FilterSection>
        </TabsContent>

        <TabsContent value="tags">
          <FilterSection
            title={`Tags${
              selectedTagAll.size + selectedTagAny.size + selectedTagExclude.size
                ? ` (${selectedTagAll.size + selectedTagAny.size + selectedTagExclude.size})`
                : ""
            }`}
          >
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar tag..."
                className="h-9 pl-9 text-sm"
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
              />
            </div>
            <GroupedTagRuleGrid
              items={filteredTagChoices}
              selectedAll={selectedTagAll}
              selectedAny={selectedTagAny}
              selectedExclude={selectedTagExclude}
              onSetRule={setTagRule}
            />
          </FilterSection>
        </TabsContent>

        <TabsContent value="tabela">
          <TableColumnsSection />
        </TabsContent>
      </Tabs>
    </div>
  )
}

"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo, useState, useTransition } from "react"
import type { ReactNode } from "react"
import { ArrowDown, ArrowUp, Bookmark, Check, ChevronDown, ChevronUp, Filter, Loader2, Minus, Pencil, Plus, RotateCcw, Save, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { getPersonalStatusDescription } from "@/lib/constants/personal-status-descriptions"
import { CRITERION_SLUGS, SYNOPSIS_QUALITIES } from "@/types/domain"
import { useCollapsedFilters } from "@/lib/use-collapsed-filters"
import { updateRankingPreferences } from "@/server/actions/settings"
import { saveFilterPreset, renameFilterPreset, deleteFilterPreset } from "@/server/actions/filter-presets"

interface SavedFilterPreset {
  id: string
  name: string
  query: string
}

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
  { value: "recommended", label: "Recomendado" },
  { value: "decision", label: "Prioridade" },
  { value: "expected_score", label: "Nota Prevista" },
  { value: "personal_fit", label: "Alinhamento" },
  { value: "alignment_score", label: "Veredito IA" },
  { value: "platform_avg", label: "Nota.M" },
  { value: "total_votes", label: "Votos" },
  { value: "title", label: "Título" },
  { value: "chapters", label: "Capítulos" },
  { value: "chapters_read", label: "Capítulos lidos" },
  { value: "year", label: "Ano" },
  { value: "synopsis_q", label: "Sinopse" },
  { value: "synopsis_pred", label: "Prev. sinopse (IA)" },
  { value: "publication_status", label: "Publicação" },
  { value: "personal_status", label: "Status pessoal" },
  { value: "updated_at", label: "Atualizado" },
  { value: "last_read_at", label: "Última leitura" },
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

const DEFAULT_SORT = "expected_score:desc"

function parseSortLevels(raw: string | null, defaultSort: string = DEFAULT_SORT): SortLevel[] {
  const src = raw ?? defaultSort
  return src.split(",").map((seg) => {
    const [field, dir] = seg.trim().split(":")
    const validField = SORTABLE_FIELDS.some((f) => f.value === field) ? field : "expected_score"
    return { field: validField, dir: dir === "asc" ? "asc" : "desc" }
  })
}

function encodeSortLevels(levels: SortLevel[]): string {
  return levels.map((l) => `${l.field}:${l.dir}`).join(",")
}

interface SortLevelsSectionProps {
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
  className?: string
  defaultSort?: string
}

function SortLevelsSection({ searchParams, updateParams, className, defaultSort }: SortLevelsSectionProps) {
  const rawSort = searchParams.get("sort")
  const levels = parseSortLevels(rawSort, defaultSort)

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
    setLevels(next.length ? next : [{ field: "expected_score", dir: "desc" }])
  }

  const add = () => {
    if (levels.length >= 5) return
    const used = new Set(levels.map((l) => l.field))
    const next = SORTABLE_FIELDS.find((f) => !used.has(f.value))
    setLevels([...levels, { field: next?.value ?? "calc_score", dir: "desc" }])
  }

  return (
    <FilterSection
      title="Ordenação"
      className={className}
      headerAction={
        levels.length < 5 && (
          <button type="button" onClick={add}>
            <Badge
              variant="outline"
              className="cursor-pointer rounded-full px-2.5 py-1 text-xs transition-transform hover:-translate-y-px"
            >
              + nível
            </Badge>
          </button>
        )
      }
    >
      <div className="space-y-2">
        <div className={`grid gap-2 ${levels.length > 1 ? "sm:grid-cols-2" : "grid-cols-1"}`}>
        {levels.map((level, i) => (
          <div key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)_4.5rem_2rem] items-center gap-2 rounded-lg border border-border/55 bg-background/45 p-1.5">
            <span className="text-xs text-muted-foreground w-4 shrink-0 text-right">{i + 1}.</span>
            <Select value={level.field} onValueChange={(v) => updateField(i, v)}>
              <SelectTrigger className="h-8 w-full text-xs">
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
              className="flex h-8 items-center justify-center gap-1 rounded-lg border border-border/70 bg-background/45 px-2 text-xs transition-colors hover:bg-muted"
              title={level.dir === "desc" ? "Decrescente" : "Crescente"}
            >
              {level.dir === "desc"
                ? <><ArrowDown className="h-3 w-3" /><span>Desc</span></>
                : <><ArrowUp className="h-3 w-3" /><span>Asc</span></>}
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={levels.length === 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 bg-background/45 transition-colors hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Remover ordenação"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        </div>
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
  comment: string | null
}

interface RankingFiltersProps {
  availableGenres: string[]
  availableTags: Array<{ slug: string; name: string; tag_group_id?: string | null; groupName?: string; subGroupName?: string; subGroupSlug?: string }>
  publicationStatuses?: StatusOption[]
  personalStatuses?: StatusOption[]
  defaultTopN: number | null
  /** Preferência "Nota Prevista mínima" (persistida na coluna min_final_score, repurposada). */
  defaultMinExpected: number | null
  /** Preferência "Alinhamento mínimo" (persistida na coluna min_calc_score, repurposada). */
  defaultMinFit?: number | null
  /** Preferência "Veredito IA mínimo" (persistida na coluna min_predicted_score, repurposada). */
  defaultMinAlign?: number | null
  basePath?: string
  hidePreferencesControls?: boolean
  /** Sort default efetivo (depende do plano: Free="recommended:desc", Pago="expected_score:desc"). */
  defaultSort?: string
  /** Conjuntos de filtros salvos do usuário para esta página (base_path). */
  savedPresets?: SavedFilterPreset[]
}

interface FilterSectionProps {
  title: string
  defaultOpen?: boolean
  headerAction?: React.ReactNode
  children: React.ReactNode
  className?: string
  contentClassName?: string
}

function FilterSection({
  title,
  headerAction,
  children,
  className,
  contentClassName,
}: FilterSectionProps) {
  return (
    <div className={`overflow-hidden rounded-lg border border-border/65 bg-background/45 ${className ?? ""}`}>
      <div className="flex min-h-[40px] sm:min-h-[46px] items-center justify-between gap-3 bg-card/60 px-3 py-2.5 transition-colors hover:bg-card/80 sm:px-4 sm:py-3">
        <span className="truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </span>
        {headerAction && <div className="shrink-0">{headerAction}</div>}
      </div>
      <div className={`border-t border-border/60 px-3 py-3 sm:px-4 sm:py-4 xl:px-5 xl:py-5 ${contentClassName ?? ""}`}>
        {children}
      </div>
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

function ScoreRangeCard({
  emoji,
  label,
  tooltip,
  minKey,
  maxKey,
  searchParams,
  updateParams,
  step = 0.5,
  min = 0,
  max = 10,
  className,
}: {
  emoji?: string
  label: string
  tooltip?: string
  minKey: string
  maxKey: string
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
  step?: number
  min?: number
  max?: number
  className?: string
}) {
  const urlMin = num(searchParams.get(minKey))
  const urlMax = num(searchParams.get(maxKey))
  const committed: [number, number] = [urlMin ?? min, urlMax ?? max]
  const [dragValue, setDragValue] = useState<[number, number] | null>(null)
  const display = dragValue ?? committed

  const isActive = urlMin !== undefined || urlMax !== undefined
  const decimals = step < 1 ? (step.toString().split(".")[1]?.length ?? 1) : 0
  const fmt = (v: number) => v.toFixed(decimals)
  const rangeLabel = dragValue || isActive ? `${fmt(display[0])} – ${fmt(display[1])}` : "Qualquer"

  const commit = (next: number[]) => {
    const [lo, hi] = next as [number, number]
    updateParams({
      [minKey]: lo > min ? String(lo) : null,
      [maxKey]: hi < max ? String(hi) : null,
    })
    setDragValue(null)
  }

  const reset = () => {
    setDragValue(null)
    updateParams({ [minKey]: null, [maxKey]: null })
  }

  const heading = (
    <div className="flex min-w-0 items-center gap-2">
      {emoji && <span className="text-base leading-none">{emoji}</span>}
      <span className="truncate text-sm font-medium">{label}</span>
    </div>
  )

  return (
    <div
      className={`group rounded-lg border bg-background/45 px-3 py-2.5 transition-colors ${
        isActive ? "border-primary/55 bg-primary/[0.04]" : "border-border/65 hover:border-border"
      } ${className ?? ""}`}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        {tooltip ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="min-w-0 cursor-help text-left">
                  {heading}
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs whitespace-pre-line text-xs">{tooltip}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : (
          heading
        )}
        <div className="flex shrink-0 items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="Editar manualmente"
                className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums transition-colors hover:ring-1 hover:ring-primary/40 ${
                  isActive ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground hover:bg-muted"
                }`}
              >
                {rangeLabel}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-auto p-2">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  placeholder="Mín"
                  size="sm"
                  className="h-8 w-20 text-xs"
                  value={searchParams.get(minKey) ?? ""}
                  onChange={(e) => updateParams({ [minKey]: e.target.value || null })}
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="number"
                  min={min}
                  max={max}
                  step={step}
                  placeholder="Máx"
                  size="sm"
                  className="h-8 w-20 text-xs"
                  value={searchParams.get(maxKey) ?? ""}
                  onChange={(e) => updateParams({ [maxKey]: e.target.value || null })}
                />
              </div>
            </PopoverContent>
          </Popover>
          <button
            type="button"
            onClick={reset}
            disabled={!isActive}
            aria-label="Limpar"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-default disabled:opacity-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <Slider
        value={display}
        min={min}
        max={max}
        step={step}
        minStepsBetweenThumbs={1}
        onValueChange={(v) => setDragValue([v[0], v[1]] as [number, number])}
        onValueCommit={commit}
        className="px-1"
      />
    </div>
  )
}

const VOTES_PRESETS: Array<{ label: string; min: number | null }> = [
  { label: "Qualquer", min: null },
  { label: "≥100", min: 100 },
  { label: "≥500", min: 500 },
  { label: "≥1k", min: 1000 },
  { label: "≥5k", min: 5000 },
  { label: "≥10k", min: 10000 },
]

function formatVotes(n: number): string {
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}k`
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return String(n)
}

function VotesPresetCard({
  searchParams,
  updateParams,
  className,
}: {
  searchParams: Pick<URLSearchParams, "get">
  updateParams: (updates: Record<string, string | null>) => void
  className?: string
}) {
  const currentMin = num(searchParams.get("min_votes"))
  const currentMax = num(searchParams.get("max_votes"))
  const isActive = currentMin !== undefined || currentMax !== undefined

  let activeLabel = "Qualquer"
  if (currentMin !== undefined && currentMax !== undefined) {
    activeLabel = `${formatVotes(currentMin)} – ${formatVotes(currentMax)}`
  } else if (currentMin !== undefined) {
    activeLabel = `≥${formatVotes(currentMin)}`
  } else if (currentMax !== undefined) {
    activeLabel = `≤${formatVotes(currentMax)}`
  }

  const activePreset = currentMax === undefined ? currentMin ?? null : undefined

  return (
    <div
      className={`rounded-lg border bg-background/45 px-3 py-2.5 transition-colors ${
        isActive ? "border-primary/55 bg-primary/[0.04]" : "border-border/65"
      } ${className ?? ""}`}
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-base leading-none">🗳️</span>
          <span className="truncate text-sm font-medium">Votos</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
              isActive ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground"
            }`}
          >
            {activeLabel}
          </span>
          <button
            type="button"
            onClick={() => updateParams({ min_votes: null, max_votes: null })}
            disabled={!isActive}
            aria-label="Limpar"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-default disabled:opacity-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {VOTES_PRESETS.map((preset) => {
          const active =
            activePreset !== undefined &&
            preset.min === activePreset &&
            (preset.min !== null || !isActive)
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() =>
                updateParams({
                  min_votes: preset.min !== null ? String(preset.min) : null,
                  max_votes: null,
                })
              }
            >
              <Badge
                variant={active ? "default" : "outline"}
                className="inline-flex h-7 cursor-pointer items-center rounded-full px-3 text-xs font-medium transition-transform hover:-translate-y-px"
              >
                {preset.label}
              </Badge>
            </button>
          )
        })}
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <Label className="shrink-0 text-xs font-medium text-muted-foreground">Manual</Label>
        <Input
          type="number"
          min={0}
          step={1}
          placeholder="Mín"
          className="h-8 w-24 text-xs"
          value={searchParams.get("min_votes") ?? ""}
          onChange={(e) => updateParams({ min_votes: e.target.value || null })}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          type="number"
          min={0}
          step={1}
          placeholder="Máx"
          className="h-8 w-24 text-xs"
          value={searchParams.get("max_votes") ?? ""}
          onChange={(e) => updateParams({ max_votes: e.target.value || null })}
        />
      </div>
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
    <button onClick={onClick} type="button" className="shrink-0">
      <Badge
        variant={active ? "default" : "outline"}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-transform hover:-translate-y-px"
        style={style}
      >
        {option.symbol && <span className="text-xs">{option.symbol}</span>}
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

function FacetLegend() {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/55 bg-background/45 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-semibold text-foreground/80">Seleção</span>
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2 py-0.5 text-emerald-300">
        <Plus className="h-3 w-3" /> obrigatório (AND)
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-sky-400/10 px-2 py-0.5 text-sky-300">
        <span className="inline-flex items-center gap-0.5">
          <Plus className="h-3 w-3" />
          <Plus className="h-3 w-3" />
        </span>{" "}
        opcional (OR)
      </span>
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-400/10 px-2 py-0.5 text-rose-300">
        <Minus className="h-3 w-3" /> excluir (NOT)
      </span>
    </div>
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
  subGroupName?: string
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
    none: "border-border/70 bg-background/45 text-foreground",
    all: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-400/25 dark:bg-emerald-400/12 dark:text-emerald-100",
    any: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-400/25 dark:bg-sky-400/12 dark:text-sky-100",
    exclude: "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-400/25 dark:bg-rose-400/12 dark:text-rose-100",
  }

  const stateLabel: Record<Exclude<FacetRule, null>, string> = {
    all: "AND",
    any: "OR",
    exclude: "EXCLUDE",
  }

  return (
    <div className="space-y-3">
      <FacetLegend />

      <div className="rounded-lg border border-border/65 bg-background/45 p-3">
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
                    <span className="shrink-0 rounded-full bg-background/80 px-1.5 py-0.5 text-[11px] font-semibold">
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
  allItems?: GroupedFacetedChoice[]
  selectedAll: Set<string>
  selectedAny: Set<string>
  selectedExclude: Set<string>
  onSetRule: (value: string, rule: FacetRule) => void
  searchActive?: boolean
}

const TAG_STATE_CLASS: Record<Exclude<FacetRule, null> | "none", string> = {
  none: "border-border/70 bg-background/45 text-foreground",
  all: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-400/25 dark:bg-emerald-400/12 dark:text-emerald-100",
  any: "border-sky-300 bg-sky-50 text-sky-950 dark:border-sky-400/25 dark:bg-sky-400/12 dark:text-sky-100",
  exclude: "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-400/25 dark:bg-rose-400/12 dark:text-rose-100",
}

const TAG_STATE_LABEL: Record<Exclude<FacetRule, null>, string> = {
  all: "AND",
  any: "OR",
  exclude: "EXCLUDE",
}

const TAG_CHIP_CLASS: Record<Exclude<FacetRule, null>, string> = {
  all: "border-emerald-400/60 bg-emerald-400/15 text-emerald-100",
  any: "border-sky-400/60 bg-sky-400/15 text-sky-100",
  exclude: "border-rose-400/60 bg-rose-400/15 text-rose-100",
}

const TAG_GRID_CLASS = "grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"

interface ActiveGroupBodyProps {
  items: GroupedFacetedChoice[]
  getRule: (value: string) => FacetRule
  renderItem: (item: GroupedFacetedChoice, withGroupHint?: boolean) => ReactNode
}

// Renders the active group's tags. If the group has sub-groups (an applied
// `tag_subgroup`), they become collapsible sections; otherwise the flat grid
// is kept unchanged (graceful degradation for groups not yet organized).
function ActiveGroupBody({ items, getRule, renderItem }: ActiveGroupBodyProps) {
  const hasSubgroups = items.some((it) => it.subGroupName)

  const sections = useMemo(() => {
    const sortItems = (arr: GroupedFacetedChoice[]) =>
      [...arr].sort((a, b) => {
        const weight = (r: FacetRule) => (r === "all" ? 0 : r === "any" ? 1 : r === "exclude" ? 2 : 3)
        const diff = weight(getRule(a.value)) - weight(getRule(b.value))
        return diff !== 0 ? diff : a.label.localeCompare(b.label)
      })
    const bySub = new Map<string, GroupedFacetedChoice[]>()
    const ungrouped: GroupedFacetedChoice[] = []
    for (const it of items) {
      if (it.subGroupName) {
        const arr = bySub.get(it.subGroupName) ?? []
        arr.push(it)
        bySub.set(it.subGroupName, arr)
      } else {
        ungrouped.push(it)
      }
    }
    const subs = [...bySub.entries()]
      .map(([name, its]) => ({ name, items: sortItems(its) }))
      .sort((a, b) => a.name.localeCompare(b.name))
    if (ungrouped.length > 0) subs.push({ name: "Outras", items: sortItems(ungrouped) })
    return subs
    // getRule depends on the parent's selection sets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // Default: collapsed, except sections that already have active selections.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set<string>()
    for (const s of sections) {
      if (s.items.some((it) => Boolean(getRule(it.value)))) open.add(s.name)
    }
    return open
  })
  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  if (!hasSubgroups) {
    return <div className={TAG_GRID_CLASS}>{items.map((item) => renderItem(item))}</div>
  }

  return (
    <div className="space-y-2">
      {sections.map((section) => {
        const selectedCount = section.items.filter((it) => Boolean(getRule(it.value))).length
        const open = expanded.has(section.name)
        return (
          <div key={section.name} className="overflow-hidden rounded-lg border border-border/55 bg-background/30">
            <button
              type="button"
              onClick={() => toggle(section.name)}
              aria-expanded={open}
              className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-background/50"
            >
              {open ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">{section.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground">{section.items.length}</span>
              {selectedCount > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400/25 px-1.5 text-[11px] font-bold tabular-nums text-emerald-100">
                  {selectedCount}
                </span>
              )}
            </button>
            {open && (
              <div className="px-3 pb-3">
                <div className={TAG_GRID_CLASS}>{section.items.map((item) => renderItem(item))}</div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function GroupedTagRuleGrid({
  items,
  allItems,
  selectedAll,
  selectedAny,
  selectedExclude,
  onSetRule,
  searchActive = false,
}: GroupedTagRuleGridProps) {
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
        // Fixed alphabetical order so selecting a tag doesn't move it.
        items: groupItems.sort((a, b) => a.label.localeCompare(b.label)),
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName))
  }, [items])

  // Lookup: slug -> { label, groupName } for the selection strip.
  // Uses the unfiltered list so selected chips keep their labels under active search.
  const itemBySlug = useMemo(() => {
    const map = new Map<string, GroupedFacetedChoice>()
    const source = allItems ?? items
    for (const item of source) map.set(item.value, item)
    return map
  }, [allItems, items])

  const selectedEntries = useMemo(() => {
    const rows: Array<{ slug: string; label: string; groupName: string; rule: Exclude<FacetRule, null> }> = []
    const push = (slug: string, rule: Exclude<FacetRule, null>) => {
      const item = itemBySlug.get(slug)
      rows.push({
        slug,
        label: item?.label ?? slug,
        groupName: item?.groupName ?? "—",
        rule,
      })
    }
    selectedAll.forEach((s) => push(s, "all"))
    selectedAny.forEach((s) => push(s, "any"))
    selectedExclude.forEach((s) => push(s, "exclude"))
    const ruleOrder = { all: 0, any: 1, exclude: 2 } as const
    rows.sort((a, b) => {
      const diff = ruleOrder[a.rule] - ruleOrder[b.rule]
      return diff !== 0 ? diff : a.label.localeCompare(b.label)
    })
    return rows
  }, [selectedAll, selectedAny, selectedExclude, itemBySlug])

  // Active group state. Initially: group with most selections, else first alphabetical.
  const computeDefaultGroup = () => {
    if (groups.length === 0) return null
    let best = groups[0].groupName
    let bestCount = -1
    for (const g of groups) {
      const count = g.items.filter((it) => Boolean(getRule(it.value))).length
      if (count > bestCount) {
        bestCount = count
        best = g.groupName
      }
    }
    return best
  }
  const [activeGroup, setActiveGroup] = useState<string | null>(computeDefaultGroup)

  // If the active group disappears (e.g., dataset changed), fall back to first.
  const activeGroupExists = activeGroup !== null && groups.some((g) => g.groupName === activeGroup)
  const effectiveActiveGroup = activeGroupExists ? activeGroup : groups[0]?.groupName ?? null

  const cycleRule = (rule: FacetRule): FacetRule =>
    rule === "all" ? "any" : rule === "any" ? "exclude" : rule === "exclude" ? null : "all"

  const renderItem = (item: GroupedFacetedChoice, withGroupHint = false) => {
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
        title={item.label}
        className={`grid h-10 grid-cols-[2rem_minmax(0,1fr)_2rem] items-center overflow-hidden rounded-lg border text-sm transition-colors ${TAG_STATE_CLASS[rule ?? "none"]}`}
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
          title={rule ? `${item.label} — clique para desmarcar` : item.label}
          className="flex h-full min-w-0 items-center justify-between gap-2 px-2 text-left disabled:cursor-default"
        >
          <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate font-medium">{item.label}</span>
            {withGroupHint && (
              <span className="truncate text-[11px] font-normal text-muted-foreground">{item.groupName}</span>
            )}
          </span>
          {rule && (
            <span className="shrink-0 rounded-full bg-background/80 px-1.5 py-0.5 text-[11px] font-semibold">
              {TAG_STATE_LABEL[rule]}
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

  const activeGroupData = effectiveActiveGroup
    ? groups.find((g) => g.groupName === effectiveActiveGroup)
    : null

  return (
    <div className="space-y-3">
      <FacetLegend />

      {selectedEntries.length > 0 && (
        <div className="rounded-lg border border-border/65 bg-background/45 px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span>Selecionadas</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal text-foreground">
              {selectedEntries.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedEntries.map((entry) => (
              <span
                key={`${entry.rule}-${entry.slug}`}
                className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium ${TAG_CHIP_CLASS[entry.rule]}`}
              >
                <button
                  type="button"
                  onClick={() => onSetRule(entry.slug, cycleRule(entry.rule))}
                  title={`${entry.label} — clique para alternar (atual: ${TAG_STATE_LABEL[entry.rule]})`}
                  className="flex items-center gap-1.5"
                >
                  <span className="truncate">{entry.label}</span>
                  <span className="rounded-full bg-background/30 px-1.5 py-0.5 text-[9px] font-bold">
                    {TAG_STATE_LABEL[entry.rule]}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onSetRule(entry.slug, null)}
                  aria-label={`Remover ${entry.label}`}
                  title={`Remover ${entry.label}`}
                  className="-mr-1 flex h-5 w-5 items-center justify-center rounded-full hover:bg-background/30"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {searchActive ? (
        items.length === 0 ? (
          <div className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
            Sem resultados
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {[...items]
              .sort((a, b) => a.label.localeCompare(b.label))
              .slice(0, 200)
              .map((item) => renderItem(item, true))}
            {items.length > 200 && (
              <div className="col-span-full rounded-lg border border-dashed border-border/60 p-2 text-center text-[11px] text-muted-foreground">
                Mostrando 200 de {items.length} resultados — refine a busca para ver mais.
              </div>
            )}
          </div>
        )
      ) : (
        <>
          {groups.length === 0 ? (
            <div className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
              Sem resultados
            </div>
          ) : (
            <>
              <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
                {groups.map((group) => {
                  const selectedCount = group.items.filter((it) => Boolean(getRule(it.value))).length
                  const isActive = group.groupName === effectiveActiveGroup
                  return (
                    <button
                      key={group.groupName}
                      type="button"
                      onClick={() => setActiveGroup(group.groupName)}
                      className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? "border-primary/60 bg-primary/15 text-primary"
                          : "border-border/65 bg-background/45 text-foreground hover:border-border hover:bg-background/70"
                      }`}
                    >
                      <span className="whitespace-nowrap">{group.groupName}</span>
                      <span className={`text-xs tabular-nums ${isActive ? "text-primary/80" : "text-muted-foreground"}`}>
                        {group.items.length}
                      </span>
                      {selectedCount > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-400/25 px-1.5 text-xs font-bold tabular-nums text-emerald-100">
                          {selectedCount}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {activeGroupData && (
                <div className="rounded-lg border border-border/65 bg-background/45 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold">{activeGroupData.groupName}</span>
                    <span className="text-muted-foreground tabular-nums">{activeGroupData.items.length} tags</span>
                  </div>
                  <ActiveGroupBody
                    key={activeGroupData.groupName}
                    items={activeGroupData.items}
                    getRule={getRule}
                    renderItem={renderItem}
                  />
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function SavedFiltersControl({
  presets,
  basePath,
  currentQuery,
  onApply,
  onChange,
}: {
  presets: SavedFilterPreset[]
  basePath: string
  currentQuery: string
  onApply: (query: string) => void
  onChange: (next: SavedFilterPreset[]) => void
}) {
  const [saveOpen, setSaveOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [name, setName] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [pending, startSaving] = useTransition()

  const startRename = (preset: SavedFilterPreset) => {
    setEditingId(preset.id)
    setEditingName(preset.name)
  }

  const cancelRename = () => {
    setEditingId(null)
    setEditingName("")
  }

  const commitRename = (preset: SavedFilterPreset) => {
    const trimmed = editingName.trim()
    if (!trimmed || trimmed === preset.name) {
      cancelRename()
      return
    }
    startSaving(async () => {
      const res = await renameFilterPreset({ id: preset.id, basePath, name: trimmed })
      if (res.error !== null) {
        toast.error(res.error)
        return
      }
      onChange(presets.map((p) => (p.id === preset.id ? { ...p, name: res.preset.name } : p)))
      cancelRename()
      toast.success(`Renomeado para "${res.preset.name}"`)
    })
  }

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    startSaving(async () => {
      const res = await saveFilterPreset({ basePath, name: trimmed, query: currentQuery })
      if (res.error !== null) {
        toast.error(res.error)
        return
      }
      const without = presets.filter((p) => p.name.toLowerCase() !== res.preset.name.toLowerCase())
      onChange([res.preset, ...without])
      setName("")
      setSaveOpen(false)
      toast.success(`Filtro "${res.preset.name}" salvo`)
    })
  }

  const remove = (preset: SavedFilterPreset) => {
    startSaving(async () => {
      const res = await deleteFilterPreset({ id: preset.id, basePath })
      if (res.error) {
        toast.error(res.error)
        return
      }
      onChange(presets.filter((p) => p.id !== preset.id))
      toast.success(`Filtro "${preset.name}" removido`)
    })
  }

  return (
    <>
      <Popover open={saveOpen} onOpenChange={setSaveOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" title="Salvar filtros atuais">
            <Save className="mr-1 h-3.5 w-3.5" />
            Salvar
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 space-y-2 p-3">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Nome do conjunto
          </Label>
          <div className="flex items-center gap-2">
            <Input
              autoFocus
              placeholder="Ex: Romance pendente"
              className="h-8 text-xs"
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault()
                  save()
                }
              }}
            />
            <Button size="sm" className="h-8 shrink-0" onClick={save} disabled={pending || !name.trim()}>
              Salvar
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Salva os filtros atuais (mesmo sem aplicar). Reusar um nome sobrescreve.
          </p>
        </PopoverContent>
      </Popover>

      <Popover open={listOpen} onOpenChange={setListOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" title="Filtros salvos">
            <Bookmark className="mr-1 h-3.5 w-3.5" />
            Salvos{presets.length > 0 ? ` (${presets.length})` : ""}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-1.5">
          {presets.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              Nenhum filtro salvo ainda.
            </p>
          ) : (
            <div className="max-h-72 space-y-0.5 overflow-y-auto">
              {presets.map((preset) => (
                editingId === preset.id ? (
                  <div key={preset.id} className="flex items-center gap-1 rounded-md p-1">
                    <Input
                      autoFocus
                      className="h-7 text-sm"
                      value={editingName}
                      maxLength={60}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          commitRename(preset)
                        } else if (e.key === "Escape") {
                          e.preventDefault()
                          cancelRename()
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => commitRename(preset)}
                      disabled={pending || !editingName.trim()}
                      aria-label="Confirmar novo nome"
                      title="Confirmar"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-30"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelRename}
                      aria-label="Cancelar"
                      title="Cancelar"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div
                    key={preset.id}
                    className="group flex items-center gap-1 rounded-md transition-colors hover:bg-muted/60"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onApply(preset.query)
                        setListOpen(false)
                      }}
                      title="Aplicar este conjunto de filtros"
                      className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                    >
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => startRename(preset)}
                      disabled={pending}
                      aria-label={`Renomear ${preset.name}`}
                      title={`Renomear ${preset.name}`}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(preset)}
                      disabled={pending}
                      aria-label={`Remover ${preset.name}`}
                      title={`Remover ${preset.name}`}
                      className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  )
}

export function RankingFilters({
  availableGenres,
  availableTags,
  publicationStatuses = [],
  personalStatuses = [],
  defaultTopN,
  defaultMinExpected,
  defaultMinFit = null,
  defaultMinAlign = null,
  basePath = "/ranking",
  hidePreferencesControls = false,
  defaultSort,
  savedPresets = [],
}: RankingFiltersProps) {
  const router = useRouter()
  const appliedSearchParams = useSearchParams()
  const appliedSearchString = appliedSearchParams.toString()
  const [draftSearch, setDraftSearch] = useState(appliedSearchString)
  const searchParams = useMemo(() => new URLSearchParams(draftSearch), [draftSearch])
  // isApplying: a navegação por filtro (router.replace) roda numa transition que
  // fica pendente enquanto o servidor re-renderiza o ranking (~1s). Sem expor isso,
  // o clique em "Aplicar filtros" ficava sem feedback nenhum nesse intervalo.
  const [isApplying, startTransition] = useTransition()
  const [collapsed, setCollapsed] = useCollapsedFilters(`ranking:${basePath}`)
  const [presets, setPresets] = useState<SavedFilterPreset[]>(savedPresets)

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

  // Top N + nota prevista mínima (URL pode sobrescrever as preferências do DB).
  // O legado min_calc/min_pr saiu — a preferência "Nota Prevista mínima" é
  // persistida na coluna min_final_score (repurposada no cutover Fase 1.5).
  const urlTopN = num(searchParams.get("top_n"))
  const urlMinExpected = num(searchParams.get("min_expected"))
  const urlMinFit = num(searchParams.get("min_fit"))
  const urlMinAlign = num(searchParams.get("min_align"))

  const currentTopN = urlTopN ?? defaultTopN ?? undefined
  const currentMinExpected = urlMinExpected ?? defaultMinExpected ?? undefined
  // Alinhamento/Veredito IA também são preferências (colunas min_calc/min_predicted
  // repurposadas) — preservamos o default ao salvar pra não zerar o que foi
  // definido em /preferencias.
  const currentMinFit = urlMinFit ?? defaultMinFit ?? undefined
  const currentMinAlign = urlMinAlign ?? defaultMinAlign ?? undefined

  const prefsDirty =
    (urlTopN !== undefined && urlTopN !== (defaultTopN ?? undefined)) ||
    (urlMinExpected !== undefined && urlMinExpected !== (defaultMinExpected ?? undefined)) ||
    (urlMinFit !== undefined && urlMinFit !== (defaultMinFit ?? undefined)) ||
    (urlMinAlign !== undefined && urlMinAlign !== (defaultMinAlign ?? undefined))

  const savePrefs = async () => {
    const result = await updateRankingPreferences({
      top_n: currentTopN ?? null,
      min_calc_score: currentMinFit ?? null,
      min_predicted_score: currentMinAlign ?? null,
      min_final_score: currentMinExpected ?? null,
    })
    if (result.error) {
      toast.error(`Erro ao salvar: ${result.error}`)
      return
    }
    toast.success("Preferências de ranking atualizadas")
  }

  const applyAllFilters = () => {
    const target = draftSearch ? `${basePath}?${draftSearch}` : basePath
    startTransition(() => router.replace(target))
  }

  const clearAll = () => setDraftSearch("")

  const applyPreset = (query: string) => {
    setDraftSearch(query)
    const target = query ? `${basePath}?${query}` : basePath
    startTransition(() => router.replace(target))
  }

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
  const selectedSynopsisPred = csvSet("synopsis_pred")

  const DEFAULT_PUB_STATUS = "Completed"
  const DEFAULT_PER_STATUS = "Want to Read"

  const pubStatusParam = searchParams.get("pub_status")
  const isAllPublication = pubStatusParam === "all"
  const selectedPublicationStatuses = isAllPublication
    ? new Set<string>()
    : pubStatusParam != null
      ? csvSet("pub_status")
      : new Set<string>([DEFAULT_PUB_STATUS])

  const togglePublicationStatus = (status: string) => {
    if (isAllPublication) {
      updateParams({ pub_status: status })
      return
    }
    if (pubStatusParam == null) {
      if (status === DEFAULT_PUB_STATUS) {
        updateParams({ pub_status: "all" })
      } else {
        const seeded = new Set<string>([DEFAULT_PUB_STATUS, status])
        updateParams({ pub_status: [...seeded].join(",") })
      }
      return
    }
    toggleCsv("pub_status", status)
  }

  const perStatusParam = searchParams.get("per_status")
  const isAllPersonal = perStatusParam === "all"
  const selectedPerStatuses = isAllPersonal
    ? new Set<string>()
    : perStatusParam != null
      ? csvSet("per_status")
      : new Set<string>([DEFAULT_PER_STATUS])

  const togglePersonalStatus = (status: string) => {
    if (isAllPersonal) {
      updateParams({ per_status: status })
      return
    }
    if (perStatusParam == null) {
      if (status === DEFAULT_PER_STATUS) {
        updateParams({ per_status: "all" })
      } else {
        const seeded = new Set<string>([DEFAULT_PER_STATUS, status])
        updateParams({ per_status: [...seeded].join(",") })
      }
      return
    }
    toggleCsv("per_status", status)
  }

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
      subGroupName: tag.subGroupName,
    })),
    [filteredTags]
  )
  const allTagChoices = useMemo(
    () => availableTags.map((tag) => ({
      value: tag.slug,
      label: tag.name,
      groupName: tag.groupName ?? "Sem grupo",
      subGroupName: tag.subGroupName,
    })),
    [availableTags]
  )
  const tagNameBySlug = useMemo(
    () => new Map(availableTags.map((tag) => [tag.slug, tag.name])),
    [availableTags]
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

  const activeFilterChips: Array<{ key: string; label: string; onRemove: () => void }> = []
  const pushRangeChip = (key: string, label: string, minKey: string, maxKey: string) => {
    const min = searchParams.get(minKey)
    const max = searchParams.get(maxKey)
    if (!min && !max) return
    const suffix = min && max ? `${min} - ${max}` : min ? `>= ${min}` : `<= ${max}`
    activeFilterChips.push({
      key,
      label: `${label}: ${suffix}`,
      onRemove: () => updateParams({ [minKey]: null, [maxKey]: null }),
    })
  }

  if (searchParams.has("top_n")) {
    activeFilterChips.push({
      key: "top_n",
      label: `Top N: ${searchParams.get("top_n")}`,
      onRemove: () => updateParams({ top_n: null }),
    })
  }
  pushRangeChip("chapters", "Capítulos", "min_chapters", "max_chapters")
  pushRangeChip("expected", "Nota Prevista", "min_expected", "max_expected")
  pushRangeChip("fit", "Alinhamento", "min_fit", "max_fit")
  pushRangeChip("align", "Veredito IA", "min_align", "max_align")
  pushRangeChip("platform", "Nota.M", "min_platform_avg", "max_platform_avg")
  pushRangeChip("votes", "Votos", "min_votes", "max_votes")
  for (const slug of CRITERION_SLUGS) {
    pushRangeChip(`crit-${slug}`, CRITERION_LABELS[slug] ?? slug, `min_${slug}`, `max_${slug}`)
  }
  if (isAllPublication) {
    activeFilterChips.push({
      key: "pub-all",
      label: "Publicação: Todos",
      onRemove: () => updateParams({ pub_status: null }),
    })
  } else {
    selectedPublicationStatuses.forEach((status) => {
      activeFilterChips.push({
        key: `pub-${status}`,
        label: `Publicação: ${status}`,
        onRemove: () => togglePublicationStatus(status),
      })
    })
  }
  if (isAllPersonal) {
    activeFilterChips.push({
      key: "personal-all",
      label: "Status: Todos",
      onRemove: () => updateParams({ per_status: null }),
    })
  } else {
    selectedPerStatuses.forEach((status) => {
      activeFilterChips.push({
        key: `personal-${status}`,
        label: `Status: ${status}`,
        onRemove: () => togglePersonalStatus(status),
      })
    })
  }
  selectedSynopsisQ.forEach((quality) => {
    activeFilterChips.push({
      key: `synopsis-${quality}`,
      label: `Sinopse: ${quality}`,
      onRemove: () => toggleCsv("synopsis_q", quality),
    })
  })
  selectedSynopsisPred.forEach((quality) => {
    activeFilterChips.push({
      key: `synopsis-pred-${quality}`,
      label: `Prev. sinopse: ${quality}`,
      onRemove: () => toggleCsv("synopsis_pred", quality),
    })
  })
  selectedGenreAll.forEach((genre) => {
    activeFilterChips.push({
      key: `genre-all-${genre}`,
      label: `+ Gênero: ${genre}`,
      onRemove: () => setGenreRule(genre, null),
    })
  })
  selectedGenreAny.forEach((genre) => {
    activeFilterChips.push({
      key: `genre-any-${genre}`,
      label: `Gênero opcional: ${genre}`,
      onRemove: () => setGenreRule(genre, null),
    })
  })
  selectedGenreExclude.forEach((genre) => {
    activeFilterChips.push({
      key: `genre-exclude-${genre}`,
      label: `- Gênero: ${genre}`,
      onRemove: () => setGenreRule(genre, null),
    })
  })
  selectedTagAll.forEach((slug) => {
    activeFilterChips.push({
      key: `tag-all-${slug}`,
      label: `+ Tag: ${tagNameBySlug.get(slug) ?? slug}`,
      onRemove: () => setTagRule(slug, null),
    })
  })
  selectedTagAny.forEach((slug) => {
    activeFilterChips.push({
      key: `tag-any-${slug}`,
      label: `Tag opcional: ${tagNameBySlug.get(slug) ?? slug}`,
      onRemove: () => setTagRule(slug, null),
    })
  })
  selectedTagExclude.forEach((slug) => {
    activeFilterChips.push({
      key: `tag-exclude-${slug}`,
      label: `- Tag: ${tagNameBySlug.get(slug) ?? slug}`,
      onRemove: () => setTagRule(slug, null),
    })
  })

  const activeFilterLabel =
    activeFilterChips.length === 1 ? "1 seleção" : `${activeFilterChips.length} seleções`

  return (
    <div className="rounded-xl border border-border/70 bg-card/58 p-4 shadow-sm shadow-black/5 backdrop-blur">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Filter className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">Filtros</h2>
              {activeFilterChips.length > 0 && (
                <span className="rounded-full border border-border/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {activeFilterLabel}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ajuste os critérios e aplique quando terminar.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {!collapsed && (
            <SavedFiltersControl
              presets={presets}
              basePath={basePath}
              currentQuery={draftSearch}
              onApply={applyPreset}
              onChange={setPresets}
            />
          )}
          {!collapsed && (
            <Button size="sm" onClick={applyAllFilters} disabled={isApplying || !filtersDirty}>
              {isApplying ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  Aplicando…
                </>
              ) : (
                "Aplicar filtros"
              )}
            </Button>
          )}
          {!collapsed && hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearAll}>
              <X className="mr-1 h-3.5 w-3.5" />
              Limpar
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Mostrar filtros" : "Ocultar filtros"}
            title={collapsed ? "Mostrar filtros" : "Ocultar filtros"}
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {!collapsed && (
      <Tabs defaultValue="geral" className="gap-4">
        <TabsList className="!h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg bg-background/40 p-1 [scrollbar-width:none] xl:grid xl:grid-cols-4 [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="geral" className="h-9 min-w-20 flex-none text-sm data-[state=active]:bg-card/85 data-[state=active]:shadow-sm xl:min-w-0 xl:flex-1">Geral</TabsTrigger>
          <TabsTrigger value="notas" className="h-9 min-w-20 flex-none text-sm data-[state=active]:bg-card/85 data-[state=active]:shadow-sm xl:min-w-0 xl:flex-1">Notas</TabsTrigger>
          <TabsTrigger value="generos" className="h-9 min-w-20 flex-none text-sm data-[state=active]:bg-card/85 data-[state=active]:shadow-sm xl:min-w-0 xl:flex-1">Gêneros</TabsTrigger>
          <TabsTrigger value="tags" className="h-9 min-w-20 flex-none text-sm data-[state=active]:bg-card/85 data-[state=active]:shadow-sm xl:min-w-0 xl:flex-1">Tags</TabsTrigger>
        </TabsList>

        <TabsContent value="geral">
          <div className="grid grid-cols-12 gap-3">
            <div className="col-span-12 grid gap-3 md:grid-cols-[44.5fr_55.5fr]">
            <FilterSection
              title={`Publicação${isAllPublication ? " (todos)" : selectedPublicationStatuses.size ? ` (${selectedPublicationStatuses.size})` : ""}`}
              headerAction={
                <button
                  type="button"
                  onClick={() => updateParams({ pub_status: isAllPublication ? null : "all" })}
                >
                  <Badge
                    variant={isAllPublication ? "default" : "outline"}
                    className="cursor-pointer rounded-full px-2.5 py-1 text-xs transition-transform hover:-translate-y-px"
                  >
                    Todos
                  </Badge>
                </button>
              }
            >
              <div className="flex flex-wrap gap-2">
                {visiblePublicationStatuses.map((s) => (
                  <StatusButton
                    key={`publication-${s.status}`}
                    option={s}
                    active={isAllPublication || selectedPublicationStatuses.has(s.status)}
                    onClick={() => togglePublicationStatus(s.status)}
                  />
                ))}
              </div>
            </FilterSection>

            <FilterSection
              title={`Status pessoal${isAllPersonal ? " (todos)" : selectedPerStatuses.size ? ` (${selectedPerStatuses.size})` : ""}`}
              headerAction={
                <button
                  type="button"
                  onClick={() => updateParams({ per_status: isAllPersonal ? null : "all" })}
                >
                  <Badge
                    variant={isAllPersonal ? "default" : "outline"}
                    className="cursor-pointer rounded-full px-2.5 py-1 text-xs transition-transform hover:-translate-y-px"
                  >
                    Todos
                  </Badge>
                </button>
              }
            >
              <div className="flex flex-wrap gap-2">
                {visiblePersonalStatuses.map((s) => (
                  <StatusButton
                    key={`personal-${s.status}`}
                    option={s}
                    active={isAllPersonal || selectedPerStatuses.has(s.status)}
                    tooltip={getPersonalStatusDescription(s.status, s.comment)}
                    onClick={() => togglePersonalStatus(s.status)}
                  />
                ))}
              </div>
            </FilterSection>
            </div>

            <FilterSection
              title="Critérios gerais"
              className="col-span-12 xl:col-span-6 flex flex-col"
              contentClassName="flex-1 flex flex-col justify-center"
            >
              {!hidePreferencesControls && prefsDirty && (
                <div className="mb-4 flex justify-end">
                  <Button variant="outline" size="sm" onClick={savePrefs} className="h-8">
                    <Save className="mr-1.5 h-3.5 w-3.5" /> Salvar como padrão
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-start gap-x-6 gap-y-4">
                {/* Top N */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                    Top N
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={30}
                    placeholder="Todas"
                    size="sm"
                    className="w-16 text-center h-8"
                    value={urlTopN ?? defaultTopN ?? ""}
                    onChange={(e) => updateParams({ top_n: e.target.value || null })}
                  />
                </div>

                {/* Divisor vertical */}
                <div className="hidden sm:block w-px h-6 bg-border/40 shrink-0 self-center" />

                {/* Capítulos */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                    Capítulos
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={0}
                      placeholder="Mín"
                      size="sm"
                      className="w-16 text-center h-8"
                      value={searchParams.get("min_chapters") ?? ""}
                      onChange={(e) => updateParams({ min_chapters: e.target.value || null })}
                    />
                    <span className="text-xs font-semibold text-muted-foreground shrink-0">-</span>
                    <Input
                      type="number"
                      min={0}
                      placeholder="Máx"
                      size="sm"
                      className="w-16 text-center h-8"
                      value={searchParams.get("max_chapters") ?? ""}
                      onChange={(e) => updateParams({ max_chapters: e.target.value || null })}
                    />
                  </div>
                </div>

                {/* Divisor vertical */}
                <div className="hidden sm:block w-px h-6 bg-border/40 shrink-0 self-center" />

                {/* Interesse na Sinopse */}
                <div className="flex items-center gap-2">
                  <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                    Interesse
                  </Label>
                  <div className="flex items-center gap-1.5">
                    {SYNOPSIS_QUALITIES.map((q) => (
                      <button key={q} type="button" onClick={() => toggleCsv("synopsis_q", q)}>
                        <Badge
                          variant={selectedSynopsisQ.has(q) ? "default" : "outline"}
                          className="inline-flex h-8 cursor-pointer items-center justify-center rounded-full px-3 text-xs font-semibold transition-all hover:scale-105 active:scale-95 duration-200"
                        >
                          {q}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Divisor vertical */}
                <div className="hidden sm:block w-px h-6 bg-border/40 shrink-0 self-center" />

                {/* Previsão de Interesse na Sinopse (IA) */}
                <div className="flex items-center gap-2">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Label className="cursor-help text-xs font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                          Prev. IA
                        </Label>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        Previsão da IA de quanto a sinopse vai te interessar (♥ a ♥♥♥♥), com base no
                        seu perfil de gosto. Diferente do interesse que você informou.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <div className="flex items-center gap-1.5">
                    {SYNOPSIS_QUALITIES.map((q) => (
                      <button key={q} type="button" onClick={() => toggleCsv("synopsis_pred", q)}>
                        <Badge
                          variant={selectedSynopsisPred.has(q) ? "default" : "outline"}
                          className="inline-flex h-8 cursor-pointer items-center justify-center rounded-full px-3 text-xs font-semibold transition-all hover:scale-105 active:scale-95 duration-200"
                        >
                          {q}
                        </Badge>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </FilterSection>

            <SortLevelsSection
              searchParams={searchParams}
              updateParams={updateParams}
              className="col-span-12 xl:col-span-6"
              defaultSort={defaultSort}
            />
          </div>
        </TabsContent>

        <TabsContent value="notas">
          <div className="grid gap-3 xl:grid-cols-2">
            <FilterSection title="Notas por critério">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {CRITERION_SLUGS.map((slug) => (
                  <ScoreRangeCard
                    key={slug}
                    emoji={CRITERIA_INFO[slug]?.emoji}
                    label={CRITERION_LABELS[slug]}
                    tooltip={CRITERIA_INFO[slug]?.description}
                    minKey={`min_${slug}`}
                    maxKey={`max_${slug}`}
                    step={1}
                    searchParams={searchParams}
                    updateParams={updateParams}
                  />
                ))}
              </div>
            </FilterSection>

            <FilterSection title="Notas gerais">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <ScoreRangeCard
                  emoji="🎯"
                  label="Nota Prevista"
                  tooltip="Nota que o modelo prevê que você daria à obra (0–10). Headline do ranking."
                  minKey="min_expected"
                  maxKey="max_expected"
                  step={0.5}
                  searchParams={searchParams}
                  updateParams={updateParams}
                />
                <ScoreRangeCard
                  emoji="🧭"
                  label="Alinhamento"
                  tooltip="Percentil de alinhamento com seu perfil de gosto (0–100). Top 25% = ≥ 75."
                  minKey="min_fit"
                  maxKey="max_fit"
                  step={5}
                  min={0}
                  max={100}
                  searchParams={searchParams}
                  updateParams={updateParams}
                />
                <ScoreRangeCard
                  emoji="🌐"
                  label="Média externa"
                  tooltip="Nota.M — média ponderada das plataformas externas (0–10)."
                  minKey="min_platform_avg"
                  maxKey="max_platform_avg"
                  step={0.5}
                  searchParams={searchParams}
                  updateParams={updateParams}
                />
                <ScoreRangeCard
                  emoji="🤖"
                  label="Veredito IA"
                  tooltip="Re-rank do consultor IA (0–100), sob demanda. Só obras já rankeadas têm valor."
                  minKey="min_align"
                  maxKey="max_align"
                  step={5}
                  min={0}
                  max={100}
                  searchParams={searchParams}
                  updateParams={updateParams}
                />
                <VotesPresetCard
                  searchParams={searchParams}
                  updateParams={updateParams}
                  className="lg:col-span-2"
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
              allItems={allTagChoices}
              selectedAll={selectedTagAll}
              selectedAny={selectedTagAny}
              selectedExclude={selectedTagExclude}
              onSetRule={setTagRule}
              searchActive={tagSearch.trim().length > 0}
            />
          </FilterSection>
        </TabsContent>
      </Tabs>
      )}

      {!collapsed && (activeFilterChips.length > 0 || filtersDirty) && (
        <div className="mt-4 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            {activeFilterChips.length > 0 && (
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Filtros ativos
              </span>
            )}
            {activeFilterChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={chip.onRemove}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/80 bg-background/55 px-2.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/10"
                title="Remover filtro"
              >
                {chip.label}
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            ))}
            {activeFilterChips.length > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="h-7 px-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                limpar filtros
              </button>
            )}
            {filtersDirty && (
              <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-semibold text-amber-600 dark:text-amber-300">
                <span className="size-1.5 rounded-full bg-amber-500 dark:bg-amber-300" />
                não aplicados
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

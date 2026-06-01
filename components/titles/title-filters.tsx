"use client"

import { useCallback, useMemo, useRef, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Filter, RotateCcw, Search, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TagFilter } from "@/components/titles/tag-filter"
import type { TagOption } from "@/server/queries/tags"
import { AI_EVAL_STATUSES, CRITERION_SLUGS, SYNOPSIS_QUALITIES } from "@/types/domain"
import { getPersonalStatusDescription } from "@/lib/constants/personal-status-descriptions"
import { cn } from "@/lib/utils"
import { useCollapsedFilters } from "@/lib/use-collapsed-filters"

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
  { value: "expected_score", label: "Nota Prevista" },
  { value: "platform_avg", label: "Nota.M" },
  { value: "total_votes", label: "Votos" },
  { value: "title", label: "Título" },
  { value: "chapters", label: "Capítulos" },
]

const AI_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente atributos",
  review_pending: "Pendente IA Rk",
  done: "Avaliado",
  skipped: "Pulado",
}

interface StatusOption {
  id: number
  status: string
  slug: string
  color: string | null
  symbol: string | null
  comment: string | null
}

interface TitleFiltersProps {
  availableGenres: string[]
  availableTags: TagOption[]
  publicationStatuses?: StatusOption[]
  personalStatuses?: StatusOption[]
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

function csvSet(searchParams: URLSearchParams, key: string): Set<string> {
  const v = searchParams.get(key)
  if (!v) return new Set()
  return new Set(v.split(",").map((s) => s.trim()).filter(Boolean))
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

function FilterCard({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border bg-background p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  )
}

function num(v: string | null | undefined): number | undefined {
  if (!v) return undefined
  const n = parseFloat(v)
  return isNaN(n) ? undefined : n
}

function ScoreRangeCard({
  emoji,
  label,
  tooltip,
  minKey,
  maxKey,
  searchParams,
  updateParams,
  step = 0.1,
  min = 0,
  max = 10,
  className,
}: {
  emoji?: string
  label: string
  tooltip?: string
  minKey: string
  maxKey: string
  searchParams: URLSearchParams
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
      className={cn(
        "group rounded-lg border bg-background/45 px-2.5 py-2 transition-colors",
        isActive ? "border-primary/55 bg-primary/[0.04]" : "border-border/65 hover:border-border",
        className
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
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
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums transition-colors hover:ring-1 hover:ring-primary/40",
                  isActive ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground hover:bg-muted"
                )}
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

function formatVotes(n: number): string {
  if (n >= 1000 && n % 1000 === 0) return `${n / 1000}k`
  if (n >= 10000) return `${(n / 1000).toFixed(0)}k`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`
  return String(n)
}

function VotesRangeCard({
  searchParams,
  updateParams,
  className,
}: {
  searchParams: URLSearchParams
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

  return (
    <div
      className={cn(
        "rounded-lg border bg-background/45 px-2.5 py-2 transition-colors",
        isActive ? "border-primary/55 bg-primary/[0.04]" : "border-border/65",
        className
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-base leading-none">🗳️</span>
          <span className="truncate text-sm font-medium">Votos</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
              isActive ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground"
            )}
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
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          min={0}
          step={1}
          placeholder="Mín"
          className="h-8 w-full min-w-0 text-xs"
          value={searchParams.get("min_votes") ?? ""}
          onChange={(e) => updateParams({ min_votes: e.target.value || null })}
        />
        <span className="text-xs text-muted-foreground">–</span>
        <Input
          type="number"
          min={0}
          step={1}
          placeholder="Máx"
          className="h-8 w-full min-w-0 text-xs"
          value={searchParams.get("max_votes") ?? ""}
          onChange={(e) => updateParams({ max_votes: e.target.value || null })}
        />
      </div>
    </div>
  )
}

const SEARCH_HISTORY_KEY = "titles_search_history_v1"
const SEARCH_HISTORY_LIMIT = 20

function readSearchHistory(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(SEARCH_HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === "string").slice(0, SEARCH_HISTORY_LIMIT)
  } catch {
    return []
  }
}

function writeSearchHistory(history: string[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, SEARCH_HISTORY_LIMIT)))
  } catch {
    // ignore
  }
}

function pushToSearchHistory(term: string): string[] {
  const trimmed = term.trim()
  if (!trimmed) return readSearchHistory()
  const current = readSearchHistory()
  const lower = trimmed.toLowerCase()
  const filtered = current.filter((t) => t.toLowerCase() !== lower)
  const next = [trimmed, ...filtered].slice(0, SEARCH_HISTORY_LIMIT)
  writeSearchHistory(next)
  return next
}

function SearchInputWithHistory({
  value,
  onChange,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: (v: string) => void
}) {
  const [history, setHistory] = useState<string[]>(() => readSearchHistory())
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = (term: string) => {
    setHistory(pushToSearchHistory(term))
    setOpen(false)
    onSubmit(term)
  }

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase()
    if (!q) return history
    return history.filter((t) => t.toLowerCase().includes(q))
  }, [history, value])

  const showPopover = open && filtered.length > 0

  const clearHistory = () => {
    writeSearchHistory([])
    setHistory([])
    setOpen(false)
  }

  return (
    <Popover open={showPopover} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="title-filter-search"
            ref={inputRef}
            placeholder="Digite o nome da obra e pressione Enter"
            className="h-9 pl-9 pr-9 text-sm"
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                submit(value)
              } else if (e.key === "Escape") {
                setOpen(false)
              }
            }}
          />
          {value && (
            <button
              type="button"
              aria-label="Limpar busca por título"
              onClick={() => {
                onChange("")
                inputRef.current?.focus()
              }}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Command shouldFilter={false}>
          <CommandList>
            <CommandEmpty>Nenhuma busca recente</CommandEmpty>
            {filtered.length > 0 && (
              <CommandGroup heading="Buscas recentes">
                {filtered.map((term) => (
                  <CommandItem
                    key={term}
                    value={term}
                    onSelect={() => submit(term)}
                    onMouseDown={(e) => e.preventDefault()}
                  >
                    <Search className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    {term}
                  </CommandItem>
                ))}
                <CommandItem
                  value="__clear__"
                  onSelect={clearHistory}
                  onMouseDown={(e) => e.preventDefault()}
                  className="text-muted-foreground"
                >
                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                  Limpar histórico
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function TitleFilters({
  availableGenres,
  availableTags,
  publicationStatuses = [],
  personalStatuses = [],
}: TitleFiltersProps) {
  const router = useRouter()
  const appliedSearchParams = useSearchParams()
  const appliedSearchString = appliedSearchParams.toString()
  const [draftSearch, setDraftSearch] = useState(appliedSearchString)
  const searchParams = useMemo(() => new URLSearchParams(draftSearch), [draftSearch])
  const [, startTransition] = useTransition()
  const [tabsExpanded, setTabsExpanded] = useState(false)
  const [collapsed, setCollapsed] = useCollapsedFilters("titles")

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      setDraftSearch((current) => {
        const params = new URLSearchParams(current)
        for (const [key, value] of Object.entries(updates)) {
          if (value === null || value === "") params.delete(key)
          else params.set(key, value)
        }
        return params.toString()
      })
    },
    []
  )

  const filtersDirty = draftSearch !== appliedSearchString
  const hasFilters = draftSearch !== "" || appliedSearchString !== ""

  const applyAllFilters = () => {
    const target = draftSearch ? `/titles?${draftSearch}` : "/titles"
    startTransition(() => router.replace(target))
  }
  const clearAll = () => setDraftSearch("")

  // Search
  const currentSearch = searchParams.get("search") ?? ""

  // Sort
  const rawSort = searchParams.get("sort") ?? "expected_score:desc"
  const [sortField, sortDir] = (() => {
    const [f, d] = rawSort.split(":")
    const validField = SORTABLE_FIELDS.some((x) => x.value === f) ? f : "expected_score"
    return [validField, d === "asc" ? "asc" : "desc"] as const
  })()
  const setSort = (field: string, dir: "asc" | "desc") =>
    updateParams({ sort: `${field}:${dir}` })

  // Multi-select helpers
  const toggleCsv = (key: string, item: string) => {
    const set = csvSet(searchParams, key)
    if (set.has(item)) set.delete(item)
    else set.add(item)
    updateParams({ [key]: set.size === 0 ? null : [...set].join(",") })
  }

  const visiblePublicationStatuses = useMemo(
    () => dedupeStatusOptions(publicationStatuses),
    [publicationStatuses]
  )
  const visiblePersonalStatuses = useMemo(
    () => dedupeStatusOptions(personalStatuses),
    [personalStatuses]
  )

  const pubStatusParam = searchParams.get("pub_status")
  const isAllPub = pubStatusParam === "all"
  const selectedPubStatuses = isAllPub
    ? new Set<string>(visiblePublicationStatuses.map((s) => s.status))
    : pubStatusParam != null
      ? csvSet(searchParams, "pub_status")
      : new Set<string>()
  const togglePubStatus = (status: string) => {
    const next = new Set(selectedPubStatuses)
    if (next.has(status)) next.delete(status)
    else next.add(status)
    if (next.size === 0) updateParams({ pub_status: null })
    else if (
      next.size === visiblePublicationStatuses.length &&
      visiblePublicationStatuses.every((s) => next.has(s.status))
    ) {
      updateParams({ pub_status: "all" })
    } else {
      updateParams({ pub_status: [...next].join(",") })
    }
  }

  const perStatusParam = searchParams.get("per_status")
  const isAllPer = perStatusParam === "all"
  const selectedPerStatuses = isAllPer
    ? new Set<string>(visiblePersonalStatuses.map((s) => s.status))
    : perStatusParam != null
      ? csvSet(searchParams, "per_status")
      : new Set<string>()
  const togglePerStatus = (status: string) => {
    const next = new Set(selectedPerStatuses)
    if (next.has(status)) next.delete(status)
    else next.add(status)
    if (next.size === 0) updateParams({ per_status: null })
    else if (
      next.size === visiblePersonalStatuses.length &&
      visiblePersonalStatuses.every((s) => next.has(s.status))
    ) {
      updateParams({ per_status: "all" })
    } else {
      updateParams({ per_status: [...next].join(",") })
    }
  }

  const selectedSynopsisQ = csvSet(searchParams, "synopsis_q")
  const selectedAiStatuses = csvSet(searchParams, "ai_status")

  const selectedGenreAny = csvSet(searchParams, "genres_any")
  const selectedTagAny = csvSet(searchParams, "tags_any")

  // Active filter chips
  const activeChips: Array<{ key: string; label: string; onRemove: () => void }> = []
  if (currentSearch.trim()) {
    activeChips.push({
      key: "search",
      label: `Busca: "${currentSearch.trim()}"`,
      onRemove: () => updateParams({ search: null }),
    })
  }
  const pushRange = (key: string, label: string, minKey: string, maxKey: string) => {
    const min = searchParams.get(minKey)
    const max = searchParams.get(maxKey)
    if (!min && !max) return
    const suffix = min && max ? `${min} – ${max}` : min ? `≥ ${min}` : `≤ ${max}`
    activeChips.push({
      key,
      label: `${label}: ${suffix}`,
      onRemove: () => updateParams({ [minKey]: null, [maxKey]: null }),
    })
  }
  pushRange("chapters", "Capítulos", "min_chapters", "max_chapters")
  pushRange("expected", "Nota Prevista", "min_expected", "max_expected")
  pushRange("fit", "Alinhamento", "min_fit", "max_fit")
  pushRange("platform", "Nota.M", "min_platform_avg", "max_platform_avg")
  pushRange("votes", "Votos", "min_votes", "max_votes")
  for (const slug of CRITERION_SLUGS) {
    pushRange(`crit-${slug}`, CRITERION_LABELS[slug] ?? slug, `min_${slug}`, `max_${slug}`)
  }
  if (isAllPub) {
    activeChips.push({ key: "pub-all", label: "Publicação: Todos", onRemove: () => updateParams({ pub_status: null }) })
  } else {
    selectedPubStatuses.forEach((s) => activeChips.push({
      key: `pub-${s}`, label: `Publicação: ${s}`, onRemove: () => togglePubStatus(s),
    }))
  }
  if (isAllPer) {
    activeChips.push({ key: "per-all", label: "Status: Todos", onRemove: () => updateParams({ per_status: null }) })
  } else {
    selectedPerStatuses.forEach((s) => activeChips.push({
      key: `per-${s}`, label: `Status: ${s}`, onRemove: () => togglePerStatus(s),
    }))
  }
  selectedSynopsisQ.forEach((q) => activeChips.push({
    key: `syn-${q}`, label: `Sinopse: ${q}`, onRemove: () => toggleCsv("synopsis_q", q),
  }))
  selectedAiStatuses.forEach((s) => activeChips.push({
    key: `ai-${s}`, label: `IA: ${AI_STATUS_LABELS[s] ?? s}`, onRemove: () => toggleCsv("ai_status", s),
  }))
  selectedGenreAny.forEach((g) => activeChips.push({
    key: `genre-${g}`, label: `Gênero: ${g}`, onRemove: () => {
      const next = new Set(selectedGenreAny)
      next.delete(g)
      updateParams({ genres_any: next.size === 0 ? null : [...next].join(",") })
    },
  }))
  const tagNameBySlug = new Map(availableTags.map((t) => [t.slug, t.name]))
  selectedTagAny.forEach((slug) => activeChips.push({
    key: `tag-${slug}`, label: `Tag: ${tagNameBySlug.get(slug) ?? slug}`, onRemove: () => {
      const next = new Set(selectedTagAny)
      next.delete(slug)
      updateParams({ tags_any: next.size === 0 ? null : [...next].join(",") })
    },
  }))

  const activeFilterLabel =
    activeChips.length === 1 ? "1 seleção" : `${activeChips.length} seleções`

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
              {activeChips.length > 0 && (
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

        <div className="flex items-center justify-end gap-2">
          {!collapsed && (
            <Button size="sm" onClick={applyAllFilters} disabled={!filtersDirty}>
              Aplicar filtros
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
        <>
      {/* Busca + Ordenação */}
      <div className="mb-3 grid gap-3 md:grid-cols-[2fr_1fr]">
        <div className="space-y-1.5">
          <Label htmlFor="title-filter-search" className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Busca por título
          </Label>
          <SearchInputWithHistory
            value={currentSearch}
            onChange={(v) => {
              updateParams({ search: v || null })
              if (!v) {
                startTransition(() => {
                  const next = new URLSearchParams(draftSearch)
                  next.delete("search")
                  const qs = next.toString()
                  router.replace(qs ? `/titles?${qs}` : "/titles")
                })
              }
            }}
            onSubmit={(term) => {
              updateParams({ search: term || null })
              const next = new URLSearchParams(draftSearch)
              if (term) next.set("search", term)
              else next.delete("search")
              const qs = next.toString()
              startTransition(() => router.replace(qs ? `/titles?${qs}` : "/titles"))
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Ordenação
          </Label>
          <div className="flex items-center gap-2">
            <Select value={sortField} onValueChange={(v) => setSort(v, sortDir)}>
              <SelectTrigger className="h-9 flex-1 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTABLE_FIELDS.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-sm">
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => setSort(sortField, sortDir === "desc" ? "asc" : "desc")}
              className="flex items-center gap-1 h-9 px-2.5 rounded-md border text-xs hover:bg-muted transition-colors shrink-0"
              title={sortDir === "desc" ? "Decrescente" : "Crescente"}
            >
              {sortDir === "desc"
                ? <><ArrowDown className="h-3 w-3" /><span>Dec</span></>
                : <><ArrowUp className="h-3 w-3" /><span>Cre</span></>}
            </button>
          </div>
        </div>
      </div>

      {/* Filtros avançados (aba única) */}
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          onClick={() => setTabsExpanded((prev) => !prev)}
          aria-expanded={tabsExpanded}
        >
          {tabsExpanded ? "Ocultar filtros" : "Filtros avançados"}
          <ChevronDown
            className={cn("ml-1 h-3.5 w-3.5 transition-transform", tabsExpanded && "rotate-180")}
          />
        </Button>
      </div>

      {tabsExpanded && (
        <div className="mt-3 space-y-3">
          {/* Linha 1: Publicação + Status Pessoal + Status IA (cards estreitos) */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <FilterCard
              title={`Publicação${isAllPub ? " (todos)" : selectedPubStatuses.size ? ` (${selectedPubStatuses.size})` : ""}`}
              action={
                <button
                  type="button"
                  onClick={() => updateParams({ pub_status: isAllPub ? null : "all" })}
                >
                  <Badge
                    variant={isAllPub ? "default" : "outline"}
                    className="cursor-pointer rounded-full px-2.5 py-1 text-xs transition-transform hover:-translate-y-px"
                  >
                    Todos
                  </Badge>
                </button>
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {visiblePublicationStatuses.map((s) => (
                  <StatusButton
                    key={`pub-${s.status}`}
                    option={s}
                    active={selectedPubStatuses.has(s.status)}
                    onClick={() => togglePubStatus(s.status)}
                  />
                ))}
              </div>
            </FilterCard>

            <FilterCard
              title={`Status Pessoal${isAllPer ? " (todos)" : selectedPerStatuses.size ? ` (${selectedPerStatuses.size})` : ""}`}
              action={
                <button
                  type="button"
                  onClick={() => updateParams({ per_status: isAllPer ? null : "all" })}
                >
                  <Badge
                    variant={isAllPer ? "default" : "outline"}
                    className="cursor-pointer rounded-full px-2.5 py-1 text-xs transition-transform hover:-translate-y-px"
                  >
                    Todos
                  </Badge>
                </button>
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {visiblePersonalStatuses.map((s) => (
                  <StatusButton
                    key={`per-${s.status}`}
                    option={s}
                    active={selectedPerStatuses.has(s.status)}
                    tooltip={getPersonalStatusDescription(s.status, s.comment)}
                    onClick={() => togglePerStatus(s.status)}
                  />
                ))}
              </div>
            </FilterCard>

            <FilterCard title={`Status IA${selectedAiStatuses.size ? ` (${selectedAiStatuses.size})` : ""}`}>
              <div className="flex flex-wrap gap-1.5">
                {AI_EVAL_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => toggleCsv("ai_status", status)}
                  >
                    <Badge
                      variant={selectedAiStatuses.has(status) ? "default" : "outline"}
                      className="cursor-pointer rounded-full px-2.5 py-1 text-xs"
                    >
                      {AI_STATUS_LABELS[status] ?? status}
                    </Badge>
                  </button>
                ))}
              </div>
            </FilterCard>
          </div>

          {/* Linha 2: Interesse + Capítulos + Notas + Votos (tudo na mesma linha) */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-[1.4fr_0.7fr_1fr_1fr_1fr_1fr]">
            <FilterCard title={`Interesse${selectedSynopsisQ.size ? ` (${selectedSynopsisQ.size})` : ""}`}>
              <div className="grid grid-cols-4 gap-1.5">
                {SYNOPSIS_QUALITIES.map((q) => (
                  <button key={q} type="button" onClick={() => toggleCsv("synopsis_q", q)} className="w-full">
                    <Badge
                      variant={selectedSynopsisQ.has(q) ? "default" : "outline"}
                      className="flex w-full cursor-pointer items-center justify-center rounded-full px-2 py-1.5 text-sm"
                    >
                      {q}
                    </Badge>
                  </button>
                ))}
              </div>
            </FilterCard>

            <FilterCard title="Capítulos">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                <Input
                  type="number"
                  min={0}
                  placeholder="Mín"
                  className="h-9 min-w-0 px-2"
                  value={searchParams.get("min_chapters") ?? ""}
                  onChange={(e) => updateParams({ min_chapters: e.target.value || null })}
                />
                <span className="text-xs text-muted-foreground">-</span>
                <Input
                  type="number"
                  min={0}
                  placeholder="Máx"
                  className="h-9 min-w-0 px-2"
                  value={searchParams.get("max_chapters") ?? ""}
                  onChange={(e) => updateParams({ max_chapters: e.target.value || null })}
                />
              </div>
            </FilterCard>

            <ScoreRangeCard
              emoji="🎯"
              label="Nota Prevista"
              tooltip="Nota que o modelo prevê que você daria à obra (0–10)."
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
            <VotesRangeCard
              searchParams={searchParams}
              updateParams={updateParams}
            />
          </div>

          {/* Linha 3: Gênero + Tags (estreitos) */}
          <div className="grid gap-3 xl:grid-cols-2">
            <FilterCard title={`Gênero${selectedGenreAny.size ? ` (${selectedGenreAny.size})` : ""}`}>
              {availableGenres.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum gênero disponível</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {availableGenres.map((genre) => (
                    <button
                      key={genre}
                      type="button"
                      onClick={() => toggleCsv("genres_any", genre)}
                    >
                      <Badge
                        variant={selectedGenreAny.has(genre) ? "default" : "outline"}
                        className="cursor-pointer rounded-full px-2.5 py-1 text-xs transition-transform hover:-translate-y-px"
                      >
                        {genre}
                      </Badge>
                    </button>
                  ))}
                </div>
              )}
            </FilterCard>

            <FilterCard title={`Tags${selectedTagAny.size ? ` (${selectedTagAny.size})` : ""}`}>
              <TagFilter
                selected={[...selectedTagAny]}
                onChange={(slugs) =>
                  updateParams({ tags_any: slugs.length ? slugs.join(",") : null })
                }
                availableTags={availableTags}
              />
            </FilterCard>
          </div>
        </div>
      )}

      {/* Active chips */}
      {activeChips.length > 0 && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Filtros ativos
            </span>
            {activeChips.map((chip) => (
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
          </div>
        </div>
      )}
        </>
      )}
    </div>
  )
}

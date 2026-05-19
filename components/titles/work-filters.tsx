"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo, useState, useTransition } from "react"
import {
  ChevronDown,
  Filter,
  Heart,
  RotateCcw,
  Search,
  X,
} from "lucide-react"
import { TagFilter } from "@/components/titles/tag-filter"
import type { TagSuggestion } from "@/lib/external/types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import {
  PUBLICATION_STATUS_LABELS,
  PERSONAL_STATUS_LABELS,
} from "@/lib/constants/criteria"
import { PUBLICATION_STATUSES, PERSONAL_STATUSES, AI_EVAL_STATUSES } from "@/types/domain"

const AI_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente IA",
  done: "Avaliado",
  skipped: "Pulado",
}

const SORT_OPTIONS = [
  { value: "final_score:desc", label: "Nota.Final ↓" },
  { value: "final_score:asc", label: "Nota.Final ↑" },
  { value: "calc_score:desc", label: "Nota.IA ↓" },
  { value: "predicted_score:desc", label: "Nota.Pr ↓" },
  { value: "is_favorite:desc", label: "Favoritos ↓" },
  { value: "title:asc", label: "Título A-Z" },
  { value: "title:desc", label: "Título Z-A" },
  { value: "total_chapters:desc", label: "Capítulos ↓" },
  { value: "updated_at:desc", label: "Atualizado recentemente" },
  { value: "created_at:desc", label: "Adicionado recentemente" },
]

const DEFAULT_SORT = "final_score:desc"
const SCORE_MIN = 0
const SCORE_MAX = 10
const SCORE_STEP = 0.5
const CHAPTERS_MIN = 0
const CHAPTERS_MAX = 2000
const CHAPTERS_STEP = 10

interface FilterDraft {
  search: string
  pubStatuses: string[]
  personalStatuses: string[]
  aiStatuses: string[]
  showArchived: boolean
  showFavoritesOnly: boolean
  minScore: string
  maxScore: string
  minChapters: string
  maxChapters: string
  genre: string
  tagSlugs: string[]
  sortValue: string
}

interface WorkFiltersProps {
  availableGenres: string[]
}

function buildQuery(draft: FilterDraft): string {
  const params = new URLSearchParams()
  if (draft.search) params.set("search", draft.search)
  draft.pubStatuses.forEach((s) => params.append("pub", s))
  draft.personalStatuses.forEach((s) => params.append("personal", s))
  draft.aiStatuses.forEach((s) => params.append("ai", s))
  if (draft.showArchived) params.set("archived", "1")
  if (draft.showFavoritesOnly) params.set("fav", "1")
  if (draft.minScore) params.set("min_score", draft.minScore)
  if (draft.maxScore) params.set("max_score", draft.maxScore)
  if (draft.minChapters) params.set("min_chapters", draft.minChapters)
  if (draft.maxChapters) params.set("max_chapters", draft.maxChapters)
  if (draft.genre) params.set("genre", draft.genre)
  draft.tagSlugs.forEach((slug) => params.append("tag", slug))
  if (draft.sortValue !== DEFAULT_SORT) params.set("sort", draft.sortValue)
  return params.toString()
}

export function WorkFilters({ availableGenres }: WorkFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const getDraftFromParams = useCallback((): FilterDraft => ({
    search: searchParams.get("search") ?? "",
    pubStatuses: searchParams.getAll("pub"),
    personalStatuses: searchParams.getAll("personal"),
    aiStatuses: searchParams.getAll("ai"),
    showArchived: searchParams.get("archived") === "1",
    showFavoritesOnly: searchParams.get("fav") === "1",
    minScore: searchParams.get("min_score") ?? "",
    maxScore: searchParams.get("max_score") ?? "",
    minChapters: searchParams.get("min_chapters") ?? "",
    maxChapters: searchParams.get("max_chapters") ?? "",
    genre: searchParams.get("genre") ?? "",
    tagSlugs: searchParams.getAll("tag"),
    sortValue: searchParams.get("sort") ?? DEFAULT_SORT,
  }), [searchParams])

  const [draft, setDraft] = useState<FilterDraft>(getDraftFromParams)

  const {
    search,
    pubStatuses,
    personalStatuses,
    aiStatuses,
    showArchived,
    showFavoritesOnly,
    minScore,
    maxScore,
    minChapters,
    maxChapters,
    genre,
    tagSlugs,
    sortValue,
  } = draft

  const tagSlugKey = tagSlugs.join(",")

  const selectedTags = useMemo<TagSuggestion[]>(() =>
    tagSlugs.map(slug => ({
      id: slug,
      slug,
      name: slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    })),
  [tagSlugKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateDraft = (updates: Partial<FilterDraft>) => {
    setDraft((current) => ({ ...current, ...updates }))
  }

  const applyFilters = () => {
    const query = buildQuery(draft)
    startTransition(() => router.replace(query ? `/titles?${query}` : "/titles"))
  }

  const clearAll = () => {
    setDraft({
      search: "",
      pubStatuses: [],
      personalStatuses: [],
      aiStatuses: [],
      showArchived: false,
      showFavoritesOnly: false,
      minScore: "",
      maxScore: "",
      minChapters: "",
      maxChapters: "",
      genre: "",
      tagSlugs: [],
      sortValue: DEFAULT_SORT,
    })
    startTransition(() => router.replace("/titles"))
  }

  const toggleArray = (
    key: "pubStatuses" | "personalStatuses" | "aiStatuses",
    current: string[],
    value: string
  ) => {
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value]
    updateDraft({ [key]: next })
  }

  const addTag = (tag: TagSuggestion) => {
    if (tagSlugs.includes(tag.slug)) return
    updateDraft({ tagSlugs: [...tagSlugs, tag.slug] })
  }

  const removeTag = (slug: string) => {
    updateDraft({ tagSlugs: tagSlugs.filter(s => s !== slug) })
  }

  const draftQuery = buildQuery(draft)
  const appliedQuery = searchParams.toString()
  const filtersDirty = draftQuery !== appliedQuery
  const hasFilters = draftQuery !== "" || appliedQuery !== ""

  // Active chips: built from APPLIED state (URL), not draft
  const appliedDraft = useMemo(() => getDraftFromParams(), [getDraftFromParams])
  const activeChips = buildActiveChips(appliedDraft, availableGenres, (next) => {
    setDraft(next)
    const q = buildQuery(next)
    startTransition(() => router.replace(q ? `/titles?${q}` : "/titles"))
  })

  return (
    <div className="rounded-xl border border-border/70 bg-card/58 p-3 shadow-sm shadow-black/5 backdrop-blur">
      {/* Compact header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Filter className="h-3.5 w-3.5" />
          </div>
          <h2 className="text-sm font-semibold">Filtros</h2>
          {activeChips.length > 0 && (
            <span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {activeChips.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <Checkbox
              checked={showFavoritesOnly}
              onCheckedChange={(checked) => updateDraft({ showFavoritesOnly: checked === true })}
            />
            <span className="inline-flex items-center gap-1">
              <Heart className="h-3 w-3" />
              Favoritos
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <Checkbox
              checked={showArchived}
              onCheckedChange={(checked) => updateDraft({ showArchived: checked === true })}
            />
            <span>Arquivadas</span>
          </label>
          <span aria-hidden className="mx-1 h-4 w-px bg-border/70" />
          {hasFilters && (
            <Button variant="ghost" size="xs" onClick={clearAll} disabled={isPending}>
              <X className="h-3 w-3" />
              Limpar
            </Button>
          )}
          <Button size="xs" onClick={applyFilters} disabled={!filtersDirty || isPending}>
            Aplicar
          </Button>
        </div>
      </div>

      {/* Active filter chips */}
      {activeChips.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1">
          {activeChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={chip.onRemove}
              className="group inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
            >
              <span>{chip.label}</span>
              <X className="h-2.5 w-2.5 opacity-60 transition-opacity group-hover:opacity-100" />
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        {/* BUSCA E ORDENAÇÃO */}
        <FilterSection title="Busca e ordenação">
          <div className="flex flex-col gap-2 lg:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Buscar por título..."
                className="h-8 pl-8 pr-9 text-sm"
                value={search}
                onChange={(e) => updateDraft({ search: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applyFilters()
                }}
              />
              {search && (
                <button
                  type="button"
                  aria-label="Limpar busca por título"
                  onClick={() => updateDraft({ search: "" })}
                  className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <Select
              value={sortValue}
              onValueChange={(v) => updateDraft({ sortValue: v })}
            >
              <SelectTrigger size="sm" className="w-full shrink-0 lg:w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </FilterSection>

        {/* STATUS */}
        <FilterSection title="Status">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Publicação
              </Label>
              <div className="flex flex-wrap gap-1">
                {PUBLICATION_STATUSES.filter((s) => s !== "Unknown").map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleArray("pubStatuses", pubStatuses, s)}
                  >
                    <Badge
                      variant={pubStatuses.includes(s) ? "default" : "outline"}
                      className="cursor-pointer text-xs"
                    >
                      {PUBLICATION_STATUS_LABELS[s]}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pessoal
              </Label>
              <div className="flex flex-wrap gap-1">
                {PERSONAL_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleArray("personalStatuses", personalStatuses, s)}
                  >
                    <Badge
                      variant={personalStatuses.includes(s) ? "default" : "outline"}
                      className="cursor-pointer text-xs"
                    >
                      {PERSONAL_STATUS_LABELS[s]}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Status IA
              </Label>
              <div className="flex flex-wrap gap-1">
                {AI_EVAL_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleArray("aiStatuses", aiStatuses, s)}
                  >
                    <Badge
                      variant={aiStatuses.includes(s) ? "default" : "outline"}
                      className="cursor-pointer text-xs"
                    >
                      {AI_STATUS_LABELS[s]}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </FilterSection>

        {/* NOTAS E CAPÍTULOS */}
        <FilterSection title="Notas e capítulos">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <DraftRangeSlider
              label="Nota.Final"
              min={SCORE_MIN}
              max={SCORE_MAX}
              step={SCORE_STEP}
              minValue={minScore}
              maxValue={maxScore}
              decimals={1}
              onChange={(lo, hi) => updateDraft({ minScore: lo, maxScore: hi })}
            />
            <DraftRangeSlider
              label="Capítulos"
              min={CHAPTERS_MIN}
              max={CHAPTERS_MAX}
              step={CHAPTERS_STEP}
              minValue={minChapters}
              maxValue={maxChapters}
              decimals={0}
              onChange={(lo, hi) => updateDraft({ minChapters: lo, maxChapters: hi })}
            />
          </div>
        </FilterSection>

        {/* CATALOGAÇÃO */}
        <FilterSection title="Catalogação">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Gênero
              </Label>
              <div className="flex gap-1.5">
                <Select
                  value={availableGenres.includes(genre) ? genre : ""}
                  onValueChange={(value) => updateDraft({ genre: value })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Selecionar gênero" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableGenres.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {genre && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => updateDraft({ genre: "" })}
                    aria-label="Limpar gênero"
                    title="Limpar gênero"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Tags
              </Label>
              <TagFilter
                selected={selectedTags}
                onAdd={addTag}
                onRemove={removeTag}
              />
            </div>
          </div>
        </FilterSection>
      </div>
    </div>
  )
}

interface FilterSectionProps {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function FilterSection({ title, defaultOpen = true, children }: FilterSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="overflow-hidden rounded-lg border border-border/65 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 bg-card/60 px-3 py-1.5 text-left transition-colors hover:bg-card/80"
      >
        <span className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            open ? "" : "-rotate-90"
          )}
        />
      </button>
      {open && (
        <div className="border-t border-border/60 px-3 py-2.5">
          {children}
        </div>
      )}
    </div>
  )
}

interface DraftRangeSliderProps {
  label: string
  min: number
  max: number
  step: number
  minValue: string
  maxValue: string
  decimals: number
  onChange: (minString: string, maxString: string) => void
}

function DraftRangeSlider({
  label,
  min,
  max,
  step,
  minValue,
  maxValue,
  decimals,
  onChange,
}: DraftRangeSliderProps) {
  const parsedMin = minValue === "" ? min : Number(minValue)
  const parsedMax = maxValue === "" ? max : Number(maxValue)
  const sliderMax = Math.max(max, Number.isFinite(parsedMax) ? parsedMax : max)
  const isActive = minValue !== "" || maxValue !== ""

  const [dragValue, setDragValue] = useState<[number, number] | null>(null)
  const committed: [number, number] = [
    Number.isFinite(parsedMin) ? parsedMin : min,
    Number.isFinite(parsedMax) ? parsedMax : sliderMax,
  ]
  const display = dragValue ?? committed
  const fmt = (v: number) => v.toFixed(decimals)
  const rangeLabel = dragValue || isActive ? `${fmt(display[0])} – ${fmt(display[1])}` : "Qualquer"

  const commit = (next: number[]) => {
    const [lo, hi] = next as [number, number]
    onChange(
      lo > min ? String(lo) : "",
      hi < sliderMax ? String(hi) : ""
    )
    setDragValue(null)
  }

  const reset = () => {
    setDragValue(null)
    onChange("", "")
  }

  return (
    <div
      className={cn(
        "group rounded-md border bg-background/45 px-2.5 py-1.5 transition-colors",
        isActive ? "border-primary/55 bg-primary/[0.04]" : "border-border/65 hover:border-border"
      )}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium">{label}</span>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={cn(
              "rounded-full px-1.5 py-0 text-[10px] font-semibold tabular-nums",
              isActive ? "bg-primary/15 text-primary" : "bg-muted/60 text-muted-foreground"
            )}
          >
            {rangeLabel}
          </span>
          <button
            type="button"
            onClick={reset}
            disabled={!isActive}
            aria-label="Limpar"
            className="flex h-5 w-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:cursor-default disabled:opacity-0"
          >
            <RotateCcw className="h-3 w-3" />
          </button>
        </div>
      </div>
      <Slider
        value={display}
        min={min}
        max={sliderMax}
        step={step}
        minStepsBetweenThumbs={1}
        onValueChange={(v) => setDragValue([v[0], v[1]] as [number, number])}
        onValueCommit={commit}
        className="px-1"
      />
    </div>
  )
}

interface ActiveChip {
  key: string
  label: string
  onRemove: () => void
}

function buildActiveChips(
  applied: FilterDraft,
  availableGenres: string[],
  applyAndNavigate: (next: FilterDraft) => void
): ActiveChip[] {
  const chips: ActiveChip[] = []
  const remove = (mutation: Partial<FilterDraft>) =>
    applyAndNavigate({ ...applied, ...mutation })

  if (applied.search) {
    chips.push({
      key: "search",
      label: `Busca: ${applied.search}`,
      onRemove: () => remove({ search: "" }),
    })
  }
  applied.pubStatuses.forEach((s) => {
    chips.push({
      key: `pub:${s}`,
      label: `Pub: ${PUBLICATION_STATUS_LABELS[s] ?? s}`,
      onRemove: () => remove({ pubStatuses: applied.pubStatuses.filter((x) => x !== s) }),
    })
  })
  applied.personalStatuses.forEach((s) => {
    chips.push({
      key: `personal:${s}`,
      label: `Pessoal: ${PERSONAL_STATUS_LABELS[s] ?? s}`,
      onRemove: () => remove({ personalStatuses: applied.personalStatuses.filter((x) => x !== s) }),
    })
  })
  applied.aiStatuses.forEach((s) => {
    chips.push({
      key: `ai:${s}`,
      label: `IA: ${AI_STATUS_LABELS[s] ?? s}`,
      onRemove: () => remove({ aiStatuses: applied.aiStatuses.filter((x) => x !== s) }),
    })
  })
  if (applied.minScore || applied.maxScore) {
    const lo = applied.minScore || "0"
    const hi = applied.maxScore || "10"
    chips.push({
      key: "score",
      label: `Nota: ${lo}–${hi}`,
      onRemove: () => remove({ minScore: "", maxScore: "" }),
    })
  }
  if (applied.minChapters || applied.maxChapters) {
    const lo = applied.minChapters || "0"
    const hi = applied.maxChapters || "∞"
    chips.push({
      key: "chapters",
      label: `Cap: ${lo}–${hi}`,
      onRemove: () => remove({ minChapters: "", maxChapters: "" }),
    })
  }
  if (applied.genre && availableGenres.includes(applied.genre)) {
    chips.push({
      key: "genre",
      label: `Gênero: ${applied.genre}`,
      onRemove: () => remove({ genre: "" }),
    })
  }
  applied.tagSlugs.forEach((slug) => {
    chips.push({
      key: `tag:${slug}`,
      label: `Tag: ${slug.replace(/-/g, " ")}`,
      onRemove: () => remove({ tagSlugs: applied.tagSlugs.filter((x) => x !== slug) }),
    })
  })
  if (applied.showArchived) {
    chips.push({
      key: "archived",
      label: "Arquivadas visíveis",
      onRemove: () => remove({ showArchived: false }),
    })
  }
  if (applied.showFavoritesOnly) {
    chips.push({
      key: "favorites",
      label: "Somente favoritos",
      onRemove: () => remove({ showFavoritesOnly: false }),
    })
  }
  if (applied.sortValue !== DEFAULT_SORT) {
    const sortOpt = SORT_OPTIONS.find((o) => o.value === applied.sortValue)
    if (sortOpt) {
      chips.push({
        key: "sort",
        label: `Ordem: ${sortOpt.label}`,
        onRemove: () => remove({ sortValue: DEFAULT_SORT }),
      })
    }
  }
  return chips
}

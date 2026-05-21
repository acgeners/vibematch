"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo, useState, useTransition } from "react"
import { ChevronDown, Filter, RotateCcw, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { cn } from "@/lib/utils"
import {
  PUBLICATION_STATUS_LABELS,
  PERSONAL_STATUS_LABELS,
} from "@/lib/constants/criteria"
import { PUBLICATION_STATUSES, PERSONAL_STATUSES, AI_EVAL_STATUSES } from "@/types/domain"

const AI_STATUS_LABELS: Record<string, string> = {
  pending: "Sem avaliação IA",
  review_pending: "Aguardando revisão",
  done: "Avaliado",
  skipped: "Pulado",
}

const CHAPTERS_MIN = 0
const CHAPTERS_MAX = 2000
const CHAPTERS_STEP = 10

interface FilterDraft {
  pubStatuses: string[]
  personalStatuses: string[]
  aiStatuses: string[]
  showArchived: boolean
  minChapters: string
  maxChapters: string
}

// availableGenres kept in props for backwards compat with the page; ignored here.
interface WorkFiltersProps {
  availableGenres?: string[]
}

function buildQuery(draft: FilterDraft, preserved: URLSearchParams): string {
  const params = new URLSearchParams()
  // Preserve params we don't manage (search, sort, compare, page, etc.)
  for (const [key, value] of preserved.entries()) {
    if (
      [
        "pub",
        "personal",
        "ai",
        "archived",
        "min_chapters",
        "max_chapters",
        "page",
      ].includes(key)
    ) {
      continue
    }
    params.append(key, value)
  }
  draft.pubStatuses.forEach((s) => params.append("pub", s))
  draft.personalStatuses.forEach((s) => params.append("personal", s))
  draft.aiStatuses.forEach((s) => params.append("ai", s))
  if (draft.showArchived) params.set("archived", "1")
  if (draft.minChapters) params.set("min_chapters", draft.minChapters)
  if (draft.maxChapters) params.set("max_chapters", draft.maxChapters)
  return params.toString()
}

export function WorkFilters({}: WorkFiltersProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const getDraftFromParams = useCallback((): FilterDraft => ({
    pubStatuses: searchParams.getAll("pub"),
    personalStatuses: searchParams.getAll("personal"),
    aiStatuses: searchParams.getAll("ai"),
    showArchived: searchParams.get("archived") === "1",
    minChapters: searchParams.get("min_chapters") ?? "",
    maxChapters: searchParams.get("max_chapters") ?? "",
  }), [searchParams])

  const [draft, setDraft] = useState<FilterDraft>(getDraftFromParams)

  const {
    pubStatuses,
    personalStatuses,
    aiStatuses,
    showArchived,
    minChapters,
    maxChapters,
  } = draft

  const updateDraft = (updates: Partial<FilterDraft>) => {
    setDraft((current) => ({ ...current, ...updates }))
  }

  const applyFilters = () => {
    const query = buildQuery(draft, new URLSearchParams(searchParams.toString()))
    startTransition(() => router.replace(query ? `/titles?${query}` : "/titles"))
  }

  const clearAll = () => {
    setDraft({
      pubStatuses: [],
      personalStatuses: [],
      aiStatuses: [],
      showArchived: false,
      minChapters: "",
      maxChapters: "",
    })
    const preserved = new URLSearchParams()
    for (const [key, value] of searchParams.entries()) {
      if (
        [
          "pub",
          "personal",
          "ai",
          "archived",
          "min_chapters",
          "max_chapters",
          "page",
        ].includes(key)
      ) {
        continue
      }
      preserved.append(key, value)
    }
    const qs = preserved.toString()
    startTransition(() => router.replace(qs ? `/titles?${qs}` : "/titles"))
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

  const draftQuery = buildQuery(draft, new URLSearchParams(searchParams.toString()))
  const appliedQuery = searchParams.toString()
  const filtersDirty = draftQuery !== appliedQuery
  const hasFilters = draftQuery !== "" || appliedQuery !== ""

  const appliedDraft = useMemo(() => getDraftFromParams(), [getDraftFromParams])
  const activeChips = buildActiveChips(appliedDraft, (next) => {
    setDraft(next)
    const q = buildQuery(next, new URLSearchParams(searchParams.toString()))
    startTransition(() => router.replace(q ? `/titles?${q}` : "/titles"))
  })

  return (
    <div className="rounded-xl border border-border/70 bg-card/58 p-3 shadow-sm shadow-black/5 backdrop-blur">
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

        <FilterSection title="Capítulos">
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
  applyAndNavigate: (next: FilterDraft) => void
): ActiveChip[] {
  const chips: ActiveChip[] = []
  const remove = (mutation: Partial<FilterDraft>) =>
    applyAndNavigate({ ...applied, ...mutation })

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
  if (applied.minChapters || applied.maxChapters) {
    const lo = applied.minChapters || "0"
    const hi = applied.maxChapters || "∞"
    chips.push({
      key: "chapters",
      label: `Cap: ${lo}–${hi}`,
      onRemove: () => remove({ minChapters: "", maxChapters: "" }),
    })
  }
  if (applied.showArchived) {
    chips.push({
      key: "archived",
      label: "Arquivadas visíveis",
      onRemove: () => remove({ showArchived: false }),
    })
  }
  return chips
}

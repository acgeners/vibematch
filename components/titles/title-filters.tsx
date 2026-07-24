"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Filter, RotateCcw, Search, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { searchWorkSuggestions } from "@/server/actions/work-search"
import type { WorkSuggestion } from "@/server/queries/work-suggestions"
import type { SignatureCount } from "@/server/queries/work-signature"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { AI_EVAL_STATUSES, CRITERION_SLUGS, SYNOPSIS_QUALITIES } from "@/types/domain"
import { getPersonalStatusDescription } from "@/lib/constants/personal-status-descriptions"
import { LABELS } from "@/lib/constants/ui-labels"
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
  { value: "expected_score", label: LABELS.expected_score.short },
  { value: "platform_avg", label: LABELS.platform_avg.short },
  { value: "total_votes", label: LABELS.total_votes.short },
  { value: "title", label: LABELS.title.short },
  { value: "chapters", label: LABELS.chapters_total.short },
]

/**
 * Ordenar pelos 9 atributos. O backend de /titles já aceitava `crit_<slug>`
 * (a whitelist em app/titles/page.tsx), só a UI não oferecia.
 */
const CRITERION_SORT_FIELDS: Array<{ value: string; label: string }> = CRITERION_SLUGS.map(
  (slug) => ({
    value: `crit_${slug}`,
    label: `${CRITERIA_INFO[slug]?.emoji ?? ""} ${CRITERION_LABELS[slug] ?? slug}`.trim(),
  }),
)

const ALL_SORTABLE_FIELDS = [...SORTABLE_FIELDS, ...CRITERION_SORT_FIELDS]

const AI_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente atributos",
  review_pending: "Pendente Veredito IA",
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
  /** Contagem por assinatura (atributo dominante) — alimenta a aba Atributos. */
  signatureCounts?: SignatureCount[]
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
        {option.symbol && <span className="text-[11px]">{option.symbol}</span>}
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

/** Chip liga/desliga de um recorte booleano ("Só avaliadas", "Só favoritas"…). */
function ToggleChip({
  label,
  active,
  onClick,
  tooltip,
  tone = "primary",
}: {
  label: React.ReactNode
  active: boolean
  onClick: () => void
  tooltip?: string
  tone?: "primary" | "positive"
}) {
  const chip = (
    <button type="button" onClick={onClick} aria-pressed={active}>
      <Badge
        variant={active ? "default" : "outline"}
        className={cn(
          "cursor-pointer rounded-full px-2.5 py-1 text-xs transition-transform hover:-translate-y-px",
          active && tone === "positive" && "border-transparent bg-emerald-600 text-white hover:bg-emerald-600",
        )}
      >
        {label}
      </Badge>
    </button>
  )
  if (!tooltip) return chip
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{chip}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-[240px] text-pretty">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * Segmentado "Conteúdo 18+" — filtra pela classificação da obra (works.is_adult),
 * NÃO por tags. "Tudo" respeita a preferência global de /preferencias; as outras
 * duas mandam nesta listagem.
 */
function AdultContentSegment({
  value,
  onChange,
}: {
  value: "all" | "hide" | "only"
  onChange: (v: "all" | "hide" | "only") => void
}) {
  const seg = (active: boolean, danger: boolean) =>
    cn(
      "inline-flex h-7 items-center gap-1 rounded px-2.5 text-xs font-medium transition-colors",
      active
        ? danger
          ? "bg-red-500/15 text-red-600 dark:text-red-300"
          : "bg-primary/15 text-primary"
        : "text-muted-foreground hover:text-foreground",
    )
  return (
    <div className="inline-flex rounded-md border border-border/70 bg-background/60 p-0.5">
      <button
        type="button"
        onClick={() => onChange("all")}
        aria-pressed={value === "all"}
        className={seg(value === "all", false)}
        title="Mostra todas as obras (respeita sua preferência global de 18+ em /preferencias)."
      >
        Tudo
      </button>
      <button
        type="button"
        onClick={() => onChange("hide")}
        aria-pressed={value === "hide"}
        className={seg(value === "hide", true)}
        title="Esconde as obras classificadas como 18+ nesta listagem."
      >
        Ocultar <span aria-hidden>🔞</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("only")}
        aria-pressed={value === "only"}
        className={seg(value === "only", true)}
        title="Mostra apenas as obras classificadas como 18+."
      >
        Só 18+ <span aria-hidden>🔞</span>
      </button>
    </div>
  )
}

/**
 * ASSINATURA — chips do atributo que mais marca a obra.
 *
 * A lente que diferencia /titles do /ranking: lá se pergunta "vale a pena?"
 * (limiar de nota), aqui "que tipo de obra é essa?" (forma). A contagem é de
 * CATÁLOGO — não conhece os outros filtros ativos —, por isso o rótulo diz "no
 * catálogo" em vez de prometer o tamanho do resultado.
 */
function SignatureGrid({
  counts,
  selected,
  onToggle,
}: {
  counts: SignatureCount[]
  selected: Set<string>
  onToggle: (slug: string) => void
}) {
  const max = Math.max(1, ...counts.map((c) => c.count))
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
      {counts.map(({ slug, count }) => {
        const active = selected.has(slug)
        return (
          <button
            key={slug}
            type="button"
            onClick={() => onToggle(slug)}
            aria-pressed={active}
            disabled={count === 0}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
              active
                ? "border-transparent bg-primary/15"
                : "border-border hover:border-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border",
            )}
          >
            <span aria-hidden className="shrink-0 text-base leading-none">
              {CRITERIA_INFO[slug]?.emoji ?? "•"}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-xs font-medium">
                {CRITERION_LABELS[slug] ?? CRITERIA_INFO[slug]?.name ?? slug}
              </span>
              <span
                className={cn(
                  "text-[11px] tabular-nums",
                  active ? "font-semibold text-primary" : "text-muted-foreground",
                )}
              >
                {count} {count === 1 ? "obra" : "obras"}
              </span>
              <span
                aria-hidden
                className={cn("mt-0.5 block h-[3px] rounded-full bg-primary", active ? "" : "opacity-40")}
                style={{ width: `${Math.round((count / max) * 100)}%` }}
              />
            </span>
          </button>
        )
      })}
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

/** Mínimo de caracteres pra buscar sugestões — espelha o guard da server action. */
const MIN_SUGGEST_LENGTH = 2
/** Espera depois da última tecla antes de ir ao servidor. */
const SUGGEST_DEBOUNCE_MS = 250
/**
 * Espera antes de re-filtrar a TABELA. Maior que a do dropdown de propósito: o
 * dropdown é uma chamada barata, a tabela é uma navegação que re-renderiza a
 * página inteira no servidor.
 */
const LIVE_SEARCH_DEBOUNCE_MS = 450

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
  // `settledQuery` é a busca que as sugestões atuais REPRESENTAM. Sem ele, o
  // "Nenhuma obra com esse nome" pisca entre a 2ª tecla e a resposta chegar —
  // afirmando que não existe algo que ainda nem foi procurado.
  const [suggestions, setSuggestions] = useState<WorkSuggestion[]>([])
  const [settledQuery, setSettledQuery] = useState<string | null>(null)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // Contador de requisição em vez de uma flag `mounted`: sob StrictMode o cleanup
  // zera a flag e ela nunca mais volta a true, e o loading trava pra sempre.
  // Aqui cada busca ganha um id e a resposta velha simplesmente é descartada —
  // o que também resolve a resposta que chega fora de ordem.
  const requestIdRef = useRef(0)

  const trimmed = value.trim()

  useEffect(() => {
    // Abaixo do mínimo só invalida o que está em voo. Nada de setState aqui: o
    // que segura a renderização das sugestões velhas é o `showSuggestions`.
    if (trimmed.length < MIN_SUGGEST_LENGTH) {
      requestIdRef.current += 1
      return
    }

    const requestId = ++requestIdRef.current
    const timer = setTimeout(() => {
      setLoadingSuggestions(true)
      searchWorkSuggestions(trimmed)
        .then((rows) => {
          if (requestIdRef.current !== requestId) return
          setSuggestions(rows)
          setSettledQuery(trimmed)
          setLoadingSuggestions(false)
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return
          setSuggestions([])
          setSettledQuery(trimmed)
          setLoadingSuggestions(false)
        })
    }, SUGGEST_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [trimmed])

  const submit = (term: string) => {
    setHistory(pushToSearchHistory(term))
    setOpen(false)
    onSubmit(term)
  }

  const filteredHistory = useMemo(() => {
    const q = trimmed.toLowerCase()
    if (!q) return history
    return history.filter((t) => t.toLowerCase().includes(q))
  }, [history, trimmed])

  const showSuggestions = trimmed.length >= MIN_SUGGEST_LENGTH
  const isSearching = showSuggestions && loadingSuggestions
  // Só afirma "não existe" depois que a resposta DESTA busca voltou.
  const searchedAndEmpty = showSuggestions && settledQuery === trimmed && suggestions.length === 0
  const showPopover =
    open && (showSuggestions || filteredHistory.length > 0)

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
            placeholder="Digite o nome da obra"
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
          {isSearching ? (
            <span
              aria-hidden
              className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin rounded-full border-2 border-muted border-t-primary"
            />
          ) : (
            value && (
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
            )
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
          <CommandList className="max-h-[22rem]">
            {showSuggestions && suggestions.length > 0 && (
              <CommandGroup heading="Obras no catálogo">
                {suggestions.map((s) => (
                  <CommandItem
                    key={s.id}
                    value={`work-${s.id}`}
                    onSelect={() => {
                      setOpen(false)
                      router.push(`/titles/${s.slug}`)
                    }}
                    onMouseDown={(e) => e.preventDefault()}
                    className="gap-2.5"
                  >
                    {s.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.coverUrl}
                        alt=""
                        className="h-11 w-8 shrink-0 rounded-sm object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="h-11 w-8 shrink-0 rounded-sm bg-muted" />
                    )}
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-sm font-medium">{s.title}</span>
                      <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        {s.publicationStatus && <span>{s.publicationStatus}</span>}
                        {s.totalChapters != null && (
                          <>
                            <span className="opacity-50">·</span>
                            <span className="tabular-nums">{s.totalChapters} caps</span>
                          </>
                        )}
                        {s.year != null && (
                          <>
                            <span className="opacity-50">·</span>
                            <span className="tabular-nums">{s.year}</span>
                          </>
                        )}
                      </span>
                      {/* Sem isto o usuário vê um nome que não tem nada a ver com o
                          que digitou — o casamento veio de um título alternativo. */}
                      {s.matchedAlias && (
                        <span className="truncate text-[11px] italic text-muted-foreground">
                          achou por: {s.matchedAlias}
                        </span>
                      )}
                    </span>
                    {s.isAdult && (
                      <span className="ml-auto shrink-0 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold text-destructive">
                        18+
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {searchedAndEmpty && <CommandEmpty>Nenhuma obra com esse nome</CommandEmpty>}

            {filteredHistory.length > 0 && (
              <CommandGroup heading="Buscas recentes">
                {filteredHistory.map((term) => (
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
  signatureCounts = [],
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

  // Busca ao vivo: aplica o termo por cima dos filtros JÁ APLICADOS (a URL), não
  // por cima do rascunho. Digitar não pode commitar em silêncio filtros que você
  // mexeu mas ainda não clicou em "Aplicar".
  const applySearchNow = useCallback(
    (term: string) => {
      const next = new URLSearchParams(appliedSearchString)
      const trimmed = term.trim()
      if (trimmed) next.set("search", trimmed)
      else next.delete("search")
      // Sem isto, buscar estando na página 3 cai num recorte vazio: a busca nova
      // costuma ter menos de 3 páginas.
      next.delete("page")
      const qs = next.toString()
      startTransition(() => router.replace(qs ? `/titles?${qs}` : "/titles"))
    },
    [appliedSearchString, router],
  )

  const liveSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applySearchLive = useCallback(
    (term: string) => {
      if (liveSearchTimer.current) clearTimeout(liveSearchTimer.current)
      liveSearchTimer.current = setTimeout(() => applySearchNow(term), LIVE_SEARCH_DEBOUNCE_MS)
    },
    [applySearchNow],
  )
  useEffect(() => () => {
    if (liveSearchTimer.current) clearTimeout(liveSearchTimer.current)
  }, [])

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
    const validField = ALL_SORTABLE_FIELDS.some((x) => x.value === f) ? f : "expected_score"
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
  const selectedSignatures = csvSet(searchParams, "signature")
  const adultParam = searchParams.get("adult")
  const adultMode: "all" | "hide" | "only" =
    adultParam === "hide" ? "hide" : adultParam === "only" ? "only" : "all"
  const criterionRangeCount = CRITERION_SLUGS.filter(
    (slug) => searchParams.get(`min_${slug}`) || searchParams.get(`max_${slug}`),
  ).length
  const attributesTabCount = selectedSignatures.size + criterionRangeCount

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
  pushRange("chapters", LABELS.chapters_total.short, "min_chapters", "max_chapters")
  pushRange("expected", LABELS.expected_score.full, "min_expected", "max_expected")
  pushRange("fit", LABELS.personal_fit.full, "min_fit", "max_fit")
  pushRange("platform", LABELS.platform_avg.full, "min_platform_avg", "max_platform_avg")
  pushRange("votes", LABELS.total_votes.full, "min_votes", "max_votes")
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
  selectedSignatures.forEach((slug) => activeChips.push({
    key: `sig-${slug}`,
    label: `Assinatura: ${CRITERION_LABELS[slug] ?? slug}`,
    onRemove: () => toggleCsv("signature", slug),
  }))
  if (searchParams.get("rated") === "1") {
    activeChips.push({ key: "rated", label: "Só avaliadas", onRemove: () => updateParams({ rated: null }) })
  }
  if (searchParams.get("only_scored") === "1") {
    activeChips.push({
      key: "only_scored",
      label: `Só com ${LABELS.expected_score.full}`,
      onRemove: () => updateParams({ only_scored: null }),
    })
  }
  if (searchParams.get("fav") === "1") {
    activeChips.push({ key: "fav", label: "Só favoritas", onRemove: () => updateParams({ fav: null }) })
  }
  if (searchParams.get("archived") === "1") {
    activeChips.push({ key: "archived", label: "Incluindo arquivadas", onRemove: () => updateParams({ archived: null }) })
  }
  if (adultMode !== "all") {
    activeChips.push({
      key: "adult",
      label: adultMode === "only" ? "Só 18+" : "Ocultando 18+",
      onRemove: () => updateParams({ adult: null }),
    })
  }
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
              applySearchLive(v)
            }}
            onSubmit={(term) => {
              updateParams({ search: term || null })
              applySearchNow(term)
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
                <SelectGroup>
                  <SelectLabel className="text-[10px] uppercase tracking-wider">
                    Notas e metadados
                  </SelectLabel>
                  {SORTABLE_FIELDS.map((f) => (
                    <SelectItem key={f.value} value={f.value} className="text-sm">
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
                <SelectGroup>
                  <SelectLabel className="text-[10px] uppercase tracking-wider">
                    Atributos
                  </SelectLabel>
                  {CRITERION_SORT_FIELDS.map((f) => (
                    <SelectItem key={f.value} value={f.value} className="text-sm">
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
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
        <Tabs defaultValue="geral" className="mt-3 space-y-3">
          <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 p-1">
            <TabsTrigger value="geral" className="h-9 min-w-20 flex-none text-sm data-[state=active]:bg-card/85 data-[state=active]:shadow-sm xl:min-w-0 xl:flex-1">
              Geral
            </TabsTrigger>
            {/* "Atributos", não "Notas": aqui a pergunta é que TIPO de obra é, não
                se a nota passa de um limiar — essa é a do /ranking. */}
            <TabsTrigger value="atributos" className="h-9 min-w-20 flex-none gap-1.5 text-sm data-[state=active]:bg-card/85 data-[state=active]:shadow-sm xl:min-w-0 xl:flex-1">
              Atributos
              {attributesTabCount > 0 && (
                <Badge className="h-4 px-1.5 text-[10px] tabular-nums">{attributesTabCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="generos" className="h-9 min-w-20 flex-none gap-1.5 text-sm data-[state=active]:bg-card/85 data-[state=active]:shadow-sm xl:min-w-0 xl:flex-1">
              Gêneros
              {selectedGenreAny.size > 0 && (
                <Badge className="h-4 px-1.5 text-[10px] tabular-nums">{selectedGenreAny.size}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="tags" className="h-9 min-w-20 flex-none gap-1.5 text-sm data-[state=active]:bg-card/85 data-[state=active]:shadow-sm xl:min-w-0 xl:flex-1">
              Tags
              {selectedTagAny.size > 0 && (
                <Badge className="h-4 px-1.5 text-[10px] tabular-nums">{selectedTagAny.size}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="geral" className="space-y-3">
          {/* O que mostrar: recortes booleanos + conteúdo 18+ */}
          <FilterCard title="O que mostrar">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <ToggleChip
                label="⭐ Só avaliadas"
                tone="positive"
                active={searchParams.get("rated") === "1"}
                onClick={() =>
                  updateParams({ rated: searchParams.get("rated") === "1" ? null : "1" })
                }
                tooltip="Só obras com nota pessoal sua — as que treinaram o modelo. Ligar isto também mostra as já terminadas e abandonadas."
              />
              <ToggleChip
                label={`🎯 Só com ${LABELS.expected_score.short}`}
                active={searchParams.get("only_scored") === "1"}
                onClick={() =>
                  updateParams({ only_scored: searchParams.get("only_scored") === "1" ? null : "1" })
                }
                tooltip="Esconde obras sem Nota Prevista (as que ainda não têm os 9 atributos de IA)."
              />
              <ToggleChip
                label="❤️ Só favoritas"
                active={searchParams.get("fav") === "1"}
                onClick={() => updateParams({ fav: searchParams.get("fav") === "1" ? null : "1" })}
              />
              <ToggleChip
                label="📦 Incluir arquivadas"
                active={searchParams.get("archived") === "1"}
                onClick={() =>
                  updateParams({ archived: searchParams.get("archived") === "1" ? null : "1" })
                }
              />

              <div className="flex items-center gap-2">
                <Label
                  className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                  title="Filtra pela classificação da obra (o mesmo selo 🔞 da página da obra), não pelas tags. 'Tudo' respeita sua preferência global."
                >
                  Conteúdo 18+
                </Label>
                <AdultContentSegment
                  value={adultMode}
                  onChange={(v) => updateParams({ adult: v === "all" ? null : v })}
                />
              </div>
            </div>
          </FilterCard>

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
              label={LABELS.expected_score.full}
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
          </TabsContent>

          {/* ==================== ATRIBUTOS ==================== */}
          <TabsContent value="atributos" className="space-y-3">
            <FilterCard
              title={`Assinatura — o que mais marca a obra${selectedSignatures.size ? ` (${selectedSignatures.size})` : ""}`}
              action={
                selectedSignatures.size > 0 ? (
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => updateParams({ signature: null })}
                  >
                    Limpar
                  </button>
                ) : undefined
              }
            >
              <p className="mb-2.5 text-[11px] leading-relaxed text-muted-foreground">
                O atributo mais fora da curva da obra, comparado à média do catálogo — não a nota
                mais alta. Seu catálogo tem Romance alto em quase tudo, então &ldquo;Romance
                alto&rdquo; não distinguiria nada. Contagens sobre o catálogo, sem os outros
                filtros.
              </p>
              {signatureCounts.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Nenhuma obra com os 9 atributos avaliados ainda.
                </p>
              ) : (
                <SignatureGrid
                  counts={signatureCounts}
                  selected={selectedSignatures}
                  onToggle={(slug) => toggleCsv("signature", slug)}
                />
              )}
            </FilterCard>

            {/* Mín/máx dos 9 fica RECOLHIDO: é o controle que o /ranking já tem, e
                deixá-lo aberto faria esta aba virar cópia daquela. */}
            <details className="group rounded-lg border bg-background shadow-sm">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                Ajuste fino — mín/máx dos 9 atributos
                {criterionRangeCount > 0 && (
                  <Badge className="ml-1 h-4 px-1.5 text-[10px] tabular-nums">{criterionRangeCount}</Badge>
                )}
              </summary>
              <div className="grid grid-cols-2 gap-2 border-t px-3 py-3 md:grid-cols-3 xl:grid-cols-5">
                {CRITERION_SLUGS.map((slug) => (
                  <ScoreRangeCard
                    key={slug}
                    emoji={CRITERIA_INFO[slug]?.emoji ?? "•"}
                    label={CRITERION_LABELS[slug] ?? slug}
                    tooltip={CRITERIA_INFO[slug]?.description}
                    minKey={`min_${slug}`}
                    maxKey={`max_${slug}`}
                    step={0.5}
                    searchParams={searchParams}
                    updateParams={updateParams}
                  />
                ))}
              </div>
            </details>
          </TabsContent>

          {/* ==================== GÊNEROS ==================== */}
          <TabsContent value="generos">
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
          </TabsContent>

          {/* ==================== TAGS ==================== */}
          <TabsContent value="tags">
            <FilterCard title={`Tags${selectedTagAny.size ? ` (${selectedTagAny.size})` : ""}`}>
              <TagFilter
                selected={[...selectedTagAny]}
                onChange={(slugs) =>
                  updateParams({ tags_any: slugs.length ? slugs.join(",") : null })
                }
                availableTags={availableTags}
              />
            </FilterCard>
          </TabsContent>
        </Tabs>
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

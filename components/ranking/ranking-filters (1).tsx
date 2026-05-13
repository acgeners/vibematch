"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo, useState, useSyncExternalStore, useTransition } from "react"
import { ArrowDown, ArrowUp, ChevronDown, Filter, Plus, Save, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Checkbox } from "@/components/ui/checkbox"
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
const HIDDEN_PERSONAL_STATUS_PREVIOUS = new Set(["Finalizado", "Droppado"])
const FACET_VISIBLE_LIMIT = 18

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
  searchParams: ReturnType<typeof import("next/navigation").useSearchParams>
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
}

interface RankingFiltersProps {
  availableGenres: string[]
  availableTags: Array<{ slug: string; name: string }>
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

function num(v: string | null | undefined): number | undefined {
  if (!v) return undefined
  const n = parseFloat(v)
  return isNaN(n) ? undefined : n
}

function StatusButton({
  option,
  active,
  onClick,
}: {
  option: StatusOption
  active: boolean
  onClick: () => void
}) {
  const style = active && option.color
    ? { backgroundColor: option.color, borderColor: option.color, color: "#fff" }
    : option.color
      ? { borderColor: option.color, color: option.color }
      : undefined
  return (
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
}

interface FacetedChoice {
  value: string
  label: string
}

interface FacetedBucketsProps {
  items: FacetedChoice[]
  selectedAll: Set<string>
  selectedAny: Set<string>
  selectedExclude: Set<string>
  onToggle: (key: "all" | "any" | "exclude", value: string) => void
}

function FacetedBuckets({
  items,
  selectedAll,
  selectedAny,
  selectedExclude,
  onToggle,
}: FacetedBucketsProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const buckets = [
    { key: "all" as const, title: "Obrigatórios (AND)", selected: selectedAll },
    { key: "any" as const, title: "Pelo menos um (OR)", selected: selectedAny },
    { key: "exclude" as const, title: "Excluir", selected: selectedExclude },
  ]

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      {buckets.map((bucket) => (
        <div key={bucket.key} className="flex min-h-44 flex-col rounded-lg border bg-muted/10 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {bucket.title}
            </p>
            {bucket.selected.size > 0 && (
              <span className="rounded-full bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {bucket.selected.size}
              </span>
            )}
          </div>
          <div className={`${expanded[bucket.key] ? "max-h-64 overflow-y-auto pr-1" : ""} flex flex-wrap gap-1.5`}>
            {(() => {
              const selectedItems = items.filter((item) => bucket.selected.has(item.value))
              const unselectedItems = items.filter((item) => !bucket.selected.has(item.value))
              const visibleItems = expanded[bucket.key]
                ? items
                : [...selectedItems, ...unselectedItems].slice(0, Math.max(FACET_VISIBLE_LIMIT, selectedItems.length))

              return visibleItems.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => onToggle(bucket.key, item.value)}
              >
                <Badge
                  variant={bucket.selected.has(item.value) ? "default" : "outline"}
                  className="cursor-pointer rounded-full text-[10px]"
                >
                  {item.label}
                </Badge>
              </button>
              ))
            })()}
            {items.length === 0 && (
              <span className="text-xs text-muted-foreground">Sem resultados</span>
            )}
          </div>
          {items.length > FACET_VISIBLE_LIMIT && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-auto h-8 self-start px-2 text-xs text-muted-foreground"
              onClick={() => setExpanded((prev) => ({ ...prev, [bucket.key]: !prev[bucket.key] }))}
            >
              {expanded[bucket.key] ? "Mostrar menos" : `Mostrar mais (${items.length - FACET_VISIBLE_LIMIT})`}
            </Button>
          )}
        </div>
      ))}
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
  const searchParams = useSearchParams()
  const [, startTransition] = useTransition()

  const updateParams = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") {
          params.delete(key)
        } else {
          params.set(key, value)
        }
      }
      startTransition(() => router.replace(`/ranking?${params.toString()}`))
    },
    [router, searchParams]
  )

  const hasFilters = searchParams.toString() !== ""

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

  const clearAll = () => startTransition(() => router.replace("/ranking"))

  // Multi-select helpers (CSV em URL)
  const csvSet = (key: string): Set<string> => {
    const v = searchParams.get(key)
    if (!v) return new Set()
    return new Set(v.split(",").map((s) => s.trim()).filter(Boolean))
  }
  const toggleCsv = (key: string, item: string) => {
    const set = csvSet(key)
    if (set.has(item)) set.delete(item)
    else set.add(item)
    updateParams({ [key]: set.size === 0 ? null : [...set].join(",") })
  }
  const toggleExclusiveCsv = (key: string, item: string, relatedKeys: string[]) => {
    const updates: Record<string, string | null> = {}
    for (const relatedKey of relatedKeys) {
      const set = csvSet(relatedKey)
      if (relatedKey === key) {
        if (set.has(item)) set.delete(item)
        else set.add(item)
      } else {
        set.delete(item)
      }
      updates[relatedKey] = set.size === 0 ? null : [...set].join(",")
    }
    updateParams(updates)
  }
  const selectedGenreAll = csvSet("genres_all")
  const selectedGenreAny = csvSet("genres_any")
  const selectedGenreExclude = csvSet("genres_exclude")
  const selectedTagAll = csvSet("tags_all")
  const selectedTagAny = csvSet("tags_any")
  const selectedTagExclude = csvSet("tags_exclude")
  const selectedSynopsisQ = csvSet("synopsis_q")
  const selectedPublicationStatuses = csvSet("pub_status")
  const perStatusParam = searchParams.get("per_status")
  const isAllPersonal = perStatusParam === "all"
  const selectedPerStatuses = isAllPersonal
    ? new Set<string>()
    : perStatusParam
      ? csvSet("per_status")
      : new Set(["Ler"])

  const [genreSearch, setGenreSearch] = useState("")
  const filteredGenres = useMemo(
    () =>
      availableGenres.filter((g) => g.toLowerCase().includes(genreSearch.toLowerCase())),
    [availableGenres, genreSearch]
  )
  const filteredGenreChoices = useMemo(
    () => filteredGenres.map((genre) => ({ value: genre, label: genre })),
    [filteredGenres]
  )
  const [tagSearch, setTagSearch] = useState("")
  const filteredTags = useMemo(
    () =>
      availableTags.filter((t) => t.name.toLowerCase().includes(tagSearch.toLowerCase())),
    [availableTags, tagSearch]
  )
  const filteredTagChoices = useMemo(
    () => filteredTags.map((tag) => ({ value: tag.slug, label: tag.name })),
    [filteredTags]
  )

  // Filtra os status pessoais — Finalizado e Droppado nunca aparecem
  const visiblePersonalStatuses = useMemo(
    () => personalStatuses.filter((s) => !HIDDEN_PERSONAL_STATUS_PREVIOUS.has(s.previous)),
    [personalStatuses]
  )

  return (
    <div className="rounded-xl border bg-muted/10 p-3 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Filter className="h-4 w-4 text-muted-foreground" />
          Filtros
        </div>
        <div className="flex items-center gap-2">
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
                {publicationStatuses.map((s) => (
                  <StatusButton
                    key={s.id}
                    option={s}
                    active={selectedPublicationStatuses.has(s.previous)}
                    onClick={() => toggleCsv("pub_status", s.previous)}
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
                    key={s.id}
                    option={s}
                    active={!isAllPersonal && selectedPerStatuses.has(s.previous)}
                    onClick={() => {
                      if (isAllPersonal) {
                        updateParams({ per_status: s.previous })
                      } else {
                        toggleCsv("per_status", s.previous)
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
          <FilterSection title="Notas por critério">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {CRITERION_SLUGS.map((slug) => {
                const minKey = `min_${slug}`
                const maxKey = `max_${slug}`
                return (
                  <div key={slug} className="grid grid-cols-[minmax(9rem,1fr)_5rem_auto_5rem] items-center gap-2 rounded-lg border bg-muted/10 p-2">
                    <Label className="text-xs font-medium">{CRITERION_LABELS[slug]}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      step={0.5}
                      placeholder="Mín"
                      className="h-8 text-xs"
                      value={searchParams.get(minKey) ?? ""}
                      onChange={(e) => updateParams({ [minKey]: e.target.value })}
                    />
                    <span className="text-xs text-muted-foreground">-</span>
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      step={0.5}
                      placeholder="Máx"
                      className="h-8 text-xs"
                      value={searchParams.get(maxKey) ?? ""}
                      onChange={(e) => updateParams({ [maxKey]: e.target.value })}
                    />
                  </div>
                )
              })}
            </div>
          </FilterSection>
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
            <FacetedBuckets
              items={filteredGenreChoices}
              selectedAll={selectedGenreAll}
              selectedAny={selectedGenreAny}
              selectedExclude={selectedGenreExclude}
              onToggle={(bucket, value) => {
                const key = bucket === "all"
                  ? "genres_all"
                  : bucket === "any"
                    ? "genres_any"
                    : "genres_exclude"
                toggleExclusiveCsv(key, value, ["genres_all", "genres_any", "genres_exclude"])
              }}
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
            <FacetedBuckets
              items={filteredTagChoices}
              selectedAll={selectedTagAll}
              selectedAny={selectedTagAny}
              selectedExclude={selectedTagExclude}
              onToggle={(bucket, value) => {
                const key = bucket === "all"
                  ? "tags_all"
                  : bucket === "any"
                    ? "tags_any"
                    : "tags_exclude"
                toggleExclusiveCsv(key, value, ["tags_all", "tags_any", "tags_exclude"])
              }}
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

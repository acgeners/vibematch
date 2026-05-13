"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useTransition, useState, useMemo } from "react"
import { TagFilter } from "@/components/titles/tag-filter"
import type { TagSuggestion } from "@/lib/external/types"
import { Search, X, ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  { value: "final_score:asc",  label: "Nota.Final ↑" },
  { value: "calc_score:desc",  label: "Nota.IA ↓" },
  { value: "predicted_score:desc",  label: "Nota.Pr ↓" },
  { value: "title:asc",        label: "Título A-Z" },
  { value: "title:desc",       label: "Título Z-A" },
  { value: "total_chapters:desc", label: "Capítulos ↓" },
  { value: "updated_at:desc",  label: "Atualizado recentemente" },
  { value: "created_at:desc",  label: "Adicionado recentemente" },
]

interface FilterDraft {
  search: string
  pubStatuses: string[]
  personalStatuses: string[]
  aiStatuses: string[]
  showArchived: boolean
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
    minScore: searchParams.get("min_score") ?? "",
    maxScore: searchParams.get("max_score") ?? "",
    minChapters: searchParams.get("min_chapters") ?? "",
    maxChapters: searchParams.get("max_chapters") ?? "",
    genre: searchParams.get("genre") ?? "",
    tagSlugs: searchParams.getAll("tag"),
    sortValue: searchParams.get("sort") ?? "final_score:desc",
  }), [searchParams])
  const [draft, setDraft] = useState<FilterDraft>(getDraftFromParams)
  const [showAdvanced, setShowAdvanced] = useState(() => {
    return !!(
      searchParams.get("min_score") ||
      searchParams.get("max_score") ||
      searchParams.get("min_chapters") ||
      searchParams.get("max_chapters") ||
      searchParams.get("genre") ||
      searchParams.getAll("tag").length
    )
  })

  const {
    search,
    pubStatuses,
    personalStatuses,
    aiStatuses,
    showArchived,
    minScore,
    maxScore,
    minChapters,
    maxChapters,
    genre,
    tagSlugs,
    sortValue,
  } = draft
  const tagSlugKey = tagSlugs.join(",")

  // Reconstruct TagSuggestion objects from URL slugs (name derived from slug for display)
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
    const params = new URLSearchParams()
    if (search) params.set("search", search)
    pubStatuses.forEach((status) => params.append("pub", status))
    personalStatuses.forEach((status) => params.append("personal", status))
    aiStatuses.forEach((status) => params.append("ai", status))
    if (showArchived) params.set("archived", "1")
    if (minScore) params.set("min_score", minScore)
    if (maxScore) params.set("max_score", maxScore)
    if (minChapters) params.set("min_chapters", minChapters)
    if (maxChapters) params.set("max_chapters", maxChapters)
    if (genre) params.set("genre", genre)
    tagSlugs.forEach((slug) => params.append("tag", slug))
    if (sortValue !== "final_score:desc") params.set("sort", sortValue)

    const query = params.toString()
    startTransition(() => router.replace(query ? `/titles?${query}` : "/titles"))
  }

  const clearAll = () => {
    setDraft({
      search: "",
      pubStatuses: [],
      personalStatuses: [],
      aiStatuses: [],
      showArchived: false,
      minScore: "",
      maxScore: "",
      minChapters: "",
      maxChapters: "",
      genre: "",
      tagSlugs: [],
      sortValue: "final_score:desc",
    })
    startTransition(() => router.replace("/titles"))
  }

  const toggleArray = (key: "pubStatuses" | "personalStatuses" | "aiStatuses", current: string[], value: string) => {
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

  const advancedActive = !!(minScore || maxScore || minChapters || maxChapters || genre || tagSlugs.length)
  const hasFilters =
    search || pubStatuses.length || personalStatuses.length || aiStatuses.length ||
    showArchived || advancedActive || sortValue !== "final_score:desc"

  return (
    <div className="space-y-3 bg-muted/30 border rounded-lg p-4">
      {/* Linha 1: busca + ordenação */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por título..."
            className="pl-8 pr-9"
            value={search}
            onChange={(e) => updateDraft({ search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                applyFilters()
              }
            }}
          />
          {search && (
            <button
              type="button"
              aria-label="Limpar busca por título"
              onClick={() => updateDraft({ search: "" })}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select
          value={sortValue}
          onValueChange={(v) => updateDraft({ sortValue: v })}
        >
          <SelectTrigger className="w-52 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Linha 2: status em grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Publicação
          </Label>
          <div className="flex flex-wrap gap-1">
            {PUBLICATION_STATUSES.filter((s) => s !== "Unknown").map((s) => (
              <button key={s} type="button" onClick={() => toggleArray("pubStatuses", pubStatuses, s)}>
                <Badge variant={pubStatuses.includes(s) ? "default" : "outline"} className="cursor-pointer text-xs">
                  {PUBLICATION_STATUS_LABELS[s]}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pessoal
          </Label>
          <div className="flex flex-wrap gap-1">
            {PERSONAL_STATUSES.map((s) => (
              <button key={s} type="button" onClick={() => toggleArray("personalStatuses", personalStatuses, s)}>
                <Badge variant={personalStatuses.includes(s) ? "default" : "outline"} className="cursor-pointer text-xs">
                  {PERSONAL_STATUS_LABELS[s]}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Status IA
          </Label>
          <div className="space-y-1.5">
            {AI_EVAL_STATUSES.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <Checkbox
                  id={`ai-${s}`}
                  checked={aiStatuses.includes(s)}
                  onCheckedChange={() => toggleArray("aiStatuses", aiStatuses, s)}
                />
                <Label htmlFor={`ai-${s}`} className="text-sm cursor-pointer">
                  {AI_STATUS_LABELS[s]}
                </Label>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toggle filtros avançados */}
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filtros avançados
        {advancedActive && (
          <Badge variant="secondary" className="h-4 px-1 text-[10px]">ativos</Badge>
        )}
        {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {/* Filtros avançados */}
      {showAdvanced && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 border-t">
          {/* Nota.Final range */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Nota.Final
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step={0.5}
                min={0}
                max={10}
                placeholder="Mín"
                className="h-8 text-sm"
                value={minScore}
                onChange={(e) => updateDraft({ minScore: e.target.value })}
              />
              <span className="text-muted-foreground text-sm">–</span>
              <Input
                type="number"
                step={0.5}
                min={0}
                max={10}
                placeholder="Máx"
                className="h-8 text-sm"
                value={maxScore}
                onChange={(e) => updateDraft({ maxScore: e.target.value })}
              />
            </div>
          </div>

          {/* Capítulos range */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Capítulos
            </Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                placeholder="Mín"
                className="h-8 text-sm"
                value={minChapters}
                onChange={(e) => updateDraft({ minChapters: e.target.value })}
              />
              <span className="text-muted-foreground text-sm">–</span>
              <Input
                type="number"
                min={0}
                placeholder="Máx"
                className="h-8 text-sm"
                value={maxChapters}
                onChange={(e) => updateDraft({ maxChapters: e.target.value })}
              />
            </div>
          </div>

          {/* Gênero */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Gênero
            </Label>
            <div className="flex gap-2">
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
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => updateDraft({ genre: "" })}
                  aria-label="Limpar gênero"
                  title="Limpar gênero"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground">Apenas tags do grupo Genre</p>
          </div>

          {/* Tags */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Tags
            </Label>
            <TagFilter
              selected={selectedTags}
              onAdd={addTag}
              onRemove={removeTag}
            />
            <p className="text-[10px] text-muted-foreground">Obras com todas as tags selecionadas</p>
          </div>
        </div>
      )}

      {/* Linha final: arquivados + limpar */}
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-2">
          <Checkbox
            id="show-archived"
            checked={showArchived}
            onCheckedChange={(checked) => updateDraft({ showArchived: checked === true })}
          />
          <Label htmlFor="show-archived" className="text-sm cursor-pointer">
            Mostrar arquivadas
          </Label>
        </div>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearAll} disabled={isPending}>
              <X className="h-4 w-4 mr-1" />
              Limpar filtros
            </Button>
          )}
          <Button size="sm" onClick={applyFilters} disabled={isPending}>
            Aplicar filtros
          </Button>
        </div>
      </div>
    </div>
  )
}

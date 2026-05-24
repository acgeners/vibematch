"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type ColumnSizingState,
} from "@tanstack/react-table"
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  HeartOff,
  ImageOff,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Rows3,
  Settings2,
  X,
} from "lucide-react"
import { formatRelativeDate, formatFullDateTime } from "@/lib/date-utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { toast } from "sonner"
import type { CategoryScore, WorkWithRelations, WorkCover } from "@/types/domain"
import { CRITERION_SLUGS } from "@/types/domain"
import { cn, titleToSlug } from "@/lib/utils"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { ScoreBadge, type ScoreColorThresholds } from "@/components/ui/score-badge"
import {
  AiStatusBadge,
  PersonalStatusBadge,
  PublicationStatusBadge,
} from "@/components/ui/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { archiveWork, setFavoriteMany, toggleFavorite, unarchiveWork } from "@/server/actions/works"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { AlignmentScoreCell } from "@/components/ranking/ranking-cells"
import { WorkCompareDrawer } from "@/components/titles/work-compare-drawer"
import { WorkHeatmapView } from "@/components/titles/work-heatmap-view"
import { WorkColumnPicker } from "@/components/titles/work-column-picker"
import {
  DEFAULT_COLUMN_WIDTHS,
  getConfiguredWorkColumns,
  getDefaultWorkColumnConfig,
  normalizeWorkColumnConfig,
  readWorkColumnConfig,
  subscribeWorkColumnConfig,
  writeWorkColumnConfig,
  type WorkColumnNamespace,
} from "@/components/titles/work-table-config"
import { MAX_COMPARE_WORKS } from "@/lib/compare-config"

type ViewMode = "list" | "cards" | "heatmap"

function viewStorageKey(namespace: WorkColumnNamespace): string {
  return `${namespace}_view_mode_v1`
}

function viewEventName(namespace: WorkColumnNamespace): string {
  return `${namespace}-view-mode-change`
}

function readViewMode(namespace: WorkColumnNamespace): ViewMode {
  if (typeof window === "undefined") return "list"
  const stored = window.localStorage.getItem(viewStorageKey(namespace))
  if (stored === "cards") return "cards"
  if (stored === "heatmap") return "heatmap"
  return "list"
}

function subscribeViewMode(namespace: WorkColumnNamespace, onChange: () => void) {
  if (typeof window === "undefined") return () => {}
  const event = viewEventName(namespace)
  window.addEventListener(event, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(event, onChange)
    window.removeEventListener("storage", onChange)
  }
}

function writeViewMode(namespace: WorkColumnNamespace, mode: ViewMode) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(viewStorageKey(namespace), mode)
  window.dispatchEvent(new CustomEvent(viewEventName(namespace)))
}

interface WorkTableProps {
  works: WorkWithRelations[]
  total: number
  page: number
  pageSize: number
  searchQuery?: string
  scoreThresholds?: ScoreColorThresholds | null
  selectedCompareIds?: string[]
  namespace?: WorkColumnNamespace
  basePath?: string
  enableCompare?: boolean
  enableHeatmap?: boolean
  enableSelectAll?: boolean
}

function scoreFor(work: WorkWithRelations, slug: string): number | null {
  const cs = (work.category_scores ?? []).find((c: CategoryScore) => c.criterion_slug === slug)
  return cs?.score != null ? Number(cs.score) : null
}

function getCriterionColorClass(score: number, slug: string): string {
  const isNegative = slug === "drama" || slug === "tragedy"
  if (isNegative) {
    if (score <= 3) return "bg-green-100 text-green-800"
    if (score <= 5) return "bg-yellow-100 text-yellow-800"
    return "bg-red-100 text-red-800"
  }
  if (score >= 8) return "bg-emerald-100 text-emerald-800"
  if (score >= 6) return "bg-green-100 text-green-800"
  if (score >= 4) return "bg-yellow-100 text-yellow-800"
  return "bg-red-100 text-red-800"
}

export function WorkTable({
  works,
  total,
  page,
  pageSize,
  searchQuery,
  scoreThresholds = null,
  selectedCompareIds = [],
  namespace = "titles",
  basePath = "/titles",
  enableCompare = true,
  enableHeatmap = true,
  enableSelectAll = false,
}: WorkTableProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const storedViewMode = useSyncExternalStore(
    (onChange) => subscribeViewMode(namespace, onChange),
    () => readViewMode(namespace),
    () => "list" as const,
  )
  const viewMode: ViewMode = !enableHeatmap && storedViewMode === "heatmap" ? "list" : storedViewMode
  const setViewModePersisted = (mode: ViewMode) => writeViewMode(namespace, mode)

  // Selection lives in client state to avoid a full Next.js server re-render
  // (which re-runs getRanking + getWorksByIds + …) on every checkbox click.
  // The URL is updated via history.replaceState so refresh/share still works.
  const [compareIds, setCompareIds] = useState<string[]>(selectedCompareIds)
  const selectedSet = useMemo(() => new Set(compareIds), [compareIds])
  const [drawerOpen, setDrawerOpen] = useState(false)

  const updateCompareIds = useCallback(
    (nextIds: string[]) => {
      setCompareIds(nextIds)
      if (typeof window === "undefined") return
      const params = new URLSearchParams(window.location.search)
      params.delete("compare")
      for (const id of nextIds) params.append("compare", id)
      const qs = params.toString()
      const url = qs ? `${basePath}?${qs}` : basePath
      window.history.replaceState(null, "", url)
    },
    [basePath]
  )

  const toggleCompare = useCallback(
    (id: string) => {
      if (selectedSet.has(id)) {
        updateCompareIds(compareIds.filter((x) => x !== id))
        return
      }
      updateCompareIds([...compareIds, id])
    },
    [selectedSet, compareIds, updateCompareIds]
  )

  const clearCompare = useCallback(() => {
    updateCompareIds([])
    setDrawerOpen(false)
  }, [updateCompareIds])

  const allVisibleIds = useMemo(() => works.map((w) => w.id), [works])
  const allSelected =
    allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedSet.has(id))
  const someSelected = !allSelected && selectedSet.size > 0
  const selectAllVisible = useCallback(() => {
    updateCompareIds(allVisibleIds)
  }, [allVisibleIds, updateCompareIds])

  const favoriteSelectedIds = useMemo(
    () => works.filter((w) => selectedSet.has(w.id) && w.is_favorite).map((w) => w.id),
    [works, selectedSet]
  )

  const handleBatchUnfavorite = useCallback(async () => {
    if (favoriteSelectedIds.length === 0) return
    const result = await setFavoriteMany(favoriteSelectedIds, false)
    if (result.error) {
      toast.error("Erro ao desfavoritar")
      return
    }
    const n = favoriteSelectedIds.length
    toast.success(`${n} obra${n !== 1 ? "s" : ""} desfavoritada${n !== 1 ? "s" : ""}`)
    updateCompareIds([])
    router.refresh()
  }, [favoriteSelectedIds, updateCompareIds, router])

  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {total} obra{total !== 1 ? "s" : ""}
          {totalPages > 1 && (
            <span> · página {page} de {totalPages}</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          {(viewMode === "list" || viewMode === "heatmap") && (
            <WorkColumnPicker namespace={namespace} />
          )}
          <ViewModeToggle value={viewMode} onChange={setViewModePersisted} enableHeatmap={enableHeatmap} />
        </div>
      </div>

      {works.length === 0 ? (
        <EmptyState searchQuery={searchQuery} />
      ) : viewMode === "cards" ? (
        <WorkCardsView
          works={works}
          scoreThresholds={scoreThresholds}
          selectedIds={selectedSet}
          onToggleSelect={toggleCompare}
          enableCompare={enableCompare}
        />
      ) : viewMode === "heatmap" ? (
        <WorkHeatmapView
          works={works}
          scoreThresholds={scoreThresholds}
          selectedIds={selectedSet}
          onToggleSelect={toggleCompare}
          namespace={namespace}
          enableCompare={enableCompare}
        />
      ) : (
        <WorkListView
          works={works}
          searchParams={searchParams}
          router={router}
          scoreThresholds={scoreThresholds}
          selectedIds={selectedSet}
          onToggleSelect={toggleCompare}
          namespace={namespace}
          basePath={basePath}
          enableCompare={enableCompare}
          enableSelectAll={enableSelectAll}
          allSelected={allSelected}
          someSelected={someSelected}
          onSelectAll={selectAllVisible}
          onClearAll={clearCompare}
        />
      )}

      {totalPages > 1 && works.length > 0 && (
        <Pagination page={page} totalPages={totalPages} router={router} basePath={basePath} />
      )}

      {enableCompare && (
        <>
          <CompareSelectionBar
            count={compareIds.length}
            favoriteCount={favoriteSelectedIds.length}
            onOpen={() => setDrawerOpen(true)}
            onClear={clearCompare}
            onUnfavorite={handleBatchUnfavorite}
          />

          <WorkCompareDrawer
            open={drawerOpen}
            onOpenChange={setDrawerOpen}
            ids={compareIds}
            onClear={clearCompare}
            onRemoveId={(id) =>
              updateCompareIds(compareIds.filter((x) => x !== id))
            }
            scoreThresholds={scoreThresholds}
          />
        </>
      )}
    </div>
  )
}

function CompareSelectionBar({
  count,
  favoriteCount,
  onOpen,
  onClear,
  onUnfavorite,
}: {
  count: number
  favoriteCount: number
  onOpen: () => void
  onClear: () => void
  onUnfavorite: () => void
}) {
  if (count === 0) return null
  const compareDisabled = count > MAX_COMPARE_WORKS
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
        <span className="text-sm">
          <span className="font-semibold">{count}</span>
          <span className="ml-1 text-muted-foreground">
            obra{count !== 1 ? "s" : ""} selecionada{count !== 1 ? "s" : ""}
          </span>
        </span>
        <Button
          size="sm"
          onClick={onOpen}
          disabled={compareDisabled}
          title={compareDisabled ? `Máximo de ${MAX_COMPARE_WORKS} obras para comparar` : undefined}
          className="h-7 text-xs"
        >
          Comparar
        </Button>
        {favoriteCount > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={onUnfavorite}
            className="h-7 gap-1.5 text-xs"
          >
            <HeartOff className="h-3.5 w-3.5" />
            Desfavoritar {favoriteCount}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClear}
          aria-label="Limpar seleção"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

function ViewModeToggle({
  value,
  onChange,
  enableHeatmap = true,
}: {
  value: ViewMode
  onChange: (mode: ViewMode) => void
  enableHeatmap?: boolean
}) {
  return (
    <div className="inline-flex items-center rounded-md border border-border/70 bg-background/60 p-0.5">
      <ViewButton
        active={value === "list"}
        onClick={() => onChange("list")}
        ariaLabel="Visualizar em lista"
        icon={<List className="h-3.5 w-3.5" />}
        label="Lista"
      />
      <ViewButton
        active={value === "cards"}
        onClick={() => onChange("cards")}
        ariaLabel="Visualizar em cards"
        icon={<LayoutGrid className="h-3.5 w-3.5" />}
        label="Cards"
      />
      {enableHeatmap && (
        <ViewButton
          active={value === "heatmap"}
          onClick={() => onChange("heatmap")}
          ariaLabel="Visualizar em heatmap"
          icon={<Rows3 className="h-3.5 w-3.5" />}
          label="Heatmap"
        />
      )}
    </div>
  )
}

function ViewButton({
  active,
  onClick,
  ariaLabel,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  ariaLabel: string
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
        active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon}
      {label}
    </button>
  )
}

function EmptyState({ searchQuery }: { searchQuery?: string }) {
  const searchedTitle = searchQuery?.trim()

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-border/70 bg-card/80 px-4 py-16 text-center text-sm text-muted-foreground shadow-sm">
      <div>
        <p className="font-medium text-foreground">Nenhuma obra encontrada</p>
        {searchedTitle ? (
          <p className="mt-1">
            Não há nenhum título cadastrado para &quot;{searchedTitle}&quot;.
          </p>
        ) : (
          <p className="mt-1">Ajuste os filtros ou adicione uma nova obra.</p>
        )}
      </div>
      {searchedTitle && (
        <Button asChild size="sm">
          <Link href={`/titles/new?title=${encodeURIComponent(searchedTitle)}`}>
            <Plus className="h-4 w-4" />
            Adicionar &quot;{searchedTitle}&quot;
          </Link>
        </Button>
      )}
    </div>
  )
}

function pickPrimaryCover(covers: WorkCover[] | undefined): string | null {
  if (!covers || covers.length === 0) return null
  const primary = covers.find((c) => c.is_primary)
  return (primary ?? covers[0])?.url ?? null
}

function WorkCardsView({
  works,
  scoreThresholds,
  selectedIds,
  onToggleSelect,
  enableCompare = true,
}: {
  works: WorkWithRelations[]
  scoreThresholds: ScoreColorThresholds | null
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  enableCompare?: boolean
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {works.map((work) => {
        const slug = titleToSlug(work.title)
        const coverUrl = pickPrimaryCover(work.work_covers)
        const finalScore = work.calculated_scores?.final_score ?? null
        const isSelected = selectedIds.has(work.id)

        return (
          <div key={work.id} className="group relative">
            {enableCompare && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onToggleSelect(work.id)
                }}
                aria-label={isSelected ? "Remover da comparação" : "Adicionar à comparação"}
                className={cn(
                  "absolute left-1.5 top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-sm border bg-card/90 backdrop-blur transition-opacity",
                  isSelected ? "opacity-100 border-primary bg-primary text-primary-foreground" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 border-border/80"
                )}
              >
                {isSelected && (
                  <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none">
                    <path
                      d="M3.5 8.5l3 3 6-7"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
            )}

            <Link
              href={`/titles/${slug}`}
              className="flex flex-col gap-2 text-left transition-transform hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:outline-none"
            >
              <div
                className={cn(
                  "relative aspect-[2/3] overflow-hidden rounded-lg border bg-muted/40 shadow-sm shadow-black/10 transition-shadow group-hover:border-primary/40 group-hover:shadow-md group-hover:shadow-primary/15",
                  isSelected ? "border-primary/70 ring-2 ring-primary/30" : "border-border/65"
                )}
              >
                {coverUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={getCoverImageSrc(coverUrl)}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="size-7 opacity-40" />
                  </div>
                )}
                {finalScore != null && (
                  <div className="absolute right-1.5 top-1.5">
                    <ScoreBadge score={finalScore} size="sm" thresholds={scoreThresholds} />
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 flex items-end gap-1 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-1.5">
                  <PublicationStatusBadge statusId={work.publication_status_id} />
                  <PersonalStatusBadge statusId={work.personal_status_id} />
                </div>
              </div>
              <div className="px-0.5">
                <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground group-hover:text-primary">
                  {work.title}
                </p>
                {(work.chapters_read != null || work.total_chapters != null) && (
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                    Caps {work.chapters_read ?? "?"}/{work.total_chapters ?? "?"}
                  </p>
                )}
              </div>
            </Link>
          </div>
        )
      })}
    </div>
  )
}

function WorkListView({
  works,
  searchParams,
  router,
  scoreThresholds,
  selectedIds,
  onToggleSelect,
  namespace = "titles",
  basePath = "/titles",
  enableCompare = true,
  enableSelectAll = false,
  allSelected = false,
  someSelected = false,
  onSelectAll,
  onClearAll,
}: {
  works: WorkWithRelations[]
  searchParams: ReturnType<typeof useSearchParams>
  router: ReturnType<typeof useRouter>
  scoreThresholds: ScoreColorThresholds | null
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  namespace?: WorkColumnNamespace
  enableCompare?: boolean
  basePath?: string
  enableSelectAll?: boolean
  allSelected?: boolean
  someSelected?: boolean
  onSelectAll?: () => void
  onClearAll?: () => void
}) {
  const columnConfig = useSyncExternalStore(
    (onChange) => subscribeWorkColumnConfig(onChange, namespace),
    () => readWorkColumnConfig(namespace),
    () => getDefaultWorkColumnConfig(namespace)
  )
  const configuredColumns = getConfiguredWorkColumns(columnConfig).filter(
    (col) => enableCompare || col.key !== "select"
  )

  const [activeSortField, activeSortDirection = "desc"] = (
    searchParams.get("sort") ?? "final_score:desc"
  ).split(":")

  const sortableColumns: Record<string, { field: string; label: string }> = {
    title: { field: "title", label: "Título" },
    publication_status: { field: "publication_status", label: "Publicação" },
    personal_status: { field: "personal_status", label: "Status pessoal" },
    chapters_total: { field: "chapters_total", label: "Capítulos totais" },
    chapters_read: { field: "chapters_read", label: "Capítulos lidos" },
    year: { field: "year", label: "Ano" },
    synopsis_q: { field: "synopsis_q", label: "Sinopse" },
    calc_score: { field: "calc_score", label: "Nota.IA" },
    predicted_score: { field: "predicted_score", label: "Nota.Pr" },
    final_score: { field: "final_score", label: "Nota.Final" },
    platform_avg: { field: "platform_avg", label: "Nota.M" },
    total_votes: { field: "total_votes", label: "Votos" },
    alignment_score: { field: "alignment_score", label: "IA Re-rank" },
    ai_status: { field: "ai_eval_status", label: "Status IA" },
    updated_at: { field: "updated_at", label: "Atualizado" },
    last_read_at: { field: "last_read_at", label: "Última leitura" },
    ...Object.fromEntries(
      CRITERION_SLUGS.map((slug) => [
        `crit_${slug}`,
        {
          field: `crit_${slug}`,
          label: CRITERIA_INFO[slug]?.emoji ?? slug,
        },
      ])
    ),
  }

  const updateSort = (field: string) => {
    const params = new URLSearchParams(window.location.search)
    const isActive = activeSortField === field
    const nextDirection = isActive && activeSortDirection !== "asc" ? "asc" : "desc"
    params.set("sort", `${field}:${nextDirection}`)
    params.delete("page")
    router.push(`${basePath}?${params.toString()}`)
  }

  const columnRenderers: Record<string, (work: WorkWithRelations) => ReactNode> = {
    select: (work) => (
      <Checkbox
        checked={selectedIds.has(work.id)}
        onCheckedChange={() => onToggleSelect(work.id)}
        aria-label={`Selecionar ${work.title}`}
        onClick={(e) => e.stopPropagation()}
      />
    ),
    title: (work) => (
      <span onClick={(e) => e.stopPropagation()} className="block max-w-[420px]">
        <WorkTitleLink
          title={work.title}
          workId={work.id}
          className="text-sm font-semibold leading-snug text-foreground line-clamp-2 hover:underline"
        />
      </span>
    ),
    publication_status: (work) => <PublicationStatusBadge statusId={work.publication_status_id} compact />,
    personal_status: (work) => <PersonalStatusBadge statusId={work.personal_status_id} />,
    chapters_total: (work) =>
      work.total_chapters != null ? (
        <span className="text-sm font-mono tabular-nums">{work.total_chapters}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    chapters_read: (work) =>
      work.chapters_read != null ? (
        <span className="text-sm font-mono tabular-nums">{work.chapters_read}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    year: (work) => {
      const year = (work as { year?: number | null }).year
      return year != null ? (
        <span className="text-sm font-mono tabular-nums">{year}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
    synopsis_q: (work) => {
      const sq = (work as { synopsis_quality?: string | null }).synopsis_quality
      return sq ? (
        <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 text-xs font-semibold text-rose-700">
          {sq}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
    calc_score: (work) => (
      <ScoreBadge
        score={work.calculated_scores?.calc_score ?? null}
        size="sm"
        thresholds={scoreThresholds}
      />
    ),
    predicted_score: (work) => (
      <ScoreBadge
        score={work.calculated_scores?.predicted_score ?? null}
        size="sm"
        showStub={work.calculated_scores?.predicted_is_stub ?? false}
        thresholds={scoreThresholds}
      />
    ),
    final_score: (work) => (
      <ScoreBadge
        score={work.calculated_scores?.final_score ?? null}
        size="sm"
        thresholds={scoreThresholds}
      />
    ),
    platform_avg: (work) => {
      const v = work.calculated_scores?.platform_avg
      return v != null ? (
        <span className="font-mono text-sm">{Number(v).toFixed(2)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
    total_votes: (work) => {
      const v = work.calculated_scores?.total_votes ?? 0
      return v > 0 ? (
        <span className="font-mono text-xs tabular-nums">{formatVotes(v)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
    alignment_score: (work) => (
      <AlignmentScoreCell
        score={work.calculated_scores?.alignment_score ?? null}
        justification={work.calculated_scores?.alignment_justification ?? null}
      />
    ),
    ai_status: (work) => <AiStatusBadge status={work.ai_eval_status} />,
    updated_at: (work) => {
      if (!work.updated_at) return <span className="text-muted-foreground">—</span>
      const d = new Date(work.updated_at)
      if (Number.isNaN(d.getTime())) return <span className="text-muted-foreground">—</span>
      return (
        <span
          className="text-xs tabular-nums text-muted-foreground"
          title={formatFullDateTime(d)}
        >
          {formatRelativeDate(d)}
        </span>
      )
    },
    last_read_at: (work) => {
      if (!work.last_read_at) return <span className="text-muted-foreground">—</span>
      const d = new Date(`${work.last_read_at}T00:00:00`)
      if (Number.isNaN(d.getTime())) return <span className="text-muted-foreground">—</span>
      return (
        <span
          className="text-xs tabular-nums text-muted-foreground"
          title={d.toLocaleDateString("pt-BR")}
        >
          {formatRelativeDate(d)}
        </span>
      )
    },
    actions: (work) => {
      const slug = titleToSlug(work.title)
      return (
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => e.stopPropagation()}
                  aria-label="Gerenciar obra"
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top">Gerenciar</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link href={`/titles/${slug}`} onClick={(e) => e.stopPropagation()}>
                <Eye className="h-4 w-4 mr-2" />
                Ver detalhes
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href={`/titles/${slug}`}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Abrir em nova aba
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/titles/${work.id}/edit`} onClick={(e) => e.stopPropagation()}>
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </Link>
            </DropdownMenuItem>
            {work.is_favorite && (
              <DropdownMenuItem
                onClick={async (e) => {
                  e.stopPropagation()
                  const result = await toggleFavorite(work.id, false)
                  if (result.error) {
                    toast.error("Erro ao desfavoritar")
                  } else {
                    toast.success("Obra desfavoritada")
                    router.refresh()
                  }
                }}
              >
                <HeartOff className="h-4 w-4 mr-2" />
                Desfavoritar
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={async (e) => {
                e.stopPropagation()
                const action = work.is_archived ? unarchiveWork : archiveWork
                const result = await action(work.id)
                if (result.error) {
                  toast.error("Erro ao alterar status da obra")
                } else {
                  toast.success(work.is_archived ? "Obra desarquivada" : "Obra arquivada")
                  router.refresh()
                }
              }}
            >
              {work.is_archived ? (
                <><ArchiveRestore className="h-4 w-4 mr-2" />Desarquivar</>
              ) : (
                <><Archive className="h-4 w-4 mr-2" />Arquivar</>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  }

  const columns: ColumnDef<WorkWithRelations>[] = configuredColumns.map((col) => {
    const renderer = columnRenderers[col.key] ?? makeCriterionRenderer(col.key)
    const defaultSize = DEFAULT_COLUMN_WIDTHS[col.key] ?? (col.key.startsWith("crit_") ? 48 : 100)
    return {
      id: col.key,
      accessorKey: col.key === "title" ? "title" : undefined,
      header: col.label,
      cell: ({ row }) => renderer(row.original),
      size: columnConfig.widths?.[col.key] ?? defaultSize,
      minSize: 40,
      maxSize: 800,
      enableResizing: !["select", "actions"].includes(col.key),
    }
  })

  const persistColumnSizing = useCallback(
    (sizing: ColumnSizingState) => {
      const merged = { ...(columnConfig.widths ?? {}), ...sizing }
      writeWorkColumnConfig(
        normalizeWorkColumnConfig({ ...columnConfig, widths: merged }),
        namespace
      )
    },
    [columnConfig, namespace]
  )

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: works,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: Math.ceil(works.length / 50),
    enableColumnResizing: true,
    columnResizeMode: "onChange",
    onColumnSizingChange: (updater) => {
      const next = typeof updater === "function"
        ? updater(table.getState().columnSizing)
        : updater
      persistColumnSizing(next)
    },
  })

  const tableWrapperRef = useRef<HTMLDivElement | null>(null)
  const [tableContainerWidth, setTableContainerWidth] = useState(0)

  useEffect(() => {
    const el = tableWrapperRef.current
    if (!el) return
    const update = () => setTableContainerWidth(el.clientWidth)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const totalColumnSize = table.getTotalSize()
  const headerSizes = table.getHeaderGroups()[0]?.headers ?? []
  const fixedColumnsSize = headerSizes
    .filter((h) => h.column.id.startsWith("crit_"))
    .reduce((sum, h) => sum + h.getSize(), 0)
  const expandableSize = totalColumnSize - fixedColumnsSize
  const expandableTarget = Math.max(expandableSize, tableContainerWidth - fixedColumnsSize)
  const expandableScale = expandableSize > 0 ? expandableTarget / expandableSize : 1
  const tableWidth = expandableSize * expandableScale + fixedColumnsSize
  const scaledColumnWidth = (id: string, size: number) =>
    id.startsWith("crit_") ? size : Math.round(size * expandableScale)

  const numericCenterClass = "text-center"
  const columnsByKey = useMemo(
    () => new Map(configuredColumns.map((c) => [c.key, c])),
    [configuredColumns]
  )
  const renderHeaderContent = (columnId: string, fallback: ReactNode) => {
    if (columnId === "select" && enableSelectAll) {
      return (
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={(value) => {
            if (value) onSelectAll?.()
            else onClearAll?.()
          }}
          aria-label="Selecionar todas as obras visíveis"
        />
      )
    }
    const col = columnsByKey.get(columnId)
    const sortable = sortableColumns[columnId]

    const slug = columnId.startsWith("crit_") ? columnId.slice(5) : null
    const criterion = slug ? CRITERIA_INFO[slug] : null
    const fullName = criterion?.name ?? col?.configLabel ?? null
    const description = criterion?.description ?? null
    const displayLabel = col?.label ?? sortable?.label ?? ""

    if (!sortable) return fallback

    const isActive = activeSortField === sortable.field
    const isAsc = activeSortDirection === "asc"

    const button = (
      <button
        type="button"
        onClick={() => updateSort(sortable.field)}
        className={cn(
          "inline-flex items-center gap-0.5 rounded-md px-1 py-1 transition-colors hover:bg-background hover:text-foreground",
          isActive && "text-foreground"
        )}
        aria-label={`Ordenar por ${fullName ?? sortable.label}`}
      >
        <span>{displayLabel}</span>
        {isActive ? (
          isAsc ? <ChevronUp className="h-3 w-3 shrink-0" /> : <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-40 group-hover/header:inline-block" />
        )}
      </button>
    )

    const showFullName = fullName && fullName !== displayLabel
    if (!showFullName && !description) return button

    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-left">
          {showFullName && <span className="font-semibold">{fullName}</span>}
          {description && (
            <span className={cn("block text-xs text-muted-foreground", showFullName && "mt-1")}>
              {description}
            </span>
          )}
        </TooltipContent>
      </Tooltip>
    )
  }

  const isCenterAligned = (key: string) =>
    key === "select" ||
    key === "chapters_total" ||
    key === "chapters_read" ||
    key === "year" ||
    key === "synopsis_q" ||
    key === "calc_score" ||
    key === "predicted_score" ||
    key === "final_score" ||
    key === "platform_avg" ||
    key === "total_votes" ||
    key === "alignment_score" ||
    key === "ai_status" ||
    key === "updated_at" ||
    key === "last_read_at" ||
    key === "actions" ||
    key.startsWith("crit_")

  return (
    <TooltipProvider delayDuration={150}>
      {/* Desktop table */}
      <div ref={tableWrapperRef} className="hidden overflow-x-auto rounded-lg border border-border/70 bg-card/80 shadow-sm shadow-black/5 backdrop-blur md:block">
        <Table style={{ width: tableWidth, tableLayout: "fixed" }}>
          <TableHeader className="bg-muted/60">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    style={{ width: scaledColumnWidth(header.column.id, header.getSize()) }}
                    className={cn(
                      "group/header relative h-11 whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                      isCenterAligned(header.column.id) && numericCenterClass,
                      header.column.id.startsWith("crit_") && "px-1"
                    )}
                  >
                    {renderHeaderContent(
                      header.column.id,
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                    {header.column.getCanResize() && (
                      <div
                        onDoubleClick={() => header.column.resetSize()}
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        onClick={(e) => e.stopPropagation()}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Redimensionar coluna ${header.column.id}`}
                        className="group/resize absolute right-0 top-0 z-20 flex h-full w-3 cursor-col-resize touch-none select-none items-center justify-center"
                      >
                        <span
                          className={cn(
                            "block h-4 w-px bg-border transition-colors group-hover/resize:bg-primary",
                            header.column.getIsResizing() && "bg-primary"
                          )}
                        />
                      </div>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => {
              const isSelected = selectedIds.has(row.original.id)
              return (
                <TableRow
                  key={row.id}
                  data-selected={isSelected ? "true" : undefined}
                  className={cn(
                    "cursor-pointer border-b transition-colors odd:bg-background even:bg-muted/20 hover:bg-primary/5",
                    isSelected && "bg-primary/10 hover:bg-primary/10"
                  )}
                  onClick={() => router.push(`/titles/${titleToSlug(row.original.title)}`)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      style={{ width: scaledColumnWidth(cell.column.id, cell.column.getSize()) }}
                      className={cn(
                        "h-14 py-3 align-middle",
                        cell.column.id === "title" && "whitespace-normal",
                        cell.column.id.startsWith("crit_") && "px-1",
                        isCenterAligned(cell.column.id) && numericCenterClass
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile compact cards */}
      <div className="space-y-3 md:hidden">
        {enableSelectAll && works.length > 0 && (
          <button
            type="button"
            onClick={() => (allSelected ? onClearAll?.() : onSelectAll?.())}
            className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-card/80 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card hover:text-foreground"
          >
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              aria-hidden
              tabIndex={-1}
              className="pointer-events-none"
            />
            {allSelected ? "Limpar seleção" : "Selecionar todos"}
          </button>
        )}
        {works.map((work) => {
          const isSelected = selectedIds.has(work.id)
          return (
            <div
              key={work.id}
              className={cn(
                "cursor-pointer space-y-3 rounded-lg border bg-card/80 p-4 shadow-sm shadow-black/5 transition-all hover:bg-card",
                isSelected ? "border-primary/60 bg-primary/5" : "border-border/70 hover:border-primary/30"
              )}
              onClick={() => router.push(`/titles/${titleToSlug(work.title)}`)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 min-w-0 flex-1">
                  {enableCompare && (
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => onToggleSelect(work.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Selecionar ${work.title}`}
                      className="mt-0.5"
                    />
                  )}
                  <span onClick={(e) => e.stopPropagation()} className="min-w-0 flex-1">
                    <WorkTitleLink
                      title={work.title}
                      workId={work.id}
                      className="font-medium text-sm line-clamp-2 hover:underline"
                    />
                  </span>
                </div>
                <ScoreBadge
                  score={work.calculated_scores?.final_score ?? null}
                  size="sm"
                  thresholds={scoreThresholds}
                />
              </div>
              <div className="flex flex-wrap gap-1">
                <PublicationStatusBadge statusId={work.publication_status_id} />
                <PersonalStatusBadge statusId={work.personal_status_id} />
                <AiStatusBadge status={work.ai_eval_status} />
              </div>
              {(work.chapters_read != null || work.total_chapters != null) && (
                <p className="text-xs text-muted-foreground font-mono">
                  Caps: {work.chapters_read ?? "?"}/{work.total_chapters ?? "?"}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

function renderCriterionCell(slug: string, work: WorkWithRelations): ReactNode {
  const score = scoreFor(work, slug)
  if (score == null) return <span className="text-muted-foreground">—</span>
  return (
    <span
      className={cn(
        "inline-grid h-8 w-12 place-items-center rounded-md font-mono text-xs font-bold",
        getCriterionColorClass(score, slug)
      )}
    >
      {score.toFixed(1)}
    </span>
  )
}

function makeCriterionRenderer(columnKey: string): (work: WorkWithRelations) => ReactNode {
  if (!columnKey.startsWith("crit_")) return renderEmpty
  const slug = columnKey.slice("crit_".length)
  return function renderCriterion(work: WorkWithRelations): ReactNode {
    return renderCriterionCell(slug, work)
  }
}

function renderEmpty(): ReactNode {
  return null
}

function formatVotes(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

function Pagination({
  page,
  totalPages,
  router,
  basePath = "/titles",
}: {
  page: number
  totalPages: number
  router: ReturnType<typeof useRouter>
  basePath?: string
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card/70 p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">
        Página {page} de {totalPages}
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => {
            const params = new URLSearchParams(window.location.search)
            params.set("page", String(page - 1))
            router.push(`${basePath}?${params.toString()}`)
          }}
        >
          Anterior
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => {
            const params = new URLSearchParams(window.location.search)
            params.set("page", String(page + 1))
            router.push(`${basePath}?${params.toString()}`)
          }}
        >
          Próxima
        </Button>
      </div>
    </div>
  )
}

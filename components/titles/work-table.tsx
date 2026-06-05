"use client"

import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
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
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Heart,
  HeartOff,
  ImageOff,
  LayoutGrid,
  List,
  Minus,
  Pencil,
  Plus,
  Rows3,
  Settings2,
  Sparkles,
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
import type { CategoryScore, WorkWithRelations } from "@/types/domain"
import { CRITERION_SLUGS } from "@/types/domain"
import { cn, titleToSlug, readingProgressPercent } from "@/lib/utils"
import { pickPrimaryCover } from "@/lib/covers"
import { CoverImage } from "@/components/ui/cover-image"
import { ScoreBadge, getCriterionColorClass, type ColumnThresholds, type ScoreColorThresholds } from "@/components/ui/score-badge"
import {
  AiStatusBadge,
  PersonalStatusBadge,
  PublicationStatusBadge,
} from "@/components/ui/status-badge"
import {
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
import { rerankSingleWorkAction } from "@/server/actions/recommendations"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { FavoriteCell } from "@/components/titles/favorite-cell"
import { AlignmentCell, AlignmentScoreCell, DecisionCell } from "@/components/ranking/ranking-cells"
import { computeDecisionScore } from "@/lib/calculations/decision"
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
  scoreThresholds?: ColumnThresholds | null
  selectedCompareIds?: string[]
  namespace?: WorkColumnNamespace
  basePath?: string
  enableCompare?: boolean
  enableHeatmap?: boolean
  enableSelectAll?: boolean
  /** Repassado ao drawer de comparação pra liberar o "Desempatar com IA" (Pago). */
  isPaid?: boolean
}

function scoreFor(work: WorkWithRelations, slug: string): number | null {
  const cs = (work.category_scores ?? []).find((c: CategoryScore) => c.criterion_slug === slug)
  return cs?.score != null ? Number(cs.score) : null
}

/** Acha o ancestral rolável (overflow-y auto/scroll). No layout do app o scroller
 *  é o <main>, NÃO o window — por isso restaurar window.scrollY não funcionava. */
function findScrollContainer(start: HTMLElement | null): HTMLElement | null {
  let node: HTMLElement | null = start
  while (node && node !== document.body) {
    const overflowY = window.getComputedStyle(node).overflowY
    if (overflowY === "auto" || overflowY === "scroll") return node
    node = node.parentElement
  }
  return null
}

/**
 * Roda `mutate` (que dispara um re-render via setState) preservando a posição de
 * scroll do container rolável. `anchor` é qualquer elemento dentro do scroller.
 * Reaplica o scrollTop nos 2 próximos frames (cobre o commit do React + o settle
 * de layout); também trava o scroll síncrono se o browser mexer antes do rAF.
 */
function preserveScroll(anchor: HTMLElement | null, mutate: () => void) {
  const container = findScrollContainer(anchor)
  if (!container) {
    mutate()
    return
  }
  const top = container.scrollTop
  mutate()
  const restore = () => {
    if (container.scrollTop !== top) container.scrollTop = top
  }
  restore()
  requestAnimationFrame(() => {
    restore()
    requestAnimationFrame(restore)
  })
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
  isPaid = true,
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
  const rootRef = useRef<HTMLDivElement>(null)

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
      preserveScroll(rootRef.current, () => {
        if (selectedSet.has(id)) {
          updateCompareIds(compareIds.filter((x) => x !== id))
        } else {
          updateCompareIds([...compareIds, id])
        }
      })
    },
    [selectedSet, compareIds, updateCompareIds]
  )

  const clearCompare = useCallback(() => {
    preserveScroll(rootRef.current, () => {
      updateCompareIds([])
      setDrawerOpen(false)
    })
  }, [updateCompareIds])

  const allVisibleIds = useMemo(() => works.map((w) => w.id), [works])
  const allSelected =
    allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedSet.has(id))
  const someSelected = !allSelected && selectedSet.size > 0
  const selectAllVisible = useCallback(() => {
    preserveScroll(rootRef.current, () => updateCompareIds(allVisibleIds))
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
    <div className="space-y-3" ref={rootRef}>
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
          enableSelectAll={enableSelectAll}
          allSelected={allSelected}
          someSelected={someSelected}
          onSelectAll={selectAllVisible}
          onClearAll={clearCompare}
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
            ids={(() => {
              // Reordena pra refletir a ordem visível da tabela atual, não a
              // ordem cronológica de cliques. IDs fora do pool visível (caso o
              // usuário tenha filtrado depois de selecionar) vão pro fim.
              const indexById = new Map(works.map((w, i) => [w.id, i]))
              return [...compareIds].sort(
                (a, b) =>
                  (indexById.get(a) ?? Number.MAX_SAFE_INTEGER) -
                  (indexById.get(b) ?? Number.MAX_SAFE_INTEGER)
              )
            })()}
            onClear={clearCompare}
            onRemoveId={(id) =>
              updateCompareIds(compareIds.filter((x) => x !== id))
            }
            scoreThresholds={scoreThresholds}
            isPaid={isPaid}
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

function WorkCardsView({
  works,
  scoreThresholds,
  selectedIds,
  onToggleSelect,
  enableCompare = true,
}: {
  works: WorkWithRelations[]
  scoreThresholds: ColumnThresholds | null
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
                  <CoverImage
                    url={coverUrl}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="size-7 opacity-40" />
                  </div>
                )}
                {finalScore != null && (
                  <div className="absolute right-1.5 top-1.5">
                    <ScoreBadge score={finalScore} size="sm" thresholds={scoreThresholds?.final} />
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
                    {(() => {
                      const pct = readingProgressPercent(work.chapters_read, work.total_chapters)
                      const base = `Caps ${work.chapters_read ?? "?"}/${work.total_chapters ?? "?"}`
                      return pct != null ? `${base} · ${pct}%` : base
                    })()}
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
  scoreThresholds: ColumnThresholds | null
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
    decision: { field: "decision", label: "Prioridade" },
    expected_score: { field: "expected_score", label: "Nota Prevista" },
    expected_baseline: { field: "expected_baseline", label: "Perfil (Stage 1)" },
    expected_quality_adj: { field: "expected_quality_adj", label: "Δ Qualidade" },
    personal_fit: { field: "personal_fit", label: "Alinhamento" },
    calc_score: { field: "calc_score", label: "[Legado] Nota.IA" },
    predicted_score: { field: "predicted_score", label: "[Legado] Nota.Pr" },
    final_score: { field: "final_score", label: "[Legado] Nota.Final" },
    platform_avg: { field: "platform_avg", label: "Nota.M" },
    total_votes: { field: "total_votes", label: "Votos" },
    alignment_score: { field: "alignment_score", label: "[Legado] IA Re-rank" },
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
      <div
        onClick={(e) => {
          e.stopPropagation()
          onToggleSelect(work.id)
        }}
        className="flex h-full w-full cursor-pointer items-center justify-center"
      >
        <Checkbox
          checked={selectedIds.has(work.id)}
          onCheckedChange={() => onToggleSelect(work.id)}
          aria-label={`Selecionar ${work.title}`}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    ),
    fav: (work) => (
      <FavoriteCell
        workId={work.id}
        workTitle={work.title}
        isFavorite={Boolean(work.is_favorite)}
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
    personal_status: (work) => <PersonalStatusBadge statusId={work.personal_status_id} iconOnly />,
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
    chapters_progress: (work) => {
      const pct = readingProgressPercent(work.chapters_read, work.total_chapters)
      return pct != null ? (
        <span className="text-sm font-mono tabular-nums">{pct}%</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
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
        thresholds={scoreThresholds?.calc}
      />
    ),
    predicted_score: (work) => (
      <ScoreBadge
        score={work.calculated_scores?.predicted_score ?? null}
        size="sm"
        showStub={work.calculated_scores?.predicted_is_stub ?? false}
        thresholds={scoreThresholds?.predicted}
      />
    ),
    final_score: (work) => (
      <ScoreBadge
        score={work.calculated_scores?.final_score ?? null}
        size="sm"
        thresholds={scoreThresholds?.final}
      />
    ),
    decision: (work) => {
      const cs = work.calculated_scores
      const score = computeDecisionScore({
        expected: cs?.expected_score ?? null,
        alignment: cs?.alignment_score ?? null,
        confidence: (cs?.alignment_payload as { confidence?: number } | null)?.confidence ?? null,
      })
      return (
        <DecisionCell
          score={score}
          affinity={null}
          expected={cs?.expected_score ?? null}
          fitPercentile={
            cs?.personal_fit_percentile ?? (cs?.personal_fit != null ? cs.personal_fit * 100 : null)
          }
          alignment={cs?.alignment_score ?? null}
        />
      )
    },
    expected_score: (work) => (
      <ScoreBadge
        score={work.calculated_scores?.expected_score ?? null}
        size="sm"
        showStub={work.calculated_scores?.expected_is_stub ?? false}
        thresholds={scoreThresholds?.final}
      />
    ),
    expected_baseline: (work) => {
      const v = work.calculated_scores?.expected_baseline
      return v != null ? (
        <span className="font-mono text-sm text-muted-foreground">{Number(v).toFixed(2)}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
    expected_quality_adj: (work) => {
      const v = work.calculated_scores?.expected_quality_adj
      if (v == null) return <span className="text-muted-foreground">—</span>
      const num = Number(v)
      const sign = num >= 0 ? "+" : ""
      const cls = num >= 0 ? "text-emerald-500" : "text-rose-500"
      return <span className={`font-mono text-sm ${cls}`}>{sign}{num.toFixed(2)}</span>
    },
    personal_fit: (work) => (
      <AlignmentCell
        value={work.calculated_scores?.personal_fit ?? null}
        percentile={work.calculated_scores?.personal_fit_percentile ?? null}
        showBar={false}
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
        workId={work.id}
        payload={work.calculated_scores?.alignment_payload ?? null}
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
              <Link href={`/titles/${slug}/edit`} onClick={(e) => e.stopPropagation()}>
                <Pencil className="h-4 w-4 mr-2" />
                Editar
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={async (e) => {
                e.stopPropagation()
                const next = !work.is_favorite
                const result = await toggleFavorite(work.id, next)
                if (result.error) {
                  toast.error("Erro ao alterar favorito")
                } else {
                  toast.success(next ? "Obra favoritada" : "Obra desfavoritada")
                  router.refresh()
                }
              }}
            >
              {work.is_favorite ? (
                <><HeartOff className="h-4 w-4 mr-2" />Desfavoritar</>
              ) : (
                <><Heart className="h-4 w-4 mr-2" />Favoritar</>
              )}
            </DropdownMenuItem>
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
            <DropdownMenuItem
              onClick={async (e) => {
                e.stopPropagation()
                const result = await rerankSingleWorkAction(work.id)
                if (result.error || !result.data) {
                  toast.error(result.error ?? "Erro ao avaliar IA Rk")
                } else {
                  toast.success(`IA Rk: ${Math.round(result.data.alignmentScore)}`)
                  router.refresh()
                }
              }}
            >
              <Sparkles className="h-4 w-4 mr-2" />
              Avaliar IA Rk
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    },
  }

  const columns: ColumnDef<WorkWithRelations>[] = configuredColumns.map((col) => {
    const renderer = columnRenderers[col.key] ?? makeCriterionRenderer(col.key, scoreThresholds?.criteria)
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

  // CSS-based fill: tabela = 100% do container, sem overflow no wrapper, pra
  // manter o sticky header funcionando. Colunas encolhem proporcionalmente em
  // telas estreitas (sem scroll horizontal).
  const totalColumnSize = table.getTotalSize()
  const headerSizes = table.getHeaderGroups()[0]?.headers ?? []
  const columnWidthPercent = (size: number): string =>
    `${((size / totalColumnSize) * 100).toFixed(4)}%`

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
    const description = criterion?.description ?? col?.description ?? null
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
    key === "fav" ||
    key === "chapters_total" ||
    key === "chapters_read" ||
    key === "chapters_progress" ||
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
      <div className="hidden w-full rounded-lg border border-border/70 bg-card/80 shadow-sm shadow-black/5 backdrop-blur md:block">
        <table
          className="caption-bottom text-sm"
          style={{ width: "100%", tableLayout: "fixed" }}
        >
          <colgroup>
            {headerSizes.map((h) => (
              <col key={h.id} style={{ width: columnWidthPercent(h.getSize()) }} />
            ))}
          </colgroup>
          <TableHeader className="sticky -top-5 z-30 md:-top-7 [&_th]:bg-muted [&_tr:first-child_th:first-child]:rounded-tl-lg [&_tr:first-child_th:last-child]:rounded-tr-lg">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="border-b hover:bg-transparent">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "group/header relative h-11 overflow-hidden whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground",
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
                      className={cn(
                        "h-14 overflow-hidden py-3 align-middle",
                        cell.column.id === "title" && "whitespace-normal",
                        cell.column.id.startsWith("crit_") && "px-1",
                        isCenterAligned(cell.column.id) && numericCenterClass
                      )}
                      onClick={cell.column.id === "select" || cell.column.id === "fav" ? (e) => e.stopPropagation() : undefined}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
          </TableBody>
        </table>
      </div>

      {/* Mobile compact cards */}
      <div className="space-y-3 md:hidden">
        {enableSelectAll && works.length > 0 && (
          <button
            type="button"
            onClick={() => (allSelected ? onClearAll?.() : onSelectAll?.())}
            className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-card/80 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-card hover:text-foreground"
          >
            <span
              aria-hidden
              className={cn(
                "grid size-4 shrink-0 place-content-center rounded-[4px] border border-input/90 bg-background/55 shadow-xs",
                (allSelected || someSelected) && "border-primary bg-primary text-primary-foreground"
              )}
            >
              {allSelected ? (
                <Check className="size-3.5" />
              ) : someSelected ? (
                <Minus className="size-3.5" />
              ) : null}
            </span>
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
                  thresholds={scoreThresholds?.final}
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

function renderCriterionCell(
  slug: string,
  work: WorkWithRelations,
  thresholds?: ScoreColorThresholds | null,
): ReactNode {
  const score = scoreFor(work, slug)
  if (score == null) return <span className="text-muted-foreground">—</span>
  return (
    <span
      className={cn(
        "inline-grid h-8 w-12 place-items-center rounded-md font-mono text-xs font-bold",
        getCriterionColorClass(score, slug, thresholds)
      )}
    >
      {score.toFixed(1)}
    </span>
  )
}

function makeCriterionRenderer(
  columnKey: string,
  criteriaThresholds?: Record<string, ScoreColorThresholds>,
): (work: WorkWithRelations) => ReactNode {
  if (!columnKey.startsWith("crit_")) return renderEmpty
  const slug = columnKey.slice("crit_".length)
  return function renderCriterion(work: WorkWithRelations): ReactNode {
    return renderCriterionCell(slug, work, criteriaThresholds?.[slug])
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

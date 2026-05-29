"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { ChevronDown, ChevronUp, ImageOff } from "lucide-react"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { ScoreBadge, type ColumnThresholds, type ScoreColorThresholds } from "@/components/ui/score-badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Checkbox } from "@/components/ui/checkbox"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { FavoriteCell } from "@/components/titles/favorite-cell"
import { AlignmentScoreCell } from "@/components/ranking/ranking-cells"
import {
  getConfiguredWorkColumns,
  getDefaultWorkColumnConfig,
  isScoreColumn,
  readWorkColumnConfig,
  subscribeWorkColumnConfig,
  type WorkColumnDef,
  type WorkColumnGroup,
  type WorkColumnNamespace,
} from "@/components/titles/work-table-config"
import type { WorkWithRelations, WorkCover, CategoryScore } from "@/types/domain"

interface WorkHeatmapViewProps {
  works: WorkWithRelations[]
  scoreThresholds: ColumnThresholds | null
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  namespace?: WorkColumnNamespace
  basePath?: string
  enableCompare?: boolean
}

const HEATMAP_TITLE_COL_WIDTH = 280
const HEATMAP_SCORE_COL_WIDTH = 64
const HEATMAP_MIN_COL_WIDTH = 44

function heatmapStorageKey(namespace: WorkColumnNamespace) {
  return `heatmap_col_widths_${namespace}_v1`
}

function useHeatmapColumnWidths(namespace: WorkColumnNamespace) {
  const [widths, setWidths] = useState<Record<string, number>>({})

  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const stored = window.localStorage.getItem(heatmapStorageKey(namespace))
      if (!stored) return
      const parsed = JSON.parse(stored) as Record<string, number>
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWidths(parsed)
    } catch {
      // ignore
    }
  }, [namespace])

  const setWidth = (key: string, width: number) => {
    setWidths((prev) => {
      const next = { ...prev, [key]: Math.max(HEATMAP_MIN_COL_WIDTH, Math.round(width)) }
      try {
        window.localStorage.setItem(heatmapStorageKey(namespace), JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  return { widths, setWidth }
}

interface ResizeHandleProps {
  columnKey: string
  onResize: (key: string, width: number) => void
  startWidth: number
}

function ResizeHandle({ columnKey, onResize, startWidth }: ResizeHandleProps) {
  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const initialWidth = startWidth
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const handleMove = (ev: MouseEvent) => {
      ev.preventDefault()
      const delta = ev.clientX - startX
      onResize(columnKey, initialWidth + delta)
    }
    const handleUp = () => {
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      document.removeEventListener("mousemove", handleMove)
      document.removeEventListener("mouseup", handleUp)
    }
    document.addEventListener("mousemove", handleMove)
    document.addEventListener("mouseup", handleUp)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      role="separator"
      aria-orientation="vertical"
      aria-label="Redimensionar coluna"
      className="absolute top-0 right-0 h-full w-3 cursor-col-resize flex items-center justify-center group z-20"
    >
      <span className="block h-4 w-px bg-border group-hover:bg-primary group-active:bg-primary transition-colors" />
    </div>
  )
}

const NON_CRITERION_LABELS: Record<string, string> = {
  final_score: "Final",
  calc_score: "IA",
  predicted_score: "Pr",
  expected_score: "Esperada",
  expected_baseline: "Perfil",
  expected_quality_adj: "Δ Qual.",
  platform_avg: "Externa",
  total_votes: "Votos",
  alignment_score: "IA Rk.",
  synopsis_q: "Sinopse",
}

const NON_CRITERION_TOOLTIPS: Record<string, string> = {
  final_score: "Nota.Final",
  calc_score: "Nota.IA",
  predicted_score: "Nota.Pr",
  expected_score: "Nota esperada (L1 single Ridge — substitui N.IA/N.Pr/N.Final)",
  expected_baseline: "Stage 1 da decomposição — contribuição do perfil (sem qualidade)",
  expected_quality_adj: "Stage 2 da decomposição — ajuste pelas 8 dimensões de qualidade",
  platform_avg: "Média externa",
  total_votes: "Total de votos nas plataformas",
  alignment_score: "IA Re-rank — score 0-100 que ordena os resultados das ações 'Recomendar com IA'. Preenchido em batch pela run ou sob demanda pelo botão Rankear.",
  synopsis_q: "Interesse na sinopse (♥ a ♥♥♥♥) — preenchido manualmente",
}

function formatVoteCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

function pickPrimaryCover(covers: WorkCover[] | undefined): string | null {
  if (!covers || covers.length === 0) return null
  const primary = covers.find((c) => c.is_primary)
  return (primary ?? covers[0])?.url ?? null
}

function scoreFor(work: WorkWithRelations, slug: string): number | null {
  const cs = (work.category_scores ?? []).find((c: CategoryScore) => c.criterion_slug === slug)
  return cs?.score != null ? Number(cs.score) : null
}

function getCriterionColor(score: number, slug: string): string {
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

function getValueForKey(work: WorkWithRelations, key: string): number | null {
  if (key === "final_score") return work.calculated_scores?.final_score ?? null
  if (key === "calc_score") return work.calculated_scores?.calc_score ?? null
  if (key === "predicted_score") return work.calculated_scores?.predicted_score ?? null
  if (key === "expected_score") {
    const v = work.calculated_scores?.expected_score
    return v == null ? null : Number(v)
  }
  if (key === "expected_baseline") {
    const v = work.calculated_scores?.expected_baseline
    return v == null ? null : Number(v)
  }
  if (key === "expected_quality_adj") {
    const v = work.calculated_scores?.expected_quality_adj
    return v == null ? null : Number(v)
  }
  if (key === "platform_avg") {
    const v = work.calculated_scores?.platform_avg
    return v == null ? null : Number(v)
  }
  if (key === "total_votes") {
    const v = work.calculated_scores?.total_votes
    // total_votes=0 é dado real ("sem votos contabilizados"), mantém o 0.
    return v == null ? null : Number(v)
  }
  if (key === "synopsis_q") {
    // String ♥..♥♥♥♥ → 1..4 pra permitir ordenação numérica.
    // Render real continua via path próprio em ScoreCell.
    const v = (work as { synopsis_quality?: string | null }).synopsis_quality?.trim()
    if (!v) return null
    const n = v.length // 1 char por coração
    return n > 0 && n <= 4 ? n : null
  }
  if (key === "alignment_score") return work.calculated_scores?.alignment_score ?? null
  if (key.startsWith("crit_")) {
    return scoreFor(work, key.slice("crit_".length))
  }
  return null
}

function getHeaderLabel(col: WorkColumnDef): string {
  if (col.key.startsWith("crit_")) {
    const slug = col.key.slice("crit_".length)
    return CRITERIA_INFO[slug]?.emoji ?? slug
  }
  return NON_CRITERION_LABELS[col.key] ?? col.label
}

function getTooltipLabel(col: WorkColumnDef): string {
  if (col.key.startsWith("crit_")) {
    const slug = col.key.slice("crit_".length)
    return CRITERIA_INFO[slug]?.name ?? slug
  }
  return NON_CRITERION_TOOLTIPS[col.key] ?? col.configLabel ?? col.label
}

export function WorkHeatmapView({
  works,
  scoreThresholds,
  selectedIds,
  onToggleSelect,
  namespace = "titles",
  enableCompare = true,
}: WorkHeatmapViewProps) {
  const columnConfig = useSyncExternalStore(
    (onChange) => subscribeWorkColumnConfig(onChange, namespace),
    () => readWorkColumnConfig(namespace),
    () => getDefaultWorkColumnConfig(namespace)
  )

  const visibleScoreColumns = useMemo(
    () => getConfiguredWorkColumns(columnConfig).filter((c) => isScoreColumn(c.key)),
    [columnConfig]
  )

  const { widths, setWidth } = useHeatmapColumnWidths(namespace)

  // CSS-based fill: tabela = 100% do container, sem overflow no wrapper, pra
  // manter o sticky header funcionando. Colunas encolhem proporcionalmente em
  // telas estreitas (sem scroll horizontal).
  const naturalTitleWidth = widths["__title__"] ?? HEATMAP_TITLE_COL_WIDTH
  const naturalScoreWidth = (key: string) => widths[key] ?? HEATMAP_SCORE_COL_WIDTH
  const naturalScoreTotal = visibleScoreColumns.reduce(
    (sum, c) => sum + naturalScoreWidth(c.key),
    0,
  )
  const naturalTotal = naturalTitleWidth + naturalScoreTotal
  const widthPercent = (px: number): string =>
    `${((px / naturalTotal) * 100).toFixed(4)}%`

  const [sortKey, setSortKey] = useState<string>("final_score")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  // If the user hides the currently-sorted column, fall back to the first visible score column.
  const effectiveSortKey = useMemo(() => {
    if (visibleScoreColumns.find((c) => c.key === sortKey)) return sortKey
    return visibleScoreColumns[0]?.key ?? "final_score"
  }, [sortKey, visibleScoreColumns])

  const sortedWorks = useMemo(() => {
    const arr = [...works]
    arr.sort((a, b) => {
      const valA = getValueForKey(a, effectiveSortKey)
      const valB = getValueForKey(b, effectiveSortKey)
      const aNum = valA == null ? Number.NEGATIVE_INFINITY : valA
      const bNum = valB == null ? Number.NEGATIVE_INFINITY : valB
      return sortDir === "desc" ? bNum - aNum : aNum - bNum
    })
    return arr
  }, [works, effectiveSortKey, sortDir])

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  // Mark column transitions between groups for visual separator
  const columnSeparators = useMemo(() => {
    const sep = new Set<string>()
    let prevGroup: WorkColumnGroup | null = null
    for (const col of visibleScoreColumns) {
      if (prevGroup && col.group !== prevGroup) sep.add(col.key)
      prevGroup = col.group
    }
    return sep
  }, [visibleScoreColumns])

  if (visibleScoreColumns.length === 0) {
    return (
      <div className="rounded-lg border border-border/70 bg-card/80 px-4 py-12 text-center text-sm text-muted-foreground">
        Nenhuma coluna de nota selecionada.
        <br />
        Use o botão <span className="font-medium text-foreground">Colunas</span> para escolher quais notas exibir.
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="rounded-lg border border-border/70 bg-card/80 shadow-sm">
        <p className="border-b bg-muted/40 px-3 py-1.5 text-[10px] text-muted-foreground">
          Heatmap ordena apenas as obras visíveis nesta página · use <span className="font-medium text-foreground">Colunas</span> para escolher as notas.
        </p>
        <table
          className="border-collapse text-sm"
          style={{ tableLayout: "fixed", width: "100%" }}
        >
          <colgroup>
            <col style={{ width: widthPercent(naturalTitleWidth) }} />
            {visibleScoreColumns.map((col) => (
              <col key={col.key} style={{ width: widthPercent(naturalScoreWidth(col.key)) }} />
            ))}
          </colgroup>
          <thead className="bg-muted/60">
            <tr>
              <th
                className="group/header relative sticky left-0 z-20 border-b border-r bg-muted/60 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                style={{ width: naturalTitleWidth }}
              >
                Obra
                <ResizeHandle
                  columnKey="__title__"
                  onResize={setWidth}
                  startWidth={naturalTitleWidth}
                />
              </th>
              {visibleScoreColumns.map((col) => {
                const hasSeparator = columnSeparators.has(col.key)
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "group/header relative overflow-hidden border-b px-1.5 py-2 text-center text-xs font-semibold text-muted-foreground",
                      hasSeparator && "border-l-2 border-l-primary/30"
                    )}
                  >
                    <SortableHeader
                      label={getHeaderLabel(col)}
                      active={effectiveSortKey === col.key}
                      asc={sortDir === "asc"}
                      onClick={() => handleSort(col.key)}
                      titleAttr={getTooltipLabel(col)}
                    />
                    <ResizeHandle
                      columnKey={col.key}
                      onResize={setWidth}
                      startWidth={naturalScoreWidth(col.key)}
                    />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sortedWorks.map((work) => {
              const cover = pickPrimaryCover(work.work_covers)
              const isSelected = selectedIds.has(work.id)
              return (
                <tr
                  key={work.id}
                  className={cn(
                    "border-b transition-colors hover:bg-primary/5",
                    isSelected && "bg-primary/5"
                  )}
                >
                  <td className="sticky left-0 z-10 border-r bg-background px-3 py-2">
                    <div className="flex items-center gap-2">
                      {enableCompare && (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => onToggleSelect(work.id)}
                          aria-label={`Selecionar ${work.title}`}
                        />
                      )}
                      {namespace !== "favorites" && (
                        <FavoriteCell
                          workId={work.id}
                          workTitle={work.title}
                          isFavorite={Boolean(work.is_favorite)}
                        />
                      )}
                      <WorkTitleLink
                        title={work.title}
                        workId={work.id}
                        className="flex items-center gap-2.5 hover:underline"
                      >
                        <div className="relative h-10 w-7 shrink-0 overflow-hidden rounded border bg-muted/40">
                          {cover ? (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={getCoverImageSrc(cover)}
                              alt=""
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                              <ImageOff className="h-3 w-3 opacity-40" />
                            </div>
                          )}
                        </div>
                        <span className="line-clamp-2 min-w-0 flex-1 text-xs font-medium text-foreground">
                          {work.title}
                        </span>
                      </WorkTitleLink>
                    </div>
                  </td>
                  {visibleScoreColumns.map((col) => {
                    const hasSeparator = columnSeparators.has(col.key)
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "overflow-hidden px-1 py-1.5 text-center",
                          hasSeparator && "border-l-2 border-l-primary/30"
                        )}
                      >
                        <ScoreCell
                          col={col}
                          work={work}
                          scoreThresholds={scoreThresholds}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  )
}

function ScoreCell({
  col,
  work,
  scoreThresholds,
}: {
  col: WorkColumnDef
  work: WorkWithRelations
  scoreThresholds: ColumnThresholds | null
}) {
  const tooltipLabel = getTooltipLabel(col)

  // synopsis_q é string (♥..♥♥♥♥), não número — render path próprio antes
  // do fluxo numérico padrão.
  if (col.key === "synopsis_q") {
    const v = (work as { synopsis_quality?: string | null }).synopsis_quality?.trim()
    if (!v) return <EmptyCell />
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center justify-center font-medium text-rose-600 dark:text-rose-300">
            {v}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {tooltipLabel}: {v}
        </TooltipContent>
      </Tooltip>
    )
  }

  const score = getValueForKey(work, col.key)

  if (score == null) return <EmptyCell />

  // Calculated/aggregated scores use ScoreBadge (with thresholds).
  if (
    col.key === "final_score" ||
    col.key === "calc_score" ||
    col.key === "predicted_score"
  ) {
    const colThresholds: ScoreColorThresholds | null = scoreThresholds
      ? col.key === "final_score"
        ? scoreThresholds.final
        : col.key === "calc_score"
          ? scoreThresholds.calc
          : scoreThresholds.predicted
      : null
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block">
            <ScoreBadge
              score={score}
              size="sm"
              thresholds={colThresholds}
              showStub={
                col.key === "predicted_score"
                  ? work.calculated_scores?.predicted_is_stub ?? false
                  : false
              }
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {tooltipLabel}: {score.toFixed(1)}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (col.key === "platform_avg") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="font-mono text-sm">{score.toFixed(2)}</span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {tooltipLabel}: {score.toFixed(2)}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (col.key === "total_votes") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="font-mono text-sm text-muted-foreground">
            {formatVoteCount(score)}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {tooltipLabel}: {score.toLocaleString("pt-BR")}
        </TooltipContent>
      </Tooltip>
    )
  }

  if (col.key === "alignment_score") {
    return (
      <AlignmentScoreCell
        score={score}
        justification={work.calculated_scores?.alignment_justification ?? null}
        payload={work.calculated_scores?.alignment_payload ?? null}
      />
    )
  }

  // Criterion / personal scores get a colored block.
  const colorSlug = col.key.startsWith("crit_") ? col.key.slice("crit_".length) : "positive"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "mx-auto inline-grid h-9 w-full min-w-0 max-w-[96px] place-items-center rounded-md font-mono text-sm font-bold",
            getCriterionColor(score, colorSlug)
          )}
        >
          {score.toFixed(1)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {tooltipLabel}: {score.toFixed(1)}
      </TooltipContent>
    </Tooltip>
  )
}

function EmptyCell() {
  return (
    <span className="mx-auto inline-flex h-9 w-full min-w-0 max-w-[96px] items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
      —
    </span>
  )
}

interface SortableHeaderProps {
  label: string
  active: boolean
  asc: boolean
  onClick: () => void
  titleAttr?: string
}

function SortableHeader({ label, active, asc, onClick, titleAttr }: SortableHeaderProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-background hover:text-foreground",
        active && "text-foreground"
      )}
      title={titleAttr}
    >
      <span className="text-base">{label}</span>
      {active ? (
        asc ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )
      ) : (
        <ChevronDown className="h-3 w-3 opacity-25" />
      )}
    </button>
  )
}

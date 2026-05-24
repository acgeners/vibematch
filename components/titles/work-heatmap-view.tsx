"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import { ChevronDown, ChevronUp, ImageOff } from "lucide-react"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { ScoreBadge, type ScoreColorThresholds } from "@/components/ui/score-badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Checkbox } from "@/components/ui/checkbox"
import { WorkTitleLink } from "@/components/titles/work-title-link"
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
  scoreThresholds: ScoreColorThresholds | null
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  namespace?: WorkColumnNamespace
  basePath?: string
  enableCompare?: boolean
}

const NON_CRITERION_LABELS: Record<string, string> = {
  final_score: "Final",
  calc_score: "IA",
  predicted_score: "Pr",
  platform_avg: "Externa",
  alignment_score: "IA Rk.",
}

const NON_CRITERION_TOOLTIPS: Record<string, string> = {
  final_score: "Nota.Final",
  calc_score: "Nota.IA",
  predicted_score: "Nota.Pr",
  platform_avg: "Média externa",
  alignment_score: "IA Re-rank (sob demanda)",
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
  if (key === "platform_avg") {
    const v = work.calculated_scores?.platform_avg
    return v == null ? null : Number(v)
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
      <div className="overflow-auto rounded-lg border border-border/70 bg-card/80 shadow-sm">
        <p className="border-b bg-muted/40 px-3 py-1.5 text-[10px] text-muted-foreground">
          Heatmap ordena apenas as obras visíveis nesta página · use <span className="font-medium text-foreground">Colunas</span> para escolher as notas.
        </p>
        <table className="min-w-full border-collapse text-sm">
          <thead className="bg-muted/60">
            <tr>
              <th className="sticky left-0 z-20 min-w-[280px] border-b border-r bg-muted/60 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Obra
              </th>
              {visibleScoreColumns.map((col) => {
                const hasSeparator = columnSeparators.has(col.key)
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "border-b px-1.5 py-2 text-center text-xs font-semibold text-muted-foreground",
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
                        <span className="line-clamp-2 max-w-[220px] text-xs font-medium text-foreground">
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
                          "px-1 py-1.5 text-center",
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
  scoreThresholds: ScoreColorThresholds | null
}) {
  const score = getValueForKey(work, col.key)
  const tooltipLabel = getTooltipLabel(col)

  if (score == null) return <EmptyCell />

  // Calculated/aggregated scores use ScoreBadge (with thresholds).
  if (
    col.key === "final_score" ||
    col.key === "calc_score" ||
    col.key === "predicted_score"
  ) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-block">
            <ScoreBadge
              score={score}
              size="sm"
              thresholds={scoreThresholds}
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

  if (col.key === "alignment_score") {
    return (
      <AlignmentScoreCell
        score={score}
        justification={work.calculated_scores?.alignment_justification ?? null}
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
            "inline-grid h-9 w-12 place-items-center rounded-md font-mono text-sm font-bold",
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
    <span className="inline-flex h-9 w-12 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
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

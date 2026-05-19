"use client"

import Link from "next/link"
import { useEffect, useState, useSyncExternalStore } from "react"
import { ImageOff, LayoutGrid, List } from "lucide-react"
import type { RankingEntry } from "@/server/queries/ranking"
import { getCoverImageSrc } from "@/lib/image-proxy"
import { cn, titleToSlug } from "@/lib/utils"
import { ScoreBadge, type ScoreColorThresholds } from "@/components/ui/score-badge"
import { PublicationStatusBadge, PersonalStatusBadge } from "@/components/ui/status-badge"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import type { WorkPreview } from "@/server/actions/works"
import {
  getConfiguredRankingColumns,
  getDefaultRankingColumnConfig,
  readRankingColumnConfig,
  subscribeRankingColumnConfig,
  RANKING_TABLE_COLUMNS,
} from "@/components/ranking/ranking-table-config"
import type { RankingColumnDef } from "@/components/ranking/ranking-table-config"

type ViewMode = "list" | "cards"
const VIEW_STORAGE_KEY = "ranking_view_mode_v1"
const VIEW_EVENT = "ranking-view-mode-change"

function readViewMode(): ViewMode {
  if (typeof window === "undefined") return "list"
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY)
  return stored === "cards" ? "cards" : "list"
}

function subscribeViewMode(onChange: () => void) {
  if (typeof window === "undefined") return () => {}
  window.addEventListener(VIEW_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(VIEW_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

function writeViewMode(mode: ViewMode) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(VIEW_STORAGE_KEY, mode)
  window.dispatchEvent(new CustomEvent(VIEW_EVENT))
}

interface RankingTableProps {
  entries: RankingEntry[]
  scoreThresholds?: ScoreColorThresholds | null
}

const KEY_CRITERIA = ["romance", "fantasy_nobility", "protagonist", "drama", "tragedy"]

const STORAGE_KEY = "ranking_col_widths_v1"

function useColumnWidths() {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(RANKING_TABLE_COLUMNS.map((c) => [c.key, c.defaultWidth]))
  )

  // Hydrate from localStorage after mount.
  // setState during effect is intentional here (client-only hydration without
  // breaking SSR — initial render uses defaults to avoid hydration mismatch).
  useEffect(() => {
    if (typeof window === "undefined") return
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (!stored) return
      const parsed = JSON.parse(stored) as Record<string, number>
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWidths((prev) => ({ ...prev, ...parsed }))
    } catch {
      // ignore
    }
  }, [])

  const setWidth = (key: string, width: number) => {
    setWidths((prev) => {
      const next = { ...prev, [key]: Math.max(40, Math.round(width)) }
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
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

function entryToPreview(entry: RankingEntry): WorkPreview {
  return {
    workId: entry.workId,
    title: entry.title,
    coverUrl: entry.coverUrl,
    synopsis: entry.synopsis,
    synopsisQuality: entry.synopsisQuality,
    publicationStatusId: entry.publicationStatusId,
    observations: entry.observations,
    year: entry.year,
    platformAvg: entry.platformAvg,
    totalVotes: entry.totalVotes,
  }
}

function TitleCell({ entry }: { entry: RankingEntry }) {
  return (
    <WorkTitleLink
      title={entry.title}
      workId={entry.workId}
      preview={entryToPreview(entry)}
      className="font-medium hover:underline line-clamp-1 block"
    />
  )
}

function formatVotes(votes: number): string {
  if (votes === 0) return "—"
  if (votes < 1000) return String(votes)
  const k = Math.floor(votes / 100) / 10
  const formatted = k % 1 === 0 ? String(k) : k.toFixed(1).replace(".", ",")
  return `${formatted}K`
}

function renderCell(
  entry: RankingEntry,
  col: RankingColumnDef,
  scoreThresholds: ScoreColorThresholds | null | undefined
) {
  if (col.key === "rank") return <span className="font-mono text-sm text-muted-foreground">{entry.rank}</span>
  if (col.key === "title") return <TitleCell entry={entry} />
  if (col.key === "pub") return <PublicationStatusBadge statusId={entry.publicationStatusId} compact />
  if (col.key === "per_status") return <span className="text-sm">{entry.personalStatusSymbol ?? entry.personalStatus}</span>
  if (col.key === "year") return <span className="font-mono text-sm text-muted-foreground">{entry.year ?? "—"}</span>
  if (col.key === "chapters") return <span className="font-mono text-sm">{entry.totalChapters ?? "—"}</span>
  if (col.key === "chapters_read") return <span className="font-mono text-sm">{entry.chaptersRead ?? "—"}</span>
  if (col.key === "synopsis_q") return <span className="text-xs text-muted-foreground">{entry.synopsisQuality ?? "—"}</span>
  if (col.key === "platform_avg") return <span className="font-mono text-sm">{entry.platformAvg != null ? entry.platformAvg.toFixed(1) : "—"}</span>
  if (col.key === "total_votes") return <span className="font-mono text-sm">{formatVotes(entry.totalVotes)}</span>
  if (col.key === "final") return <ScoreBadge score={entry.finalScore} size="md" thresholds={scoreThresholds} />
  if (col.key === "calc") return <ScoreBadge score={entry.calcScore} size="md" thresholds={scoreThresholds} />
  if (col.key === "pred") return <ScoreBadge score={entry.predictedScore} size="md" showStub={entry.predictedIsStub} thresholds={scoreThresholds} />
  if (col.key.startsWith("crit_")) {
    const slug = col.key.slice(5)
    const score = entry.scores[slug]
    return <span className="font-mono text-sm">{score != null ? Math.ceil(score) : "—"}</span>
  }
  return null
}

export function RankingTable({ entries, scoreThresholds = null }: RankingTableProps) {
  const { widths, setWidth } = useColumnWidths()
  const config = useSyncExternalStore(
    subscribeRankingColumnConfig,
    readRankingColumnConfig,
    getDefaultRankingColumnConfig
  )
  const columns = getConfiguredRankingColumns(config)
  const viewMode = useSyncExternalStore(subscribeViewMode, readViewMode, () => "list" as const)

  if (entries.length === 0) {
    return (
      <div className="space-y-3">
        <ViewModeToolbar count={0} viewMode={viewMode} onChange={writeViewMode} />
        <div className="rounded-lg border border-border/70 bg-card/80 py-16 text-center text-sm text-muted-foreground shadow-sm">
          Nenhuma obra encontrada com os filtros aplicados
        </div>
      </div>
    )
  }

  if (viewMode === "cards") {
    return (
      <div className="space-y-3">
        <ViewModeToolbar count={entries.length} viewMode={viewMode} onChange={writeViewMode} />
        <RankingCardsView entries={entries} scoreThresholds={scoreThresholds} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <ViewModeToolbar count={entries.length} viewMode={viewMode} onChange={writeViewMode} />

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border border-border/70 bg-card/80 shadow-sm shadow-black/5 backdrop-blur lg:block">
        <table
          className="border-collapse"
          style={{
            tableLayout: "fixed",
            width: columns.reduce((sum, c) => sum + (widths[c.key] ?? c.defaultWidth), 0),
          }}
        >
          <colgroup>
            {columns.map((col) => {
              const w = widths[col.key] ?? col.defaultWidth
              return <col key={col.key} style={{ width: w }} />
            })}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <tr className="border-b border-border/70">
              {columns.map((col) => {
                const w = widths[col.key] ?? col.defaultWidth
                return (
                <th
                  key={col.key}
                  className="relative h-11 select-none px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  style={{ textAlign: col.align ?? "left", width: w, minWidth: w, maxWidth: w }}
                  title={col.configLabel ?? col.label}
                >
                  <span className="block truncate pr-3">{col.label}</span>
                  <ResizeHandle
                    columnKey={col.key}
                    onResize={setWidth}
                    startWidth={widths[col.key] ?? col.defaultWidth}
                  />
                </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.workId} className="border-b border-border/55 transition-colors last:border-0 hover:bg-primary/5">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className="px-3 py-2.5 align-middle overflow-hidden"
                    style={{ textAlign: col.align ?? "left" }}
                  >
                    <div className="truncate" style={{ textAlign: col.align ?? "left" }}>
                      {renderCell(entry, col, scoreThresholds)}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden space-y-2">
        {entries.map((entry) => (
          <Link
            key={entry.workId}
            href={`/titles/${titleToSlug(entry.title)}`}
            className="block rounded-lg border border-border/70 bg-card/80 p-3 shadow-sm shadow-black/5 transition-all hover:border-primary/30 hover:bg-card"
          >
            <div className="flex items-start gap-3">
              <span className="font-mono text-xs text-muted-foreground w-6 shrink-0 mt-1">
                {entry.rank}
              </span>
              {entry.coverUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={getCoverImageSrc(entry.coverUrl)}
                  alt=""
                  className="h-16 w-12 shrink-0 rounded object-cover"
                  loading="lazy"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-base truncate">{entry.title}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  <PublicationStatusBadge statusId={entry.publicationStatusId} />
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {KEY_CRITERIA.map((slug) => {
                    const score = entry.scores[slug]
                    if (score == null) return null
                    const colDef = columns.find((c) => c.key === `crit_${slug}`)
                    return (
                      <span key={slug} className="text-xs font-medium text-muted-foreground" title={colDef?.configLabel}>
                        {colDef?.label} {score.toFixed(0)}
                      </span>
                    )
                  })}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <ScoreBadge score={entry.finalScore} size="md" thresholds={scoreThresholds} />
                <span className="text-xs text-muted-foreground">
                  Calc: {entry.calcScore?.toFixed(1) ?? "—"}
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function ViewModeToolbar({
  count,
  viewMode,
  onChange,
}: {
  count: number
  viewMode: ViewMode
  onChange: (mode: ViewMode) => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">
        {count} obra{count !== 1 ? "s" : ""} no ranking
      </p>
      <div className="inline-flex items-center rounded-md border border-border/70 bg-background/60 p-0.5">
        <button
          type="button"
          onClick={() => onChange("list")}
          aria-label="Visualizar em lista"
          aria-pressed={viewMode === "list"}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
            viewMode === "list"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <List className="h-3.5 w-3.5" />
          Lista
        </button>
        <button
          type="button"
          onClick={() => onChange("cards")}
          aria-label="Visualizar em cards"
          aria-pressed={viewMode === "cards"}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
            viewMode === "cards"
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Cards
        </button>
      </div>
    </div>
  )
}

// Rank tiers — visual hierarchy MUST reinforce that the page is a ranking.
function rankBadgeStyles(rank: number): string {
  if (rank === 1)
    return "bg-gradient-to-br from-amber-300 to-amber-600 text-white shadow-md shadow-amber-500/40 ring-1 ring-amber-200/50"
  if (rank === 2)
    return "bg-gradient-to-br from-slate-200 to-slate-500 text-white shadow-md shadow-slate-500/35 ring-1 ring-slate-200/50"
  if (rank === 3)
    return "bg-gradient-to-br from-orange-400 to-orange-700 text-white shadow-md shadow-orange-500/40 ring-1 ring-orange-200/40"
  if (rank <= 10)
    return "bg-gradient-to-br from-primary to-[hsl(200_96%_45%)] text-primary-foreground shadow-sm shadow-primary/35 ring-1 ring-primary/30"
  return "bg-background/90 text-foreground shadow-sm ring-1 ring-border/80 backdrop-blur"
}

function rankCardStyles(rank: number): string {
  if (rank === 1) return "border-amber-400/55 shadow-amber-500/15"
  if (rank === 2) return "border-slate-400/55 shadow-slate-400/15"
  if (rank === 3) return "border-orange-500/55 shadow-orange-500/15"
  if (rank <= 10) return "border-primary/35 shadow-primary/10"
  return "border-border/65"
}

function RankingCardsView({
  entries,
  scoreThresholds,
}: {
  entries: RankingEntry[]
  scoreThresholds: ScoreColorThresholds | null
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
      {entries.map((entry) => (
        <RankingCard key={entry.workId} entry={entry} scoreThresholds={scoreThresholds} />
      ))}
    </div>
  )
}

function RankingCard({
  entry,
  scoreThresholds,
}: {
  entry: RankingEntry
  scoreThresholds: ScoreColorThresholds | null
}) {
  const slug = titleToSlug(entry.title)
  const isTop3 = entry.rank <= 3

  return (
    <Link
      href={`/titles/${slug}`}
      className="group flex flex-col gap-2 text-left transition-transform hover:-translate-y-0.5 focus-visible:-translate-y-0.5 focus-visible:outline-none"
    >
      <div
        className={cn(
          "relative aspect-[2/3] overflow-hidden rounded-lg border bg-muted/40 shadow-sm transition-shadow",
          "group-hover:shadow-md group-focus-visible:shadow-md",
          rankCardStyles(entry.rank)
        )}
      >
        {entry.coverUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={getCoverImageSrc(entry.coverUrl)}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-7 opacity-40" />
          </div>
        )}

        {/* Rank badge — the headline element */}
        <div
          className={cn(
            "absolute left-1.5 top-1.5 inline-flex items-center justify-center rounded-full font-bold tabular-nums",
            isTop3 ? "h-9 min-w-9 px-2 text-base" : entry.rank <= 10 ? "h-8 min-w-8 px-1.5 text-sm" : "h-7 min-w-7 px-1.5 text-xs",
            rankBadgeStyles(entry.rank)
          )}
          aria-label={`Posição ${entry.rank}`}
        >
          {entry.rank}
        </div>

        {/* Score badge */}
        {entry.finalScore != null && (
          <div className="absolute right-1.5 top-1.5">
            <ScoreBadge score={entry.finalScore} size="sm" thresholds={scoreThresholds} />
          </div>
        )}

        {/* Footer overlay with status */}
        <div className="absolute inset-x-0 bottom-0 flex items-end gap-1 bg-gradient-to-t from-black/75 via-black/30 to-transparent p-1.5">
          <PublicationStatusBadge statusId={entry.publicationStatusId} />
          <PersonalStatusBadge statusId={entry.personalStatusId} />
        </div>
      </div>

      <div className="px-0.5">
        <div className="flex items-baseline gap-1.5">
          <span
            className={cn(
              "shrink-0 font-mono text-[10px] font-bold uppercase tracking-wide",
              isTop3 ? "text-foreground" : "text-muted-foreground"
            )}
          >
            #{entry.rank}
          </span>
          <p className="line-clamp-2 text-xs font-semibold leading-snug text-foreground group-hover:text-primary">
            {entry.title}
          </p>
        </div>
        {entry.calcScore != null && (
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            IA {entry.calcScore.toFixed(1)}
            {entry.predictedScore != null && <> · Pr {entry.predictedScore.toFixed(1)}</>}
          </p>
        )}
      </div>
    </Link>
  )
}

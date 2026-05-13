"use client"

import Link from "next/link"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { RankingEntry } from "@/server/queries/ranking"
import { titleToSlug } from "@/lib/utils"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PublicationStatusBadge } from "@/components/ui/status-badge"
import {
  getConfiguredRankingColumns,
  getDefaultRankingColumnConfig,
  readRankingColumnConfig,
  subscribeRankingColumnConfig,
  RANKING_TABLE_COLUMNS,
} from "@/components/ranking/ranking-table-config"
import type { RankingColumnDef } from "@/components/ranking/ranking-table-config"

interface RankingTableProps {
  entries: RankingEntry[]
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

interface HoverPreviewProps {
  entry: RankingEntry
  anchorRect: DOMRect
}

function HoverPreview({ entry, anchorRect }: HoverPreviewProps) {
  const margin = 2
  const screenMargin = 8
  const popupWidth = 420
  const popupHeight = 240
  const willOverflowRight = anchorRect.right + margin + popupWidth > window.innerWidth
  const left = willOverflowRight
    ? Math.max(screenMargin, anchorRect.left - popupWidth - margin)
    : anchorRect.right + margin
  const top = Math.min(
    Math.max(screenMargin, anchorRect.top),
    window.innerHeight - popupHeight - screenMargin
  )

  return (
    <div
      className="fixed z-50 w-[420px] rounded-lg border bg-popover text-popover-foreground shadow-lg overflow-hidden pointer-events-none"
      style={{ left, top }}
    >
      <div className="flex gap-4 p-4">
        {entry.coverUrl ? (
          <div className="relative h-44 w-32 shrink-0 rounded-md overflow-hidden bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={entry.coverUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="h-44 w-32 shrink-0 rounded-md bg-muted flex items-center justify-center text-xs text-muted-foreground">
            Sem capa
          </div>
        )}
        <div className="flex flex-col min-w-0 flex-1 h-44">
          <p className="font-semibold text-[15px] leading-tight line-clamp-2 shrink-0 break-words">{entry.title}</p>
          {(entry.year || entry.synopsisQuality || entry.publicationStatus) && (
            <div className="flex items-center gap-1.5 flex-wrap text-xs font-medium text-foreground/70 mt-1.5 pb-1.5 shrink-0 border-b border-border/60">
              {[entry.year, entry.synopsisQuality].filter(Boolean).join(" · ") && (
                <span>{[entry.year, entry.synopsisQuality].filter(Boolean).join(" · ")}</span>
              )}
              {entry.publicationStatus && (
                <>
                  {(entry.year || entry.synopsisQuality) && <span className="text-foreground/40">·</span>}
                  <PublicationStatusBadge status={entry.publicationStatus} />
                </>
              )}
            </div>
          )}
          {entry.synopsis && (
            <div className="flex-1 min-h-0 overflow-hidden mt-2">
              <p className="text-[13px] italic text-muted-foreground line-clamp-6 break-words whitespace-normal leading-snug">{entry.synopsis}</p>
            </div>
          )}
        </div>
      </div>
      <div className="border-t px-4 py-2 flex items-center gap-3">
        {entry.observations ? (
          <p className="text-xs text-muted-foreground line-clamp-2 break-words whitespace-normal flex-1 min-w-0">{entry.observations}</p>
        ) : (
          <span className="flex-1" />
        )}
        <span className="text-xs shrink-0">
          <span className="text-muted-foreground">Nota média: </span>
          <span className="font-medium">
            {entry.platformAvg != null ? entry.platformAvg.toFixed(1).replace(".", ",") : "—"}
          </span>
          <span className="text-muted-foreground"> ({formatVotes(entry.totalVotes)})</span>
        </span>
      </div>
    </div>
  )
}

interface TitleCellProps {
  entry: RankingEntry
}

function TitleCell({ entry }: TitleCellProps) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [hovered, setHovered] = useState(false)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const enterTimer = useRef<number | null>(null)

  const onEnter = () => {
    if (enterTimer.current) window.clearTimeout(enterTimer.current)
    enterTimer.current = window.setTimeout(() => {
      if (ref.current) {
        setRect(ref.current.getBoundingClientRect())
        setHovered(true)
      }
    }, 280)
  }
  const onLeave = () => {
    if (enterTimer.current) {
      window.clearTimeout(enterTimer.current)
      enterTimer.current = null
    }
    setHovered(false)
  }

  return (
    <>
      <Link
        ref={ref}
        href={`/titles/${titleToSlug(entry.title)}`}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className="font-medium hover:underline line-clamp-1 block"
      >
        {entry.title}
      </Link>
      {hovered && rect && <HoverPreview entry={entry} anchorRect={rect} />}
    </>
  )
}

function formatVotes(votes: number): string {
  if (votes === 0) return "—"
  if (votes < 1000) return String(votes)
  const k = Math.floor(votes / 100) / 10
  const formatted = k % 1 === 0 ? String(k) : k.toFixed(1).replace(".", ",")
  return `${formatted}K`
}

function renderCell(entry: RankingEntry, col: RankingColumnDef) {
  if (col.key === "rank") return <span className="font-mono text-sm text-muted-foreground">{entry.rank}</span>
  if (col.key === "title") return <TitleCell entry={entry} />
  if (col.key === "pub") return <PublicationStatusBadge status={entry.publicationStatus} />
  if (col.key === "per_status") return <span className="text-sm">{entry.personalStatusSymbol ?? entry.personalStatus}</span>
  if (col.key === "year") return <span className="font-mono text-sm text-muted-foreground">{entry.year ?? "—"}</span>
  if (col.key === "chapters") return <span className="font-mono text-sm">{entry.totalChapters ?? "—"}</span>
  if (col.key === "chapters_read") return <span className="font-mono text-sm">{entry.chaptersRead ?? "—"}</span>
  if (col.key === "synopsis_q") return <span className="text-xs text-muted-foreground">{entry.synopsisQuality ?? "—"}</span>
  if (col.key === "platform_avg") return <span className="font-mono text-sm">{entry.platformAvg != null ? entry.platformAvg.toFixed(1) : "—"}</span>
  if (col.key === "total_votes") return <span className="font-mono text-sm">{formatVotes(entry.totalVotes)}</span>
  if (col.key === "final") return <ScoreBadge score={entry.finalScore} size="sm" />
  if (col.key === "calc") return <ScoreBadge score={entry.calcScore} size="sm" />
  if (col.key === "pred") return <ScoreBadge score={entry.predictedScore} size="sm" showStub={entry.predictedIsStub} />
  if (col.key.startsWith("crit_")) {
    const slug = col.key.slice(5)
    const score = entry.scores[slug]
    return <span className="font-mono text-sm">{score != null ? Math.ceil(score) : "—"}</span>
  }
  return null
}

export function RankingTable({ entries }: RankingTableProps) {
  const { widths, setWidth } = useColumnWidths()
  const config = useSyncExternalStore(
    subscribeRankingColumnConfig,
    readRankingColumnConfig,
    getDefaultRankingColumnConfig
  )
  const columns = getConfiguredRankingColumns(config)

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm border rounded-lg">
        Nenhuma obra encontrada com os filtros aplicados
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Desktop table */}
      <div className="hidden lg:block overflow-x-auto rounded-md border">
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
          <thead className="bg-muted/30 sticky top-0 z-10">
            <tr className="border-b">
              {columns.map((col) => {
                const w = widths[col.key] ?? col.defaultWidth
                return (
                <th
                  key={col.key}
                  className="relative h-10 px-3 text-xs font-medium text-muted-foreground select-none"
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
              <tr key={entry.workId} className="border-b last:border-0 hover:bg-muted/20">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className="px-3 py-2 align-middle overflow-hidden"
                    style={{ textAlign: col.align ?? "left" }}
                  >
                    <div className="truncate" style={{ textAlign: col.align ?? "left" }}>
                      {renderCell(entry, col)}
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
            className="block border rounded-lg p-3 hover:bg-muted/50 transition-colors"
          >
            <div className="flex items-start gap-3">
              <span className="font-mono text-xs text-muted-foreground w-6 shrink-0 mt-1">
                {entry.rank}
              </span>
              {entry.coverUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={entry.coverUrl}
                  alt=""
                  className="h-16 w-12 shrink-0 rounded object-cover"
                  loading="lazy"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{entry.title}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  <PublicationStatusBadge status={entry.publicationStatus} />
                </div>
                <div className="flex gap-2 mt-2">
                  {KEY_CRITERIA.map((slug) => {
                    const score = entry.scores[slug]
                    if (score == null) return null
                    const colDef = columns.find((c) => c.key === `crit_${slug}`)
                    return (
                      <span key={slug} className="text-xs text-muted-foreground" title={colDef?.configLabel}>
                        {colDef?.label} {score.toFixed(0)}
                      </span>
                    )
                  })}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1 shrink-0">
                <ScoreBadge score={entry.finalScore} size="sm" />
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

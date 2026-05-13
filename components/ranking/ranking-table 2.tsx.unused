"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import type { RankingEntry } from "@/server/queries/ranking"
import { ScoreBadge } from "@/components/ui/score-badge"
import { PublicationStatusBadge } from "@/components/ui/status-badge"
import { CRITERIA_INFO } from "@/lib/constants/criteria"

interface RankingTableProps {
  entries: RankingEntry[]
}

const KEY_CRITERIA = ["romance", "fantasy_nobility", "protagonist", "drama", "tragedy"]

interface ColumnDef {
  key: string
  label: string
  defaultWidth: number
  align?: "left" | "right" | "center"
}

const COLUMNS: ColumnDef[] = [
  { key: "rank",       label: "#",          defaultWidth: 48,  align: "center" },
  { key: "title",      label: "Título",     defaultWidth: 320 },
  { key: "pub",        label: "Pub.",       defaultWidth: 100 },
  { key: "final",      label: "NotaFinal",  defaultWidth: 110, align: "center" },
  { key: "calc",       label: "Nota.Calc",  defaultWidth: 110, align: "center" },
  { key: "pred",       label: "Nota.Pr",    defaultWidth: 110, align: "center" },
  ...KEY_CRITERIA.map((slug) => ({
    key: `crit_${slug}`,
    label: CRITERIA_INFO[slug]?.emoji ?? slug,
    defaultWidth: 56,
    align: "center" as const,
  })),
]

const STORAGE_KEY = "ranking_col_widths_v1"

function useColumnWidths() {
  const [widths, setWidths] = useState<Record<string, number>>(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, c.defaultWidth]))
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
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null)

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragState.current = { startX: e.clientX, startWidth }
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"

    const onMove = (ev: MouseEvent) => {
      if (!dragState.current) return
      const delta = ev.clientX - dragState.current.startX
      onResize(columnKey, dragState.current.startWidth + delta)
    }
    const onUp = () => {
      dragState.current = null
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }

  return (
    <span
      onMouseDown={onMouseDown}
      className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize bg-transparent hover:bg-primary/40 transition-colors"
      aria-hidden
    />
  )
}

interface HoverPreviewProps {
  entry: RankingEntry
  anchorRect: DOMRect
}

function HoverPreview({ entry, anchorRect }: HoverPreviewProps) {
  // Position the popup to the right of the title, fall back to left if no space
  const margin = 8
  const popupWidth = 320
  const willOverflowRight = anchorRect.right + margin + popupWidth > window.innerWidth
  const left = willOverflowRight
    ? Math.max(margin, anchorRect.left - popupWidth - margin)
    : anchorRect.right + margin
  const top = Math.min(
    Math.max(margin, anchorRect.top),
    window.innerHeight - 280 - margin
  )

  return (
    <div
      className="fixed z-50 w-80 rounded-lg border bg-popover text-popover-foreground shadow-lg overflow-hidden pointer-events-none"
      style={{ left, top }}
    >
      <div className="flex gap-3 p-3">
        {entry.coverUrl ? (
          <div className="relative h-32 w-24 shrink-0 rounded-md overflow-hidden bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={entry.coverUrl}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        ) : (
          <div className="h-32 w-24 shrink-0 rounded-md bg-muted flex items-center justify-center text-xs text-muted-foreground">
            Sem capa
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm leading-tight line-clamp-2">{entry.title}</p>
          {entry.year && (
            <p className="text-xs text-muted-foreground mt-0.5">{entry.year}</p>
          )}
          {entry.genres.length > 0 && (
            <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
              {entry.genres.slice(0, 4).join(" · ")}
            </p>
          )}
          {entry.synopsisQuality && (
            <p className="text-xs mt-1.5">{entry.synopsisQuality}</p>
          )}
        </div>
      </div>
      {entry.synopsis && (
        <div className="border-t px-3 py-2 max-h-32 overflow-hidden">
          <p className="text-xs text-muted-foreground line-clamp-6">{entry.synopsis}</p>
        </div>
      )}
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
        href={`/titles/${entry.workId}`}
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

export function RankingTable({ entries }: RankingTableProps) {
  const { widths, setWidth } = useColumnWidths()

  if (entries.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm border rounded-lg">
        Nenhuma obra encontrada com os filtros aplicados
      </div>
    )
  }

  const renderCell = (entry: RankingEntry, col: ColumnDef) => {
    if (col.key === "rank") return <span className="font-mono text-sm text-muted-foreground">{entry.rank}</span>
    if (col.key === "title") return <TitleCell entry={entry} />
    if (col.key === "pub") return <PublicationStatusBadge status={entry.publicationStatus} />
    if (col.key === "final") return <ScoreBadge score={entry.finalScore} size="sm" />
    if (col.key === "calc") return <ScoreBadge score={entry.calcScore} size="sm" />
    if (col.key === "pred")
      return <ScoreBadge score={entry.predictedScore} size="sm" showStub={entry.predictedIsStub} />
    if (col.key.startsWith("crit_")) {
      const slug = col.key.slice(5)
      const score = entry.scores[slug]
      return (
        <span className="font-mono text-sm">
          {score != null ? score.toFixed(1) : "—"}
        </span>
      )
    }
    return null
  }

  return (
    <div className="space-y-4">
      {/* Desktop table */}
      <div className="hidden lg:block overflow-x-auto rounded-md border">
        <table className="border-collapse" style={{ tableLayout: "fixed" }}>
          <colgroup>
            {COLUMNS.map((col) => (
              <col key={col.key} style={{ width: widths[col.key] }} />
            ))}
          </colgroup>
          <thead className="bg-muted/30 sticky top-0 z-10">
            <tr className="border-b">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="relative h-10 px-3 text-xs font-medium text-muted-foreground select-none"
                  style={{
                    textAlign: col.align ?? "left",
                  }}
                  title={col.label}
                >
                  <span className="block truncate pr-2">{col.label}</span>
                  <ResizeHandle
                    columnKey={col.key}
                    onResize={setWidth}
                    startWidth={widths[col.key]}
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.workId} className="border-b last:border-0 hover:bg-muted/20">
                {COLUMNS.map((col) => (
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
            href={`/titles/${entry.workId}`}
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
                    const info = CRITERIA_INFO[slug]
                    const score = entry.scores[slug]
                    if (score == null) return null
                    return (
                      <span key={slug} className="text-xs text-muted-foreground" title={info?.name}>
                        {info?.emoji} {score.toFixed(0)}
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

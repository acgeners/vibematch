"use client"

import { useMemo, useState, useSyncExternalStore } from "react"
import { LayoutGrid, List } from "lucide-react"
import { RankedWorkCard } from "@/components/titles/recommendations/ranked-work-card"
import { WorkHeatmapView } from "@/components/titles/work-heatmap-view"
import { WorkColumnPicker } from "@/components/titles/work-column-picker"
import { cn } from "@/lib/utils"
import type { ScoreColorThresholds } from "@/components/ui/score-badge"
import type { RankedCandidate } from "@/lib/ai-recommendation/types"
import type { WorkWithRelations } from "@/types/domain"

type ViewMode = "list" | "heatmap"

const VIEW_STORAGE_KEY = "recommendations_view_mode_v1"
const VIEW_EVENT = "recommendations-view-mode-change"

function readViewMode(): ViewMode {
  if (typeof window === "undefined") return "list"
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY)
  return stored === "heatmap" ? "heatmap" : "list"
}

function writeViewMode(mode: ViewMode) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(VIEW_STORAGE_KEY, mode)
  window.dispatchEvent(new CustomEvent(VIEW_EVENT))
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

const PRESETS: Array<{ label: string; value: number }> = [
  { label: "Todos", value: 0 },
  { label: "≥ 50", value: 50 },
  { label: "≥ 70", value: 70 },
  { label: "≥ 85", value: 85 },
]

interface RankedWorksViewProps {
  ranked: RankedCandidate[]
  worksById: Record<string, WorkWithRelations>
  scoreThresholds: ScoreColorThresholds | null
}

export function RankedWorksView({
  ranked,
  worksById,
  scoreThresholds,
}: RankedWorksViewProps) {
  const viewMode = useSyncExternalStore(
    subscribeViewMode,
    readViewMode,
    () => "list" as const,
  )
  const [minAlignment, setMinAlignment] = useState<number>(0)

  const filtered = useMemo(
    () => ranked.filter((r) => r.alignment_score >= minAlignment),
    [ranked, minAlignment],
  )

  // Hydrate alignment_score onto a cloned WorkWithRelations for the heatmap,
  // since WorkHeatmapView reads it from work.calculated_scores.alignment_score.
  const heatmapWorks = useMemo<WorkWithRelations[]>(() => {
    return filtered
      .map((r) => {
        const w = worksById[r.work_id]
        if (!w) return null
        return {
          ...w,
          calculated_scores: {
            ...(w.calculated_scores ?? {}),
            alignment_score: r.alignment_score,
          },
        } as WorkWithRelations
      })
      .filter((w): w is WorkWithRelations => w != null)
  }, [filtered, worksById])

  const totalShown = viewMode === "heatmap" ? heatmapWorks.length : filtered.length
  const noopSet = useMemo(() => new Set<string>(), [])
  const noopToggle = () => {}

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Min IA Rk
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => setMinAlignment(p.value)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                minAlignment === p.value
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : "border-border/70 bg-background/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
          <span className="ml-1 text-xs text-muted-foreground">
            · {totalShown} obra{totalShown !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {viewMode === "heatmap" && <WorkColumnPicker namespace="recommendations" />}
          <div className="inline-flex items-center rounded-md border border-border/70 bg-background/60 p-0.5">
            <ViewButton
              active={viewMode === "list"}
              label="Lista"
              icon={<List className="h-3.5 w-3.5" />}
              onClick={() => writeViewMode("list")}
            />
            <ViewButton
              active={viewMode === "heatmap"}
              label="Heatmap"
              icon={<LayoutGrid className="h-3.5 w-3.5" />}
              onClick={() => writeViewMode("heatmap")}
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-md border bg-card/40 p-3 text-sm text-muted-foreground">
          Nenhuma obra com IA Rk ≥ {minAlignment}.
        </p>
      ) : viewMode === "heatmap" ? (
        heatmapWorks.length === 0 ? (
          <p className="rounded-md border bg-card/40 p-3 text-sm text-muted-foreground">
            Obras filtradas não têm dados completos para o heatmap.
          </p>
        ) : (
          <WorkHeatmapView
            works={heatmapWorks}
            scoreThresholds={scoreThresholds}
            selectedIds={noopSet}
            onToggleSelect={noopToggle}
            namespace="recommendations"
            enableCompare={false}
          />
        )
      ) : (
        <div className="space-y-2">
          {filtered.map((r, i) => {
            const originalRank =
              ranked.findIndex((x) => x.work_id === r.work_id) + 1
            return (
              <RankedWorkCard
                key={r.work_id}
                rank={originalRank || i + 1}
                ranked={r}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function ViewButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean
  label: string
  icon: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-2 py-1 text-xs transition-colors",
        active
          ? "bg-primary/15 text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
      aria-pressed={active}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

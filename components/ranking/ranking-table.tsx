"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { AlertTriangle, ChevronDown, ChevronUp, ImageOff, LayoutGrid, List, X } from "lucide-react"
import type { RankingEntry } from "@/server/queries/ranking"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { WorkCompareDrawer } from "@/components/titles/work-compare-drawer"
import { MoodRefineDialog } from "@/components/ranking/mood-refine-dialog"
import { isMoodActive, sortByMoodAdjusted, type MoodRefine, type MoodWork } from "@/lib/calculations/mood-refine"
import type { CriterionSlug } from "@/types/domain"
import { MAX_COMPARE_WORKS } from "@/lib/compare-config"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CoverImage } from "@/components/ui/cover-image"
import { cn, titleToSlug, readingProgressPercent } from "@/lib/utils"
import { formatPercentile } from "@/lib/calculations/percentile"
import { ScoreBadge } from "@/components/ui/score-badge"
import type { ColumnThresholds } from "@/components/ui/score-badge"
import { PublicationStatusBadge, PersonalStatusBadge, AiStatusBadge } from "@/components/ui/status-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { formatRelativeDate, formatFullDateTime } from "@/lib/date-utils"
import { AlignmentCell, AlignmentScoreCell, DecisionCell, SynopsisPredictionCell } from "@/components/ranking/ranking-cells"
import { TierDividerRow } from "@/components/ranking/tie-break-band"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { FavoriteCell } from "@/components/titles/favorite-cell"
import type { WorkPreview } from "@/server/actions/works"
import {
  getConfiguredRankingColumns,
  getDefaultRankingColumnConfig,
  readRankingColumnConfig,
  subscribeRankingColumnConfig,
  RANKING_TABLE_COLUMNS,
} from "@/components/ranking/ranking-table-config"
import type { RankingColumnDef } from "@/components/ranking/ranking-table-config"
import { RankingColumnPicker } from "@/components/ranking/ranking-column-picker"

const COLUMN_TO_SORT_FIELD: Record<string, string> = {
  title: "title",
  pub: "publication_status",
  per_status: "personal_status",
  year: "year",
  chapters: "chapters",
  chapters_read: "chapters_read",
  synopsis_q: "synopsis_q",
  synopsis_pred: "synopsis_pred",
  platform_avg: "platform_avg",
  total_votes: "total_votes",
  decision: "decision",
  expected: "expected_score",
  personal_fit: "personal_fit",
  alignment_score: "alignment_score",
}

function getSortFieldForColumn(key: string): string | null {
  if (key.startsWith("crit_")) return key
  return COLUMN_TO_SORT_FIELD[key] ?? null
}

// Margem (em pontos 0–10) dentro da qual duas obras são tratadas como empatadas
// na Nota de Decisão — fica dentro do erro do preditor (MAE ~0.9), então a
// ordem entre elas é ruído sem um critério extra.
const TIE_DELTA = 0.3

interface Tier {
  /** Índice da primeira obra do tier em `entries` (ordenado por decisão desc). */
  startIndex: number
  workIds: string[]
  count: number
  /** 1-based, na ordem de leitura. */
  tierNumber: number
}

/**
 * Particiona TODAS as entries (ordenadas desc pelo campo `scoreOf`) em tiers:
 * faixas equivalentes, agrupando consecutivas dentro de `TIE_DELTA` do topo do
 * tier (= dentro do erro do modelo). `scoreOf` é o campo ordenado (decisão OU
 * Nota Prevista — mesmo eixo da prioridade), pra os tiers ficarem contíguos.
 * Inclui tiers de 1 obra; entries com score null viram um tier no fim.
 *
 * Substitui o antigo número por linha: a tabela comunica prioridade por SEPARAÇÃO
 * em tiers, não por um decimal falso dentro da incerteza.
 */
function computeTiers(entries: RankingEntry[], scoreOf: (e: RankingEntry) => number | null): Tier[] {
  const tiers: Tier[] = []
  let i = 0
  let tierNumber = 0
  while (i < entries.length) {
    const anchor = scoreOf(entries[i])
    let j = i
    if (anchor == null) {
      while (j + 1 < entries.length && scoreOf(entries[j + 1]) == null) j++
    } else {
      while (j + 1 < entries.length) {
        const next = scoreOf(entries[j + 1])
        if (next == null || Math.abs(anchor - next) > TIE_DELTA) break
        j++
      }
    }
    tierNumber++
    tiers.push({
      startIndex: i,
      workIds: entries.slice(i, j + 1).map((e) => e.workId),
      count: j - i + 1,
      tierNumber,
    })
    i = j + 1
  }
  return tiers
}

/**
 * Desempate dentro de cada tier: reordena por `personalFit` desc (entre obras
 * estatisticamente empatadas, mostra a que mais combina com o perfil primeiro).
 * O fit NÃO vira número — só ordena a ordem default das linhas (o mood reordena
 * depois no drawer). Reatribui os `rank` do tier na ordem exibida pra coluna "#"
 * continuar monotônica. Sort estável.
 */
function reorderTiersByFit(entries: RankingEntry[], tiers: Tier[]): RankingEntry[] {
  const out = [...entries]
  for (const tier of tiers) {
    if (tier.count < 2) continue
    const { startIndex, count } = tier
    const slice = out.slice(startIndex, startIndex + count)
    const ranks = slice.map((e) => e.rank) // ranks do tier, em ordem ascendente
    slice.sort((a, b) => (b.personalFit ?? -Infinity) - (a.personalFit ?? -Infinity))
    for (let k = 0; k < slice.length; k++) {
      out[startIndex + k] = { ...slice[k], rank: ranks[k] }
    }
  }
  return out
}

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
  scoreThresholds?: ColumnThresholds | null
  /** Sort default efetivo (depende do plano). Mantém o header de coluna coerente com o server. */
  defaultSort?: string
  /** Quando false, o re-rank por IA por-linha ("Rankear") é desabilitado (feature Pago). */
  isPaid?: boolean
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
    <div className="flex flex-col gap-0.5 min-w-0">
      <WorkTitleLink
        title={entry.title}
        workId={entry.workId}
        preview={entryToPreview(entry)}
        className="font-medium hover:underline line-clamp-1 block"
      />
      {entry.differentiators.length > 0 ? (
        <TooltipProvider delayDuration={150}>
          <div className="flex flex-wrap gap-1">
            {entry.differentiators.map((d) => {
              const info = CRITERIA_INFO[d.slug]
              if (!info) return null
              return (
                <Tooltip key={d.slug}>
                  <TooltipTrigger asChild>
                    <span className="inline-flex items-center gap-0.5 rounded bg-muted/60 px-1 py-0.5 text-[11px] font-mono text-muted-foreground">
                      <span>{info.emoji}</span>
                      <span>+{d.diff.toFixed(1)}</span>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    {info.name}: destaca-se em +{d.diff.toFixed(1)} vs. obras vizinhas no ranking
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </TooltipProvider>
      ) : null}
    </div>
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
  scoreThresholds: ColumnThresholds | null | undefined,
  isPaid: boolean = true,
  affinity: number | null = null
) {
  if (col.key === "rank") return <span className="font-mono text-sm text-muted-foreground">{entry.rank}</span>
  if (col.key === "percentile") {
    const pct = entry.percentile
    // Cor por faixa (mesma paleta do AlignmentCell): topo verde → base neutra.
    const pctColor =
      pct == null ? "text-muted-foreground"
      : pct >= 75 ? "text-emerald-600 dark:text-emerald-400"
      : pct >= 50 ? "text-amber-600 dark:text-amber-400"
      : pct >= 25 ? "text-orange-600 dark:text-orange-400"
      : "text-muted-foreground"
    return <span className={cn("font-mono text-xs font-medium", pctColor)}>{formatPercentile(pct)}</span>
  }
  if (col.key === "fav")
    return <FavoriteCell workId={entry.workId} workTitle={entry.title} isFavorite={entry.isFavorite} />
  if (col.key === "title") return <TitleCell entry={entry} />
  if (col.key === "pub") return <PublicationStatusBadge statusId={entry.publicationStatusId} compact />
  if (col.key === "per_status") return <PersonalStatusBadge statusId={entry.personalStatusId} iconOnly />
  if (col.key === "year") return <span className="font-mono text-sm text-muted-foreground">{entry.year ?? "—"}</span>
  if (col.key === "chapters") return <span className="font-mono text-sm">{entry.totalChapters ?? "—"}</span>
  if (col.key === "chapters_read") return <span className="font-mono text-sm">{entry.chaptersRead ?? "—"}</span>
  if (col.key === "chapters_progress") {
    const pct = readingProgressPercent(entry.chaptersRead, entry.totalChapters)
    return <span className="font-mono text-sm">{pct != null ? `${pct}%` : "—"}</span>
  }
  if (col.key === "synopsis_q") return <span className="text-xs text-muted-foreground">{entry.synopsisQuality ?? "—"}</span>
  if (col.key === "synopsis_pred")
    return (
      <SynopsisPredictionCell
        quality={entry.predictedSynopsisQuality}
        stale={entry.predictedSynopsisStale}
        confidence={entry.predictedSynopsisConfidence}
      />
    )
  if (col.key === "ai_status") return <AiStatusBadge status={entry.aiEvalStatus} />
  if (col.key === "updated_at") {
    return entry.updatedAt ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <time className="text-xs text-muted-foreground tabular-nums" dateTime={entry.updatedAt}>
            {formatRelativeDate(entry.updatedAt)}
          </time>
        </TooltipTrigger>
        <TooltipContent side="top">
          {formatFullDateTime(entry.updatedAt)}
        </TooltipContent>
      </Tooltip>
    ) : (
      <span className="text-muted-foreground">—</span>
    )
  }
  if (col.key === "last_read_at") {
    return entry.lastReadAt ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <time className="text-xs text-muted-foreground tabular-nums" dateTime={entry.lastReadAt}>
            {formatRelativeDate(entry.lastReadAt)}
          </time>
        </TooltipTrigger>
        <TooltipContent side="top">
          {formatFullDateTime(entry.lastReadAt)}
        </TooltipContent>
      </Tooltip>
    ) : (
      <span className="text-muted-foreground">—</span>
    )
  }
  if (col.key === "platform_avg") return <span className="font-mono text-sm">{entry.platformAvg != null ? entry.platformAvg.toFixed(1) : "—"}</span>
  if (col.key === "total_votes") return <span className="font-mono text-sm">{formatVotes(entry.totalVotes)}</span>
  if (col.key === "decision")
    return (
      <DecisionCell
        score={entry.decisionScore}
        affinity={affinity}
        expected={entry.expectedScore}
        fitPercentile={entry.personalFitPercentile ?? (entry.personalFit != null ? entry.personalFit * 100 : null)}
        alignment={entry.alignmentScore}
      />
    )
  if (col.key === "expected")
    return (
      <span className="inline-flex items-center gap-1">
        <ScoreBadge score={entry.expectedScore} size="sm" showStub={entry.expectedIsStub} thresholds={scoreThresholds?.expected} />
        {entry.lowCoverage && (
          <AlertTriangle
            className="h-3 w-3 text-amber-500"
            aria-label="Baixa cobertura de gênero — predição menos confiável"
          />
        )}
      </span>
    )
  if (col.key === "personal_fit")
    return <AlignmentCell value={entry.personalFit} percentile={entry.personalFitPercentile} showBar={false} />
  if (col.key === "alignment_score")
    return <AlignmentScoreCell score={entry.alignmentScore} justification={entry.alignmentJustification} workId={entry.workId} payload={entry.alignmentPayload} isPaid={isPaid} stale={entry.alignmentStale} />
  if (col.key.startsWith("crit_")) {
    const slug = col.key.slice(5)
    const score = entry.scores[slug]
    return <span className="font-mono text-sm">{score != null ? Math.ceil(score) : "—"}</span>
  }
  return null
}

export function RankingTable({ entries, scoreThresholds = null, defaultSort = "expected_score:desc", isPaid = true }: RankingTableProps) {
  const { widths, setWidth } = useColumnWidths()
  const config = useSyncExternalStore(
    subscribeRankingColumnConfig,
    readRankingColumnConfig,
    getDefaultRankingColumnConfig
  )
  const columns = getConfiguredRankingColumns(config)
  const viewMode = useSyncExternalStore(subscribeViewMode, readViewMode, () => "list" as const)

  // Multi-select pra comparação. Estado local (não persiste entre páginas) —
  // suficiente porque o WorkCompareDrawer busca os dados completos por ID, então
  // a seleção sobrevive a mudanças de filtro mesmo se a obra sair do pool visível.
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Refino por mood: o "Comparar / Refinar" do divisor abre primeiro o popup;
  // a escolha (ou pular) define o moodRefine passado ao drawer.
  const [moodDialogOpen, setMoodDialogOpen] = useState(false)
  const [moodClusterIds, setMoodClusterIds] = useState<string[]>([])
  const [moodRefine, setMoodRefine] = useState<MoodRefine | null>(null)
  const selectedSet = new Set(selectedIds)
  const toggleSelect = (id: string) => {
    const scrollY = window.scrollY
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= MAX_COMPARE_WORKS) return prev
      return [...prev, id]
    })
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY })
    })
  }
  const clearSelection = () => {
    const scrollY = window.scrollY
    setSelectedIds([])
    setDrawerOpen(false)
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY })
    })
  }
  const removeSelection = (id: string) => {
    const scrollY = window.scrollY
    setSelectedIds((prev) => prev.filter((x) => x !== id))
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY })
    })
  }
  // Ação do divisor de tier: abre o popup de refino por mood. Guarda o tier
  // INTEIRO (sem cortar): o mood rankeia todas e o drawer mostra as melhores até
  // o teto (`fetchCompareWorks` corta em MAX_COMPARE_WORKS).
  const compareCluster = (workIds: string[]) => {
    setMoodClusterIds(workIds)
    setMoodDialogOpen(true)
  }
  // Abre o drawer de comparação com (ou sem) o refino por mood escolhido.
  const openCompareWithMood = (mood: MoodRefine | null) => {
    const scrollY = window.scrollY
    setMoodRefine(mood)
    setSelectedIds(moodClusterIds)
    setMoodDialogOpen(false)
    setDrawerOpen(true)
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY })
    })
  }

  // Larguras naturais viram percentagens do total. Com `tableLayout: fixed` +
  // `width: 100%` no wrapper sem overflow-x, a tabela sempre cabe exatamente no
  // container: colunas encolhem proporcionalmente em telas estreitas (mantendo
  // o sticky header funcionando, já que não há scroll context intermediário).
  const naturalWidthOf = (key: string): number => {
    const stored = widths[key]
    if (stored != null) return stored
    return columns.find((c) => c.key === key)?.defaultWidth ?? 100
  }
  const totalNaturalWidth = columns.reduce((sum, c) => sum + naturalWidthOf(c.key), 0)
  const widthPercentOf = (key: string): string =>
    `${((naturalWidthOf(key) / totalNaturalWidth) * 100).toFixed(4)}%`

  const router = useRouter()
  const searchParams = useSearchParams()
  const sortRaw = searchParams.get("sort") ?? defaultSort
  const [activeSortField, activeSortDirRaw = "desc"] = sortRaw.split(",")[0].split(":")
  const activeSortDir: "asc" | "desc" = activeSortDirRaw === "asc" ? "asc" : "desc"

  // Tiers (faixas de prioridade equivalente) fazem sentido em qualquer ordenação
  // descendente pelo MESMO eixo da prioridade: por Prioridade (decisão) OU por
  // Nota Prevista (a âncora da prioridade — praticamente o mesmo eixo). Em outros
  // sorts não há tier contíguo a sinalizar. O agrupamento usa o campo ordenado
  // (pra ficar contíguo); a base do mood-refine continua sendo a decisionScore.
  const tierField: "decision" | "expected_score" | null =
    activeSortDir === "desc" && (activeSortField === "decision" || activeSortField === "expected_score")
      ? activeSortField
      : null
  const tiersEnabled = tierField != null
  const tiers = useMemo(
    () =>
      tierField
        ? computeTiers(
            entries,
            tierField === "expected_score" ? (e) => e.expectedScore : (e) => e.decisionScore,
          )
        : null,
    [entries, tierField],
  )

  // Dentro de cada tier, ordem default por fit. O mood reordena depois no drawer.
  const displayEntries = useMemo(
    () => (tiers ? reorderTiersByFit(entries, tiers) : entries),
    [entries, tiers],
  )

  // Divisor de tier indexado pelo índice de início. Rotula TODOS os tiers
  // (inclusive o 1º) — leitura section-like, cada faixa de prioridade nomeada.
  const tierByStart = useMemo(() => {
    const map = new Map<number, Tier>()
    if (tiers) for (const t of tiers) map.set(t.startIndex, t)
    return map
  }, [tiers])

  // IDs passados ao drawer: na ordem visível, mas reordenados pela Prioridade
  // ajustada ao mood quando há refino ativo (o drawer mostra a linha ajustada).
  const drawerIds = useMemo(() => {
    const base = sortIdsByVisibleOrder(selectedIds, displayEntries)
    if (!moodRefine || !isMoodActive(moodRefine)) return base
    const byId = new Map(entries.map((e) => [e.workId, e]))
    const moodWorks: MoodWork[] = []
    for (const id of base) {
      const e = byId.get(id)
      if (!e) continue
      moodWorks.push({
        id,
        decisionScore: e.decisionScore,
        scores: e.scores as Partial<Record<CriterionSlug, number | null>>,
        totalChapters: e.totalChapters,
        personalFit: e.personalFit,
        totalVotes: e.totalVotes,
        synopsisQuality: e.synopsisQuality,
      })
    }
    return sortByMoodAdjusted(moodWorks, moodRefine).map((w) => w.id)
  }, [selectedIds, displayEntries, moodRefine, entries])

  const updateSort = (field: string) => {
    const params = new URLSearchParams(window.location.search)
    const isActive = activeSortField === field
    const nextDir = isActive && activeSortDir !== "asc" ? "asc" : "desc"
    params.set("sort", `${field}:${nextDir}`)
    params.delete("page")
    router.push(`/ranking?${params.toString()}`)
  }

  if (entries.length === 0) {
    const hasActiveFilters = searchParams.size > 0
    return (
      <div className="space-y-3">
        <ViewModeToolbar count={0} viewMode={viewMode} onChange={writeViewMode} />
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border/70 bg-card/80 py-16 text-center text-sm text-muted-foreground shadow-sm">
          <span>Nenhuma obra encontrada com os filtros aplicados</span>
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={() => router.push("/ranking")}>
              Limpar filtros
            </Button>
          )}
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
      <TooltipProvider delayDuration={150}>
      <div className="hidden w-full rounded-lg border border-border/70 bg-card/80 shadow-sm shadow-black/5 backdrop-blur lg:block">
        <table
          className="border-separate border-spacing-0"
          style={{
            tableLayout: "fixed",
            width: "100%",
          }}
        >
          <colgroup>
            {columns.map((col) => (
              <col key={col.key} style={{ width: widthPercentOf(col.key) }} />
            ))}
          </colgroup>
          <thead className="sticky -top-5 z-30 md:-top-7 [&_th]:bg-muted [&_tr:first-child_th:first-child]:rounded-tl-lg [&_tr:first-child_th:last-child]:rounded-tr-lg [&>tr>th]:border-b [&>tr>th]:border-border/70">
            <tr>
              {columns.map((col) => {
                const sortField = getSortFieldForColumn(col.key)
                const isSortable = sortField !== null
                const isActive = isSortable && activeSortField === sortField
                const slug = col.key.startsWith("crit_") ? col.key.slice(5) : null
                const criterion = slug ? CRITERIA_INFO[slug] : null
                const fullName = criterion?.name ?? col.configLabel ?? null
                const description = criterion?.description ?? col.description ?? null
                const showFullName = fullName && fullName !== col.label
                const align = col.align ?? "left"
                const justify =
                  align === "center" ? "justify-center" : align === "right" ? "justify-end" : "justify-start"

                const labelNode = isSortable ? (
                  <button
                    type="button"
                    onClick={() => updateSort(sortField!)}
                    className={cn(
                      "inline-flex max-w-full items-center gap-0.5 rounded px-0.5 py-0.5 transition-colors hover:bg-background/60 hover:text-foreground",
                      isActive && "text-foreground"
                    )}
                    aria-label={`Ordenar por ${fullName ?? col.label}`}
                  >
                    <span className="truncate">{col.label}</span>
                    {isActive ? (
                      activeSortDir === "asc"
                        ? <ChevronUp className="h-3 w-3 shrink-0" />
                        : <ChevronDown className="h-3 w-3 shrink-0" />
                    ) : (
                      <ChevronDown className="hidden h-3 w-3 shrink-0 opacity-40 group-hover/header:inline-block" />
                    )}
                  </button>
                ) : (
                  <span className="block truncate">{col.label}</span>
                )

                const wrapped = (showFullName || description) ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{labelNode}</TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs whitespace-pre-line text-left">
                      {showFullName && <span className="font-semibold">{fullName}</span>}
                      {description && (
                        <span className={cn("block text-xs text-muted-foreground", showFullName && "mt-1")}>
                          {description}
                        </span>
                      )}
                    </TooltipContent>
                  </Tooltip>
                ) : labelNode

                return (
                <th
                  key={col.key}
                  className={cn(
                    "group/header relative h-11 select-none text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                    col.key.startsWith("crit_") ? "px-1" : "px-3"
                  )}
                  style={{ textAlign: align }}
                >
                  <div className={cn("flex items-center pr-3", justify)}>{wrapped}</div>
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
            {displayEntries.map((entry, index) => {
              const tierDivider = tierByStart.get(index)
              return (
              <Fragment key={entry.workId}>
                {tierDivider && (
                  <TierDividerRow
                    tierNumber={tierDivider.tierNumber}
                    workIds={tierDivider.workIds}
                    count={tierDivider.count}
                    colSpan={columns.length}
                    onCompare={tierDivider.count >= 2 ? compareCluster : undefined}
                  />
                )}
                <tr className="transition-colors hover:bg-primary/5 [&>td]:border-b [&>td]:border-border/55 last:[&>td]:border-0">
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "h-14 py-3 align-middle overflow-hidden",
                        col.key.startsWith("crit_") ? "px-1" : "px-3"
                      )}
                      style={{ textAlign: col.align ?? "left" }}
                    >
                      <div className="truncate" style={{ textAlign: col.align ?? "left" }}>
                        {col.key === "select" ? (
                          <Checkbox
                            checked={selectedSet.has(entry.workId)}
                            disabled={!selectedSet.has(entry.workId) && selectedIds.length >= MAX_COMPARE_WORKS}
                            onCheckedChange={() => toggleSelect(entry.workId)}
                            aria-label={`Selecionar ${entry.title} para comparar`}
                          />
                        ) : (
                          renderCell(entry, col, scoreThresholds, isPaid, null)
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      </TooltipProvider>

      {/* Mobile cards */}
      <div className="lg:hidden space-y-2">
        {displayEntries.map((entry) => (
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
                <CoverImage
                  url={entry.coverUrl}
                  className="h-16 w-12 shrink-0 rounded object-cover"
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
                <ScoreBadge score={entry.expectedScore} size="md" showStub={entry.expectedIsStub} thresholds={scoreThresholds?.expected} />
                <span className="text-xs text-muted-foreground">Prevista</span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <CompareFloatingBar
        count={selectedIds.length}
        onOpen={() => {
          setMoodRefine(null) // comparação manual: sem refino por mood
          setDrawerOpen(true)
        }}
        onClear={clearSelection}
      />

      <MoodRefineDialog
        open={moodDialogOpen}
        onOpenChange={setMoodDialogOpen}
        workCount={moodClusterIds.length}
        onApply={(mood) => openCompareWithMood(mood)}
        onSkip={() => openCompareWithMood(null)}
      />

      <WorkCompareDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        ids={drawerIds}
        moodRefine={moodRefine}
        onClear={clearSelection}
        onRemoveId={removeSelection}
        scoreThresholds={scoreThresholds}
        isPaid={isPaid}
      />
    </div>
  )
}

/**
 * Reordena `ids` de seleção (cronológica) pra refletir a ordem visível na
 * tabela. Garante que o drawer de comparação apresente as obras na mesma
 * sequência do ranking, não na ordem em que o usuário clicou. IDs que não
 * estão no pool visível vão pro fim, preservando seleção entre filtros.
 */
function sortIdsByVisibleOrder(ids: string[], entries: RankingEntry[]): string[] {
  const indexById = new Map(entries.map((e, i) => [e.workId, i]))
  return [...ids].sort(
    (a, b) => (indexById.get(a) ?? Number.MAX_SAFE_INTEGER) - (indexById.get(b) ?? Number.MAX_SAFE_INTEGER)
  )
}

function CompareFloatingBar({
  count,
  onOpen,
  onClear,
}: {
  count: number
  onOpen: () => void
  onClear: () => void
}) {
  if (count === 0) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-3">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
        <span className="text-sm">
          <span className="font-semibold">{count}</span>
          <span className="ml-1 text-muted-foreground">
            obra{count !== 1 ? "s" : ""} selecionada{count !== 1 ? "s" : ""}
          </span>
        </span>
        <Button size="sm" onClick={onOpen} className="h-7 text-xs">
          Comparar
        </Button>
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
      <div className="flex items-center gap-2">
        {viewMode === "list" && <RankingColumnPicker />}
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
  scoreThresholds: ColumnThresholds | null
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
  scoreThresholds: ColumnThresholds | null
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
          <CoverImage
            url={entry.coverUrl}
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

        {/* Score badge — Nota Prevista */}
        {entry.expectedScore != null && (
          <div className="absolute right-1.5 top-1.5">
            <ScoreBadge score={entry.expectedScore} size="sm" showStub={entry.expectedIsStub} thresholds={scoreThresholds?.expected} />
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
        {entry.alignmentScore != null && (
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            Veredito IA {Math.round(entry.alignmentScore)}
          </p>
        )}
      </div>
    </Link>
  )
}

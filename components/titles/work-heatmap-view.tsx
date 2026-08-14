"use client"

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { ChevronDown, ChevronUp, ImageOff } from "lucide-react"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { LABELS } from "@/lib/constants/ui-labels"
import { cn } from "@/lib/utils"
import { pickPrimaryCover } from "@/lib/covers"
import { CoverImage } from "@/components/ui/cover-image"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Checkbox } from "@/components/ui/checkbox"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { AdultBadge } from "@/components/ui/adult-badge"
import { ResponsiveHeaderLabel, headerFormsFor } from "@/components/titles/responsive-header-label"
import { FavoriteCell } from "@/components/titles/favorite-cell"
import { AlignmentCell, AlignmentScoreCell, SynopsisPredictionCell } from "@/components/ranking/ranking-cells"
import { pickCriterionTierByRange } from "@/components/ui/score-badge"
import type { AttrColorMode, CriterionRange, CriterionTier } from "@/components/ui/score-badge"
import { readAttrColorMode, subscribeAttrColorMode } from "@/lib/ui/attr-color-mode"
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
import type { WorkWithRelations, CategoryScore } from "@/types/domain"

interface WorkHeatmapViewProps {
  works: WorkWithRelations[]
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
  namespace?: WorkColumnNamespace
  basePath?: string
  enableCompare?: boolean
  enableSelectAll?: boolean
  allSelected?: boolean
  someSelected?: boolean
  onSelectAll?: () => void
  onClearAll?: () => void
  /** Faixas ideais por critério (perfil). Habilita o modo de cor "Minha faixa". */
  criterionPrefs?: Record<string, CriterionRange>
  /**
   * Garante as 9 colunas de critério na matriz mesmo que o namespace as esconda
   * por padrão.
   *
   * Existe por causa de /titles: lá o default de coluna foi escrito pra LISTA
   * ("visão enxuta") e esconde os 9 critérios. A matriz herdava esse default e
   * abria mostrando Nota Prevista/Média/Votos — ou seja, uma matriz de atributos
   * sem nenhum atributo. Ela ainda respeita a ORDEM e as colunas não-critério da
   * config; só não deixa o conjunto de critérios ficar vazio por herança.
   */
  forceCriterionColumns?: boolean
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
  expected_score: LABELS.expected_score.short,
  personal_fit: LABELS.personal_fit.abbrev,
  platform_avg: LABELS.platform_avg.short,
  total_votes: LABELS.total_votes.short,
  alignment_score: LABELS.alignment_score.short,
  synopsis_q: LABELS.synopsis_q.abbrev,
  synopsis_pred: LABELS.synopsis_pred.abbrev,
}

const NON_CRITERION_TOOLTIPS: Record<string, string> = {
  expected_score: LABELS.expected_score.tooltip_full,
  personal_fit: LABELS.personal_fit.tooltip_full,
  platform_avg: LABELS.platform_avg.tooltip_full,
  total_votes: LABELS.total_votes.tooltip_full,
  alignment_score: LABELS.alignment_score.tooltip_full,
  synopsis_q: LABELS.synopsis_q.tooltip_full,
  synopsis_pred: LABELS.synopsis_pred.tooltip_full,
}

function formatVoteCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

function scoreFor(work: WorkWithRelations, slug: string): number | null {
  const cs = (work.category_scores ?? []).find((c: CategoryScore) => c.criterion_slug === slug)
  return cs?.score != null ? Number(cs.score) : null
}

// Paleta de blocos sólidos do heatmap (mantém o visual atual; sem bordas/pílula).
// top e high são 2 TONS DE VERDE distintos (forte vs suave) — antes eram quase
// iguais (emerald-100 vs green-100), o que deixava o heatmap uniforme.
const HEATMAP_TIER_CLASS: Record<CriterionTier, string> = {
  top: "bg-green-300 text-green-950",
  high: "bg-green-100 text-green-700",
  mid: "bg-yellow-100 text-yellow-800",
  low: "bg-orange-100 text-orange-800",
  bottom: "bg-red-100 text-red-800",
  neutral: "bg-muted text-muted-foreground",
}

function getCriterionColor(
  score: number,
  slug: string,
  mode: AttrColorMode,
  range?: CriterionRange | null,
): string {
  // Modo "faixa ideal": cor pela distância à faixa do perfil (drama/tragédia
  // deixam de ser caso especial — viram só uma faixa baixa).
  if (mode === "range" && range) return HEATMAP_TIER_CLASS[pickCriterionTierByRange(score, range)]
  // Modo "catálogo" (histórico, limiares fixos; drama/tragédia invertidos).
  const isNegative = slug === "drama" || slug === "tragedy"
  if (isNegative) {
    if (score <= 3) return "bg-green-300 text-green-950"
    if (score <= 5) return "bg-yellow-100 text-yellow-800"
    return "bg-red-100 text-red-800"
  }
  if (score >= 8) return "bg-green-300 text-green-950"
  if (score >= 6) return "bg-green-100 text-green-700"
  if (score >= 4) return "bg-yellow-100 text-yellow-800"
  return "bg-red-100 text-red-800"
}

function getValueForKey(work: WorkWithRelations, key: string): number | null {
  if (key === "expected_score") {
    const v = work.calculated_scores?.expected_score
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
  if (key === "synopsis_pred") {
    // Mesma lógica do synopsis_q, mas pra previsão da IA (♥..♥♥♥♥ → 1..4).
    const v = work.predicted_synopsis_quality?.trim()
    if (!v) return null
    const n = v.length
    return n > 0 && n <= 4 ? n : null
  }
  if (key === "personal_fit") {
    // Ordena pelo percentil (0–100) exibido; fallback no valor cru × 100.
    const cs = work.calculated_scores
    if (cs?.personal_fit_percentile != null) return cs.personal_fit_percentile
    return cs?.personal_fit != null ? cs.personal_fit * 100 : null
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

/** Nome curto e legível da coluna pro aviso de ordenação do heatmap. */
function getSortLabel(col: WorkColumnDef): string {
  if (col.key.startsWith("crit_")) {
    const slug = col.key.slice("crit_".length)
    return CRITERIA_INFO[slug]?.name ?? slug
  }
  return NON_CRITERION_LABELS[col.key] ?? col.configLabel ?? col.label
}

export function WorkHeatmapView({
  works,
  selectedIds,
  onToggleSelect,
  namespace = "titles",
  enableCompare = true,
  enableSelectAll = false,
  allSelected = false,
  someSelected = false,
  onSelectAll,
  onClearAll,
  criterionPrefs,
  forceCriterionColumns = false,
}: WorkHeatmapViewProps) {
  const columnConfig = useSyncExternalStore(
    (onChange) => subscribeWorkColumnConfig(onChange, namespace),
    () => readWorkColumnConfig(namespace),
    () => getDefaultWorkColumnConfig(namespace)
  )
  // Modo de cor global (catálogo vs. faixa ideal). Em "range" sem perfil, o
  // ScoreCell cai pro catálogo por célula.
  const colorMode = useSyncExternalStore(subscribeAttrColorMode, readAttrColorMode, () => "catalog" as const)

  const visibleScoreColumns = useMemo(() => {
    const config = forceCriterionColumns
      ? {
          ...columnConfig,
          hidden: columnConfig.hidden.filter((key) => !key.startsWith("crit_")),
        }
      : columnConfig
    return getConfiguredWorkColumns(config).filter((c) => isScoreColumn(c.key))
  }, [columnConfig, forceCriterionColumns])

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

  // Ordenação do heatmap. `null` = segue a ordem que o servidor mandou (a
  // Ordenação aplicada na página). Antes o heatmap sobrescrevia sempre com
  // expected_score↓, ignorando a Ordenação — agora só reordena quando o usuário
  // clica num cabeçalho. Ciclo por coluna: desc → asc → volta pra ordem da página.
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  // Coluna sumiu (usuário ocultou) → deixa de ser sort ativo, volta pra ordem da página.
  const effectiveSortKey = useMemo(() => {
    if (sortKey && visibleScoreColumns.find((c) => c.key === sortKey)) return sortKey
    return null
  }, [sortKey, visibleScoreColumns])

  const sortedWorks = useMemo(() => {
    if (!effectiveSortKey) return works // ordem do servidor (Ordenação da página)
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
      // desc → asc → limpa (volta pra ordenação da página).
      if (sortDir === "desc") setSortDir("asc")
      else setSortKey(null)
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const activeSortCol = effectiveSortKey
    ? visibleScoreColumns.find((c) => c.key === effectiveSortKey) ?? null
    : null

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
        <p className="border-b bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          {activeSortCol ? (
            <>
              Reordenado por{" "}
              <span className="font-medium text-foreground">{getSortLabel(activeSortCol)}</span>{" "}
              ({sortDir === "asc" ? "crescente" : "decrescente"}) · clique na coluna de novo para voltar à ordenação da página.
            </>
          ) : (
            <>
              Segue a ordenação da página · clique numa coluna para reordenar aqui · use{" "}
              <span className="font-medium text-foreground">Colunas</span> para escolher as notas.
            </>
          )}
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
                <div className="flex items-center gap-2">
                  {enableCompare && enableSelectAll && (
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={(value) => {
                        if (value) onSelectAll?.()
                        else onClearAll?.()
                      }}
                      aria-label="Selecionar todas as obras visíveis"
                    />
                  )}
                  Obra
                </div>
                <ResizeHandle
                  columnKey="__title__"
                  onResize={setWidth}
                  startWidth={naturalTitleWidth}
                />
              </th>
              {visibleScoreColumns.map((col) => {
                const hasSeparator = columnSeparators.has(col.key)
                // Colunas de nota (LABELS) usam o cabeçalho responsivo compartilhado;
                // colunas de critério (emoji) seguem no SortableHeader.
                const forms = headerFormsFor(col)
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "group/header relative overflow-hidden border-b px-1.5 py-2 text-center text-xs font-semibold text-muted-foreground",
                      hasSeparator && "border-l-2 border-l-primary/30"
                    )}
                  >
                    {forms ? (
                      <ResponsiveHeaderLabel
                        forms={forms}
                        description={NON_CRITERION_TOOLTIPS[col.key] ?? col.description ?? null}
                        align="center"
                        sortable
                        isActive={effectiveSortKey === col.key}
                        sortDir={sortDir === "asc" ? "asc" : "desc"}
                        onSort={() => handleSort(col.key)}
                      />
                    ) : (
                      <SortableHeader
                        label={getHeaderLabel(col)}
                        active={effectiveSortKey === col.key}
                        asc={sortDir === "asc"}
                        onClick={() => handleSort(col.key)}
                        titleAttr={getTooltipLabel(col)}
                      />
                    )}
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
                    isSelected && "bg-primary/12"
                  )}
                >
                  {/* A 1ª célula é sticky e OPACA: sem repetir o realce aqui, a linha selecionada
                      ficava sem marca justamente na coluna que fica visível ao rolar. */}
                  <td
                    className={cn(
                      "sticky left-0 z-10 border-r px-3 py-2",
                      isSelected
                        ? "bg-primary/12 shadow-[inset_3px_0_0_0_var(--color-primary)]"
                        : "bg-background"
                    )}
                  >
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
                            <CoverImage
                              url={cover}
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
                      {/* 18+ FORA do link (como nos cards): o selo é um fato sobre a obra, não
                          parte do rótulo do link. Aqui é a única marca de classificação da
                          matriz — a coluna 🔞 desta view é a NOTA de `adult_content` (0–10,
                          quanto a obra mostra), que é outro fato. */}
                      {work.is_adult && <AdultBadge className="shrink-0 px-1.5 py-0 text-[10px]" />}
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
                          colorMode={colorMode}
                          criterionPrefs={criterionPrefs}
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
  colorMode,
  criterionPrefs,
}: {
  col: WorkColumnDef
  work: WorkWithRelations
  colorMode: AttrColorMode
  criterionPrefs?: Record<string, CriterionRange>
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

  // synopsis_pred (Interesse IA) também é string ♥..♥♥♥♥ — render via a mesma
  // pílula da tabela/ranking (com stale + confiança no tooltip).
  if (col.key === "synopsis_pred") {
    const v = work.predicted_synopsis_quality?.trim()
    if (!v) return <EmptyCell />
    return (
      <SynopsisPredictionCell
        quality={v}
        stale={work.predicted_synopsis_stale ?? false}
        confidence={work.predicted_synopsis_confidence ?? null}
      />
    )
  }

  const score = getValueForKey(work, col.key)

  if (score == null) return <EmptyCell />

  if (col.key === "personal_fit") {
    // Alinhamento — percentil colorido por faixa (mesma célula da tabela).
    return (
      <AlignmentCell
        value={work.calculated_scores?.personal_fit ?? null}
        percentile={work.calculated_scores?.personal_fit_percentile ?? null}
        showBar={false}
      />
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
  const range = criterionPrefs?.[colorSlug] ?? null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "mx-auto inline-grid h-9 w-full min-w-0 max-w-[96px] place-items-center rounded-md font-mono text-sm font-bold",
            getCriterionColor(score, colorSlug, colorMode, range)
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

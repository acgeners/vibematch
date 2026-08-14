"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Fragment, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { AlertTriangle, BookOpen, ChevronDown, ChevronUp, Compass, ImageOff, Layers, LayoutGrid, List, Sparkles, Star } from "lucide-react"
import type { RankingEntry } from "@/server/queries/ranking"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { WorkCompareDrawer } from "@/components/titles/work-compare-drawer"
import { MoodRefineDialog } from "@/components/ranking/mood-refine-dialog"
import { isMoodActive, sortByMoodAdjusted, type MoodRefine, type MoodWork } from "@/lib/calculations/mood-refine"
import { buildRankingTiers } from "@/lib/ranking/build-tiers"
import { whyThisWork, forceMomentsOf } from "@/lib/ranking/why-this-work"
import type { WorkSeparator } from "@/lib/ranking/why-this-work"
import { SeparatorCell, SeparatorLegend, separatorValue } from "@/components/ranking/separator-cell"
import { roundToDisplayScore } from "@/lib/score-rounding"
import { criterionHighlights } from "@/lib/ranking/criterion-highlights"
import type { CriterionHighlight, HighlightWeight } from "@/lib/ranking/criterion-highlights"
import type { CriterionMoments } from "@/lib/ranking/criterion-unit"
import { DEFAULT_TIER_BAND_WIDTH } from "@/lib/ranking/tier-config"
import type { CriterionSlug } from "@/types/domain"
import { MAX_SELECTION_WORKS } from "@/lib/compare-config"
import { toast } from "sonner"
import { CompareSelectionBar } from "@/components/titles/selection-bar"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { AddToGroupDialog } from "@/components/favorites/lists/add-to-group-dialog"
import { useBatchAiActions } from "@/components/titles/use-batch-ai-actions"
import { setFavoriteMany } from "@/server/actions/works"
import { countSelectedWorksInFolders } from "@/server/actions/lists"
import { useRefresh } from "@/lib/use-refresh"
import type { ListPickerOption } from "@/server/queries/lists"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CoverImage } from "@/components/ui/cover-image"
import { InterestAppliedMark } from "@/components/ui/interest-applied-mark"
import { cn, titleToSlug, readingProgressPercent } from "@/lib/utils"
import { formatPercentile } from "@/lib/calculations/percentile"
import { ScoreBadge, criterionCellTextClass, getSoftScoreColor } from "@/components/ui/score-badge"
import type { ColumnThresholds, CriterionRange, AttrColorMode } from "@/components/ui/score-badge"
import { readAttrColorMode, subscribeAttrColorMode } from "@/lib/ui/attr-color-mode"
import { PublicationStatusBadge, PersonalStatusBadge, AiStatusBadge } from "@/components/ui/status-badge"
import { AdultBadge } from "@/components/ui/adult-badge"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { formatRelativeDate, formatFullDateTime } from "@/lib/date-utils"
import { AlignmentCell, AlignmentScoreCell, DecisionCell, ManualInterestCell, SynopsisPredictionCell } from "@/components/ranking/ranking-cells"
import { BussolaPlane } from "@/components/ranking/bussola-plane"
import { computeWorkForces } from "@/lib/calculations/forces"
import { LABELS } from "@/lib/constants/ui-labels"
import { TierDividerRow } from "@/components/ranking/tie-break-band"
import {
  archetypesOf,
  compositionOf,
  ARCHETYPE_LABEL,
  ARCHETYPE_MEANING,
  ARCHETYPE_ORDER,
} from "@/lib/ranking/tier-composition"
import type { ForceArchetype } from "@/lib/ranking/tier-composition"
import { ARCHETYPE_STYLE } from "@/lib/ranking/archetype-style"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { FavoriteCell } from "@/components/titles/favorite-cell"
import type { WorkPreview } from "@/server/actions/works"
import {
  DEFAULT_COLUMN_WIDTHS,
  getConfiguredWorkColumns,
  getDefaultWorkColumnConfig,
  readWorkColumnConfig,
  subscribeWorkColumnConfig,
} from "@/components/titles/work-table-config"
import type { WorkColumnDef } from "@/components/titles/work-table-config"
import { WorkColumnPicker } from "@/components/titles/work-column-picker"
import { ResponsiveHeaderLabel, headerFormsFor } from "@/components/titles/responsive-header-label"

// Coluna "#" (posição). É estrutural do /ranking — não existe no vocabulário
// compartilhado (work-table-config) nem no picker. O RankingTable a prepende
// à lista de colunas configuradas.
const RANK_COL: WorkColumnDef = {
  key: "rank",
  label: "#",
  configLabel: "Posição",
  description: "Posição da obra na ordenação atual da tabela.",
  align: "center",
  locked: true,
  group: "basico",
}

// Coluna de SELEÇÃO. Prependida como o RANK_COL — e não vinda da config —
// porque no /ranking ela é estrutural: some do picker, ninguém pode escondê-la
// e ela nunca troca de posição.
//
// 🔴 Até 2026-08-08 ela era FILTRADA FORA junto com "actions", e o resultado é o
// pior tipo de bug: `toggleSelect`, o teto de seleção e a barra flutuante
// existiam e compilavam, mas nenhum checkbox era desenhado na lista. A seleção
// só nascia pelo "Comparar / Refinar" do divisor de tier — então o código
// parecia pronto e a feature não existia.
const SELECT_COL: WorkColumnDef = {
  key: "select",
  label: "",
  configLabel: "Seleção",
  align: "center",
  locked: true,
  group: "basico",
}

// Chave da coluna (vocabulário work-table-config) → campo de ordenação aceito
// pelo server. A maioria é identidade; os pares divergentes vêm do rename ao
// unificar o /ranking com o sistema Work (chapters_total→chapters etc.).
const COLUMN_TO_SORT_FIELD: Record<string, string> = {
  title: "title",
  publication_status: "publication_status",
  personal_status: "personal_status",
  year: "year",
  chapters_total: "chapters",
  chapters_read: "chapters_read",
  synopsis_q: "synopsis_q",
  synopsis_pred: "synopsis_pred",
  platform_avg: "platform_avg",
  total_votes: "total_votes",
  decision: "decision",
  expected_score: "expected_score",
  user_score: "user_score",
  personal_fit: "personal_fit",
  alignment_score: "alignment_score",
}

function getSortFieldForColumn(key: string): string | null {
  if (key.startsWith("crit_")) return key
  return COLUMN_TO_SORT_FIELD[key] ?? null
}

interface Tier {
  /** Índice da primeira obra do tier em `entries` (ordenado por decisão desc). */
  startIndex: number
  workIds: string[]
  count: number
  /** 1-based, na ordem de leitura. */
  tierNumber: number
}

/**
 * Particiona as entries (ordenadas desc pelo campo `scoreOf`) em tiers contíguos
 * via `buildRankingTiers` (banda ancorada na 1ª obra do tier, limite inclusivo —
 * ver lib/ranking/build-tiers). A largura (`bandWidth`) vem de
 * `formula_config.tier_band_width` (ajustável sem mudança de código; hoje 0,25, valor
 * MEDIDO — ver lib/ranking/tier-config.ts). `scoreOf` é o campo ordenado (decisão OU
 * Nota Prevista). Entries com
 * score null caem num tier final.
 *
 * A tabela comunica prioridade por SEPARAÇÃO em tiers, não por um decimal falso
 * dentro da incerteza do modelo.
 */
function computeTiers(
  entries: RankingEntry[],
  scoreOf: (e: RankingEntry) => number | null,
  bandWidth: number,
): Tier[] {
  const tiered = buildRankingTiers(entries, (e) => scoreOf(e), bandWidth)
  const tiers: Tier[] = []
  let i = 0
  let tierNumber = 0
  while (i < entries.length) {
    const tierId = tiered[i].tier
    let j = i
    while (j + 1 < entries.length && tiered[j + 1].tier === tierId) j++
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
 * ⚠️ Não existe mais reordenação dentro do tier no cliente.
 *
 * Havia um `reorderTiersByFit` aqui: ele reordenava cada tier por `tagOverlapNet`
 * desc, por cima da ordem que o servidor já tinha produzido. A premissa era "dentro
 * do tier tudo empata" — e ela é FALSA: um tier cobre 8,5 → 8,25 na banda de hoje (e
 * cobria 8,5 → 8,0 na banda de 0,5 em que isto foi descoberto), então
 * o reorder descartava tanto o 2º nível de ordenação escolhido (ex.: Veredito) quanto
 * a própria Nota Prevista. A lista saía numa ordem que nenhum controle da tela
 * explicava, e a coluna "#" era reescrita pra parecer monotônica por cima disso.
 *
 * O sinal não foi perdido: `compareWithinTierTieBreak` virou o desempate FINAL do
 * `getRanking` (depois de todos os níveis escolhidos, antes do título). Assim ele
 * decide só o que ninguém mais decidiu, e vale igual nas quatro views.
 *
 * O tier segue existindo — como AGRUPAMENTO VISUAL (divisor + "Comparar / Refinar"),
 * que é o papel dele.
 */

/**
 * ⚠️ **"faixas" saiu.** A view Faixas chamava a MESMA `buildRankingTiers`, com a
 * mesma `tier_band_width` e a mesma chave de arredondamento da Lista agrupada —
 * era a Lista com um preset fixo de colunas. O que ela tinha de próprio virou
 * parte da Lista: a coluna "O que a separa" (opção do seletor, ligada junto com
 * o Agrupar) e o aviso de imprecisão (subiu para o divisor do tier, que é onde
 * ele se aplica, em vez de repetido em cada linha).
 *
 * Quem tiver `"faixas"` salvo no localStorage cai na Lista — `readViewMode` só
 * aceita os valores vivos, e valor desconhecido já caía no default.
 */
type ViewMode = "list" | "cards" | "bussola"
const VIEW_STORAGE_KEY = "ranking_view_mode_v1"
const VIEW_EVENT = "ranking-view-mode-change"

function readViewMode(): ViewMode {
  if (typeof window === "undefined") return "list"
  const stored = window.localStorage.getItem(VIEW_STORAGE_KEY)
  return stored === "cards" || stored === "bussola" ? stored : "list"
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

/**
 * "Agrupar": preferência de visualização client-side, ligada por padrão. Nunca
 * toca a ordenação — só o agrupamento visual.
 *
 * ⚠️ O CRITÉRIO depende da view, e o rótulo é genérico por isso:
 *   - Lista   → tiers de prioridade equivalente (`buildRankingTiers`)
 *   - Cards   → prateleiras por tipo de aposta (`archetypesOf`)
 *   - Bússola → a LISTA LATERAL em prateleiras; o plano não muda
 *
 * A chave do localStorage mantém o nome antigo de propósito: renomeá-la
 * desligaria o agrupamento de quem já tinha preferência salva, sem ganho nenhum.
 */
const TIERS_STORAGE_KEY = "ranking_tiers_enabled_v1"
const TIERS_EVENT = "ranking-tiers-enabled-change"

function readTiersEnabled(): boolean {
  if (typeof window === "undefined") return true
  // Default ligado; só desligado quando explicitamente "off".
  return window.localStorage.getItem(TIERS_STORAGE_KEY) !== "off"
}

function subscribeTiersEnabled(onChange: () => void) {
  if (typeof window === "undefined") return () => {}
  window.addEventListener(TIERS_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(TIERS_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

function writeTiersEnabled(enabled: boolean) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(TIERS_STORAGE_KEY, enabled ? "on" : "off")
  window.dispatchEvent(new CustomEvent(TIERS_EVENT))
}

interface RankingTableProps {
  entries: RankingEntry[]
  scoreThresholds?: ColumnThresholds | null
  /** Sort default efetivo (depende do plano). Mantém o header de coluna coerente com o server. */
  defaultSort?: string
  /** Quando false, o re-rank por IA por-linha ("Rankear") é desabilitado (feature Pago). */
  isPaid?: boolean
  /** Largura da banda de tiers (formula_config.tier_band_width). Valor medido; ver tier-config.ts. */
  tierBandWidth?: number
  /** Faixas ideais por critério (perfil) — repassadas ao drawer de comparação. */
  criterionPrefs?: Record<string, CriterionRange>
  /** Média/σ de cada atributo no catálogo — alimenta os chips de destaque do card.
   *  Null (leitor falhou) = o card simplesmente não mostra chip. */
  criterionMoments?: CriterionMoments | null
  /** Pesos ativos dos atributos — dão o ▲/▼ dos chips. Null = chip sem marcador. */
  highlightWeights?: HighlightWeight[] | null
  /** Grupos de favoritos disponíveis — habilitam "Adicionar a grupo" na barra de
   *  seleção. Ausente = a página não busca os grupos e o botão não aparece. */
  favoriteGroups?: ListPickerOption[]
}

const KEY_CRITERIA = ["romance", "fantasy_nobility", "protagonist", "drama", "tragedy"]

const STORAGE_KEY = "ranking_col_widths_v1"

function useColumnWidths() {
  const [widths, setWidths] = useState<Record<string, number>>(() => ({
    ...DEFAULT_COLUMN_WIDTHS,
  }))

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
    synopsisFromPrediction: entry.synopsisFromPrediction,
    predictedSynopsisQuality: entry.predictedSynopsisQuality,
    predictedSynopsisStale: entry.predictedSynopsisStale,
    publicationStatusId: entry.publicationStatusId,
    totalChapters: entry.totalChapters,
    observations: entry.observations,
    year: entry.year,
    platformAvg: entry.platformAvg,
    totalVotes: entry.totalVotes,
    isAdult: entry.isAdult,
    expectedScore: entry.expectedScore,
    expectedIsStub: entry.expectedIsStub,
    userScore: entry.userScore,
  }
}

function TitleCell({ entry }: { entry: RankingEntry }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="relative h-14 w-10 shrink-0 overflow-hidden rounded border bg-muted/40">
        {entry.coverUrl ? (
          <CoverImage url={entry.coverUrl} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-4 w-4 opacity-40" />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-0.5 min-w-0">
        <WorkTitleLink
          title={entry.title}
          workId={entry.workId}
          preview={entryToPreview(entry)}
          className="font-medium hover:underline line-clamp-1 block"
        />
        {/* A 2ª linha existe quando há diferenciadores OU quando a obra é 18+ — o selo
            não pode depender de a obra ter chip de critério, senão some justo nas obras
            medianas, que são a maioria. */}
        {entry.isAdult || entry.differentiators.length > 0 ? (
          <TooltipProvider delayDuration={150}>
            <div className="flex flex-wrap items-center gap-1">
              {entry.isAdult && <AdultBadge className="px-1.5 py-0 text-[10px]" />}
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
  col: WorkColumnDef,
  scoreThresholds: ColumnThresholds | null | undefined,
  isPaid: boolean = true,
  affinity: number | null = null,
  colorMode: AttrColorMode = "catalog",
  criterionPrefs?: Record<string, CriterionRange>,
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
  if (col.key === "publication_status") return <PublicationStatusBadge statusId={entry.publicationStatusId} compact hiatusKind={entry.hiatusKind} hiatusKindConfidence={entry.hiatusKindConfidence} publicationStatusNote={entry.publicationStatusNote} />
  if (col.key === "personal_status") return <PersonalStatusBadge statusId={entry.personalStatusId} iconOnly />
  if (col.key === "year") return <span className="font-mono text-sm text-muted-foreground">{entry.year ?? "—"}</span>
  if (col.key === "chapters_total") return <span className="font-mono text-sm">{entry.totalChapters ?? "—"}</span>
  if (col.key === "chapters_read") return <span className="font-mono text-sm">{entry.chaptersRead ?? "—"}</span>
  if (col.key === "chapters_progress") {
    const pct = readingProgressPercent(entry.chaptersRead, entry.totalChapters)
    return <span className="font-mono text-sm">{pct != null ? `${pct}%` : "—"}</span>
  }
  if (col.key === "synopsis_q")
    return <ManualInterestCell quality={entry.synopsisQuality} fromPrediction={entry.synopsisFromPrediction} />
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
  if (col.key === "expected_score") {
    const expectedBadge = (
      <ScoreBadge score={entry.expectedScore} size="sm" showStub={entry.expectedIsStub} thresholds={scoreThresholds?.expected} />
    )
    return (
      <span className="inline-flex items-center gap-1">
        {entry.expectedScore == null ? (
          // Caso nulo: obra sem os 9 atributos da IA ainda não tem Nota Prevista.
          // ScoreBadge não aceita title no estado "—", então o wrapper carrega o
          // tooltip nativo (mesmo texto do card da fila e da página da obra).
          <span title="Sem Nota Prevista ainda — aparece após a avaliação IA dos atributos da obra">
            {expectedBadge}
          </span>
        ) : (
          expectedBadge
        )}
        {entry.lowCoverage && (
          <AlertTriangle
            className="h-3 w-3 text-amber-500"
            aria-label="Baixa cobertura de gênero — predição menos confiável"
          />
        )}
      </span>
    )
  }
  // Sua nota (Real) — sem `thresholds`, como as demais superfícies deste número (a régua
  // de cor da Prevista é da distribuição DELA). Coluna oculta por padrão neste namespace.
  if (col.key === "user_score") return <ScoreBadge score={entry.userScore} size="sm" />
  if (col.key === "personal_fit")
    return <AlignmentCell value={entry.personalFit} percentile={entry.personalFitPercentile} showBar={false} />
  if (col.key === "alignment_score")
    return <AlignmentScoreCell score={entry.alignmentScore} justification={entry.alignmentJustification} workId={entry.workId} payload={entry.alignmentPayload} isPaid={isPaid} stale={entry.alignmentStale} />
  if (col.key.startsWith("crit_")) {
    const slug = col.key.slice(5)
    const score = entry.scores[slug]
    if (score == null) return <span className="font-mono text-sm text-muted-foreground">—</span>
    // Cor na FONTE (sem pílula) — mesma lógica do heatmap (faixa por centro /
    // catálogo por percentil), respeitando o toggle global Catálogo/Minha faixa.
    const textClass = criterionCellTextClass({
      score,
      slug,
      mode: colorMode,
      range: criterionPrefs?.[slug] ?? null,
    })
    return <span className={cn("font-mono text-sm", textClass, "font-bold")}>{Math.ceil(score)}</span>
  }
  return null
}

export function RankingTable({ entries, scoreThresholds = null, defaultSort = "expected_score:desc", isPaid = true, tierBandWidth = DEFAULT_TIER_BAND_WIDTH, criterionPrefs, criterionMoments, highlightWeights, favoriteGroups }: RankingTableProps) {
  const { widths, setWidth } = useColumnWidths()
  // Colunas do /ranking vêm do vocabulário COMPARTILHADO (work-table-config,
  // namespace "ranking"). Prependa a coluna "#" estrutural e descarta as colunas
  // estruturais do Work que o /ranking não usa (select/actions).
  const config = useSyncExternalStore(
    (cb) => subscribeWorkColumnConfig(cb, "ranking"),
    () => readWorkColumnConfig("ranking"),
    () => getDefaultWorkColumnConfig("ranking")
  )
  const viewMode = useSyncExternalStore(subscribeViewMode, readViewMode, () => "list" as const)
  const tiersEnabled = useSyncExternalStore(subscribeTiersEnabled, readTiersEnabled, () => true)
  // Modo de cor global (Catálogo/Minha faixa) — colore as colunas de critério.
  const attrColorMode = useSyncExternalStore(subscribeAttrColorMode, readAttrColorMode, () => "catalog" as const)

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
  // 🔴 O teto é o do LOTE (100), não o do Comparar (10). Enquanto a seleção só
  // servia pra comparar os dois eram o mesmo número; desde que ela alimenta
  // Favoritar/Veredito/Interesse, usar o de comparar recusava a 11ª marcação e
  // tornava as ações em lote inalcançáveis. Quem desabilita acima de 10 hoje é o
  // botão Comparar, com a explicação no title.
  const toggleSelect = (id: string) => {
    const scrollY = window.scrollY
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= MAX_SELECTION_WORKS) return prev
      return [...prev, id]
    })
    requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY })
    })
  }
  /**
   * Marca/desmarca um BLOCO (a página inteira ou um tier). Preserva o que já
   * estava marcado fora do bloco — a caixa do tier não pode limpar a seleção que
   * a pessoa fez noutro tier.
   *
   * ⚠️ Trunca no teto do lote e AVISA. Recusar em silêncio a partir da 101ª
   * deixaria a caixa do tier "não funcionando" sem nada dizer.
   */
  const toggleBlock = (ids: string[], select: boolean) => {
    const scrollY = window.scrollY
    setSelectedIds((prev) => {
      if (!select) {
        const drop = new Set(ids)
        return prev.filter((x) => !drop.has(x))
      }
      const merged = [...prev]
      const seen = new Set(prev)
      let dropped = 0
      for (const id of ids) {
        if (seen.has(id)) continue
        if (merged.length >= MAX_SELECTION_WORKS) {
          dropped++
          continue
        }
        merged.push(id)
        seen.add(id)
      }
      if (dropped > 0) {
        toast.warning(
          `Seleção no limite de ${MAX_SELECTION_WORKS} obras — ${dropped} ficaram de fora.`,
        )
      }
      return merged
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
  // ── Ações em lote sobre a seleção ──────────────────────────────────────────
  const refresh = useRefresh()
  const [busy, setBusy] = useState(false)
  const [addGroupOpen, setAddGroupOpen] = useState(false)
  const [unfavConfirm, setUnfavConfirm] = useState<{ works: number; memberships: number } | null>(null)
  const clearAfterAction = useCallback(() => {
    setSelectedIds([])
    refresh()
  }, [refresh])
  const batchAi = useBatchAiActions({ onSettled: clearAfterAction })

  // Favoritar age só sobre as que AINDA NÃO são — mandar as já favoritas de novo
  // é escrita à toa, e o toast contaria obras que não mudaram.
  const favoriteById = useMemo(
    () => new Map(entries.map((e) => [e.workId, e.isFavorite])),
    [entries],
  )
  const favoriteSelectedIds = selectedIds.filter((id) => favoriteById.get(id) === true)
  const unfavoritedSelectedIds = selectedIds.filter((id) => favoriteById.get(id) !== true)

  const handleBatchFavorite = useCallback(async () => {
    if (unfavoritedSelectedIds.length === 0 || busy) return
    setBusy(true)
    try {
      const result = await setFavoriteMany(unfavoritedSelectedIds, true)
      if (result.error) {
        toast.error(result.error)
        return
      }
      const n = unfavoritedSelectedIds.length
      toast.success(`${n} obra${n !== 1 ? "s" : ""} favoritada${n !== 1 ? "s" : ""}`)
      clearAfterAction()
    } finally {
      setBusy(false)
    }
  }, [unfavoritedSelectedIds, busy, clearAfterAction])

  // Desfavoritar SEMPRE confirma: é a única ação da barra sem volta (refavoritar
  // não recoloca a obra nas pastas). A consulta de pastas decide o TEXTO do
  // aviso, não se ele aparece.
  const handleBatchUnfavorite = useCallback(async () => {
    if (favoriteSelectedIds.length === 0 || busy) return
    setBusy(true)
    try {
      const res = await countSelectedWorksInFolders(favoriteSelectedIds)
      setUnfavConfirm("data" in res ? res.data : { works: 0, memberships: 0 })
    } finally {
      setBusy(false)
    }
  }, [favoriteSelectedIds, busy])

  const runBatchUnfavorite = useCallback(async () => {
    if (favoriteSelectedIds.length === 0) return
    const result = await setFavoriteMany(favoriteSelectedIds, false)
    if (result.error) {
      toast.error(result.error)
      return
    }
    const n = favoriteSelectedIds.length
    toast.success(`${n} obra${n !== 1 ? "s" : ""} desfavoritada${n !== 1 ? "s" : ""}`)
    clearAfterAction()
  }, [favoriteSelectedIds, clearAfterAction])

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
    return DEFAULT_COLUMN_WIDTHS[key] ?? 100
  }

  const router = useRouter()
  const searchParams = useSearchParams()
  const sortRaw = searchParams.get("sort") ?? defaultSort
  const [activeSortField, activeSortDirRaw = "desc"] = sortRaw.split(",")[0].split(":")
  const activeSortDir: "asc" | "desc" = activeSortDirRaw === "asc" ? "asc" : "desc"

  // Tiers (faixas de prioridade equivalente) fazem sentido em qualquer ordenação
  // descendente pelo MESMO eixo da prioridade: por Prioridade (decisão) OU por
  // Nota Prevista (a âncora da prioridade). "recommended" (default Free) é
  // UNIFICADO com expected_score — mesmo eixo (Nota Prevista) — então também forma
  // tiers e diferencia dentro do tier por tag overlap. Em outros sorts não há tier
  // contíguo a sinalizar. A base do mood-refine continua sendo a decisionScore.
  // Ordenação elegível a tiers: descendente pelo eixo da prioridade
  // (Prioridade / Nota Prevista / Recomendado). Fora disso não há faixa contígua
  // a sinalizar e o switch de Tiers fica neutro/desabilitado.
  const tierSortEligible =
    activeSortDir === "desc" &&
    (activeSortField === "decision" ||
      activeSortField === "expected_score" ||
      activeSortField === "recommended")
  // O switch "Tiers" (client-side) permite desligar o agrupamento e ver o
  // ranking corrido — sem alterar a ordenação.
  const tierField: "decision" | "expected_score" | null =
    !tiersEnabled || !tierSortEligible
      ? null
      : activeSortField === "decision"
        ? "decision"
        : "expected_score"
  const tiers = useMemo(
    () =>
      tierField
        ? computeTiers(
            entries,
            // A banda usa a MESMA chave da ordenação, senão o tier intercala e vira
            // vários blocos "Tier N" (ver build-tiers). Nota Prevista ordena pela
            // nota EXIBIDA; Prioridade ordena pelo valor cru.
            tierField === "expected_score"
              ? (e) => (e.expectedScore == null ? null : roundToDisplayScore(e.expectedScore))
              : (e) => e.decisionScore,
            tierBandWidth,
          )
        : null,
    [entries, tierField, tierBandWidth],
  )

  // A ordem exibida É a do servidor — a ordenação escolhida vale inclusive DENTRO
  // de cada tier (o tier só agrupa). O mood reordena depois, no drawer.
  const displayEntries = entries

  /** O que a caixa do cabeçalho governa: as obras NA TELA, não o catálogo. */
  const visibleIds = useMemo(() => displayEntries.map((e) => e.workId), [displayEntries])

  // "O que a separa" mede o desvio contra as empatadas DO TIER: sem tiers na tela
  // ela não tem grupo a que se referir, e sairia medindo contra um conjunto que
  // não está sendo exibido. Some da tabela — a escolha no seletor continua valendo
  // (ela é a outra metade da conjunção), só não tem efeito com o Agrupar desligado.
  const columns = useMemo(
    () =>
      [
        SELECT_COL,
        RANK_COL,
        // O "select" da config sai da lista: ele já entra prependido acima, e sem
        // o filtro apareceria DUAS vezes (com o mesmo `key`, que o React reclama).
        ...getConfiguredWorkColumns(config).filter((c) => c.key !== "select" && c.key !== "actions"),
      ].filter((c) => c.key !== "separator" || tiers != null),
    [config, tiers],
  )

  // Larguras: percentagens do total das colunas EFETIVAMENTE renderizadas — por
  // isso depois do filtro acima, senão a coluna ausente ainda reservaria espaço.
  const totalNaturalWidth = columns.reduce((sum, c) => sum + naturalWidthOf(c.key), 0)
  const widthPercentOf = (key: string): string =>
    `${((naturalWidthOf(key) / totalNaturalWidth) * 100).toFixed(4)}%`

  // Arquétipo (tipo de aposta) de cada obra, por percentil sobre o CONJUNTO
  // EXIBIDO — assim "aposta segura" quer dizer a mesma coisa em todos os tiers da
  // tela. Alimenta os chips de composição do divisor.
  const archetypes = useMemo(() => archetypesOf(displayEntries), [displayEntries])

  // Foco por tipo de aposta: clicar no chip do divisor apaga as demais. Local e
  // efêmero de propósito — é leitura, não filtro; não vai pra URL nem pro preset.
  const [focusedArchetype, setFocusedArchetype] = useState<ForceArchetype | null>(null)
  const toggleArchetype = useCallback(
    (a: ForceArchetype) => setFocusedArchetype((cur) => (cur === a ? null : a)),
    [],
  )

  // Divisor de tier indexado pelo índice de início. Rotula TODOS os tiers
  // (inclusive o 1º) — leitura section-like, cada faixa de prioridade nomeada.
  const tierByStart = useMemo(() => {
    const map = new Map<number, Tier>()
    if (tiers) for (const t of tiers) map.set(t.startIndex, t)
    return map
  }, [tiers])

  /**
   * "O que a separa": a força que mais distancia a obra das EMPATADAS DO PRÓPRIO
   * TIER. Herdado da view Faixas, que foi absorvida por esta.
   *
   * ⚠️ Só existe com tiers na tela — sem grupo não há contra o que comparar. Os
   * momentos (σ) vêm do CONJUNTO EXIBIDO, não do tier: dentro de um tier as obras
   * são parecidas por construção, então o σ local é minúsculo e qualquer diferença
   * viraria um z gigante. Ver `why-this-work.ts`.
   */
  const separatorByIndex = useMemo(() => {
    const map = new Map<number, WorkSeparator | null>()
    if (!tiers) return map
    const moments = forceMomentsOf(displayEntries)
    for (const t of tiers) {
      const group = displayEntries.slice(t.startIndex, t.startIndex + t.count)
      for (let i = t.startIndex; i < t.startIndex + t.count; i++) {
        map.set(i, whyThisWork(displayEntries[i], group, moments))
      }
    }
    return map
  }, [tiers, displayEntries])

  /** Composição por arquétipo de cada tier, indexada pelo índice de início. */
  const compositionByStart = useMemo(() => {
    const map = new Map<number, ReturnType<typeof compositionOf>>()
    if (tiers) {
      for (const t of tiers) {
        map.set(t.startIndex, compositionOf(archetypes.slice(t.startIndex, t.startIndex + t.count)))
      }
    }
    return map
  }, [tiers, archetypes])

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
    return sortByMoodAdjusted(moodWorks, moodRefine, criterionPrefs).map((w) => w.id)
  }, [selectedIds, displayEntries, moodRefine, entries, criterionPrefs])

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
        <ViewModeToolbar
          count={0}
          viewMode={viewMode}
          onChange={writeViewMode}
          tiersEnabled={tiersEnabled}
          tiersAvailable={tierSortEligible}
          onTiersChange={writeTiersEnabled}
        />
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
        <ViewModeToolbar
          count={entries.length}
          viewMode={viewMode}
          onChange={writeViewMode}
          tiersEnabled={tiersEnabled}
          tiersAvailable={tierSortEligible}
          onTiersChange={writeTiersEnabled}
        />
        <RankingCardsView
          entries={entries}
          scoreThresholds={scoreThresholds}
          criterionMoments={criterionMoments}
          highlightWeights={highlightWeights}
          grouped={tiersEnabled}
        />
      </div>
    )
  }

  if (viewMode === "bussola") {
    return (
      <div className="space-y-3">
        <ViewModeToolbar
          count={entries.length}
          viewMode={viewMode}
          onChange={writeViewMode}
          tiersEnabled={tiersEnabled}
          tiersAvailable={tierSortEligible}
          onTiersChange={writeTiersEnabled}
        />
        <BussolaPlane entries={entries} grouped={tiersEnabled} thresholds={scoreThresholds?.expected} />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <ViewModeToolbar
        count={entries.length}
        viewMode={viewMode}
        onChange={writeViewMode}
        tiersEnabled={tiersEnabled}
        tiersAvailable={tierSortEligible}
        onTiersChange={writeTiersEnabled}
      />

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
                const description = criterion?.description ?? col.description ?? null
                const align = col.align ?? "left"
                const forms = headerFormsFor(col)

                let cellContent: ReactNode
                if (col.key === "select") {
                  // Marcar TODAS as visíveis. Sem isto, uma seleção de 40 obras
                  // custa 40 cliques — e as ações em lote existem justamente pra
                  // esse tamanho de seleção.
                  cellContent = (
                    <div className="flex items-center justify-center">
                      <BulkSelectCheckbox
                        ids={visibleIds}
                        selectedSet={selectedSet}
                        onToggle={toggleBlock}
                        label="Selecionar todas as obras visíveis"
                      />
                    </div>
                  )
                } else if (forms) {
                  // Cabeçalho responsivo (full → short → abbrev conforme a largura).
                  cellContent = (
                    <ResponsiveHeaderLabel
                      forms={forms}
                      description={description}
                      align={align}
                      sortable={isSortable}
                      isActive={isActive}
                      sortDir={activeSortDir}
                      onSort={() => sortField && updateSort(sortField)}
                    />
                  )
                } else {
                  // Estruturais (#) e critérios (emoji): rótulo único, sem troca.
                  const fullName = criterion?.name ?? col.configLabel ?? null
                  const showFullName = fullName && fullName !== col.label
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
                  cellContent = <div className={cn("flex items-center pr-3", justify)}>{wrapped}</div>
                }

                return (
                <th
                  key={col.key}
                  className={cn(
                    "group/header relative h-11 select-none text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                    col.key.startsWith("crit_") ? "px-1" : "px-3"
                  )}
                  style={{ textAlign: align }}
                >
                  {cellContent}
                  {/* Os 3 ícones de força só fazem sentido ao lado da coluna que
                      os usa — ensinar uma vez, no cabeçalho, como na antiga Faixas. */}
                  {col.key === "separator" && <SeparatorLegend />}
                  <ResizeHandle
                    columnKey={col.key}
                    onResize={setWidth}
                    startWidth={widths[col.key] ?? DEFAULT_COLUMN_WIDTHS[col.key] ?? 100}
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
                    composition={compositionByStart.get(index)}
                    focusedArchetype={focusedArchetype}
                    onFocusArchetype={toggleArchetype}
                    selectSlot={
                      tierDivider.count >= 2 ? (
                        <BulkSelectCheckbox
                          ids={tierDivider.workIds}
                          selectedSet={selectedSet}
                          onToggle={toggleBlock}
                          label={`Selecionar as ${tierDivider.count} obras do Tier ${tierDivider.tierNumber}`}
                        />
                      ) : undefined
                    }
                  />
                )}
                <tr
                  className={cn(
                    "transition-[background-color,opacity] hover:bg-primary/5 [&>td]:border-b [&>td]:border-border/55 last:[&>td]:border-0",
                    // Apaga em vez de esconder: some a linha e a numeração "#"
                    // passaria a mentir sobre a posição no ranking.
                    focusedArchetype != null && archetypes[index] !== focusedArchetype && "opacity-25",
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        // last:pr-3 = mesmo gap (12px) da 1ª coluna à esquerda: a
                        // última coluna costuma ser um critério (px-1=4px) e ficava colada na borda.
                        "h-14 py-3 align-middle overflow-hidden last:pr-3",
                        col.key.startsWith("crit_") ? "px-1" : "px-3"
                      )}
                      style={{ textAlign: col.align ?? "left" }}
                    >
                      <div className="truncate" style={{ textAlign: col.align ?? "left" }}>
                        {col.key === "select" ? (
                          <Checkbox
                            checked={selectedSet.has(entry.workId)}
                            disabled={!selectedSet.has(entry.workId) && selectedIds.length >= MAX_SELECTION_WORKS}
                            onCheckedChange={() => toggleSelect(entry.workId)}
                            aria-label={`Selecionar ${entry.title}`}
                          />
                        ) : col.key === "separator" ? (
                          // Fora de renderCell porque depende do ÍNDICE (o tier a
                          // que a obra pertence), não só da entry.
                          <SeparatorCell
                            separator={separatorByIndex.get(index) ?? null}
                            value={separatorValue(entry, separatorByIndex.get(index) ?? null)}
                          />
                        ) : (
                          renderCell(entry, col, scoreThresholds, isPaid, null, attrColorMode, criterionPrefs)
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
                  <PublicationStatusBadge statusId={entry.publicationStatusId} hiatusKind={entry.hiatusKind} hiatusKindConfidence={entry.hiatusKindConfidence} publicationStatusNote={entry.publicationStatusNote} />
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

      <CompareSelectionBar
        count={selectedIds.length}
        favoriteCount={favoriteSelectedIds.length}
        onOpen={() => {
          setMoodRefine(null) // comparação manual: sem refino por mood
          setDrawerOpen(true)
        }}
        onClear={clearSelection}
        onFavorite={handleBatchFavorite}
        onUnfavorite={handleBatchUnfavorite}
        onAddToGroup={favoriteGroups ? () => setAddGroupOpen(true) : undefined}
        onRerank={() => batchAi.rerank(selectedIds)}
        onPredictInterest={() => void batchAi.predictInterest(selectedIds)}
        // As duas ações de IA são do plano Pago. Desabilitar SEM motivo lê como
        // botão quebrado — o hint vira o title.
        aiDisabledHint={isPaid ? undefined : "Feature do plano Pago."}
        busy={busy || batchAi.planning}
      />

      <ConfirmDialog
        open={unfavConfirm != null}
        onOpenChange={(o) => !o && setUnfavConfirm(null)}
        title={`Desfavoritar ${favoriteSelectedIds.length} obra${favoriteSelectedIds.length !== 1 ? "s" : ""}?`}
        description={
          unfavConfirm == null
            ? undefined
            : unfavConfirm.works > 0
              ? `${unfavConfirm.works} dela${unfavConfirm.works !== 1 ? "s" : ""} está${unfavConfirm.works !== 1 ? "ão" : ""} em ${unfavConfirm.memberships} grupo${unfavConfirm.memberships !== 1 ? "s" : ""} e vai sair de todos. Refavoritar depois NÃO devolve a obra ao grupo.`
              : "Elas saem dos seus favoritos. Pra voltar, é uma a uma."
        }
        confirmText="Desfavoritar"
        onConfirm={async () => {
          setUnfavConfirm(null)
          await runBatchUnfavorite()
        }}
      />

      {favoriteGroups && (
        <AddToGroupDialog
          open={addGroupOpen}
          onOpenChange={setAddGroupOpen}
          workIds={selectedIds}
          groups={favoriteGroups}
          onDone={clearAfterAction}
        />
      )}

      <MoodRefineDialog
        open={moodDialogOpen}
        onOpenChange={setMoodDialogOpen}
        workCount={moodClusterIds.length}
        onApply={(mood) => openCompareWithMood(mood)}
        onSkip={() => openCompareWithMood(null)}
        hasRanges={criterionPrefs != null && Object.keys(criterionPrefs).length > 0}
      />

      <WorkCompareDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        ids={drawerIds}
        moodRefine={moodRefine}
        onClear={clearSelection}
        onRemoveId={removeSelection}
        scoreThresholds={scoreThresholds}
        criterionPrefs={criterionPrefs}
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

/**
 * Caixa de seleção em MASSA (cabeçalho da tabela e divisor de tier). Três
 * estados, e o terceiro é o que impede a aposta: com parte do bloco marcada ela
 * mostra um traço e o clique COMPLETA a seleção, nunca apaga o que já estava
 * marcado. Só o estado cheio limpa.
 */
function BulkSelectCheckbox({
  ids,
  selectedSet,
  onToggle,
  label,
}: {
  ids: string[]
  selectedSet: Set<string>
  onToggle: (ids: string[], select: boolean) => void
  label: string
}) {
  const selectedHere = ids.filter((id) => selectedSet.has(id)).length
  const state: boolean | "indeterminate" =
    selectedHere === 0 ? false : selectedHere === ids.length ? true : "indeterminate"
  return (
    <Checkbox
      checked={state}
      // Vazio ou parcial → completa; cheio → limpa.
      onCheckedChange={() => onToggle(ids, state !== true)}
      aria-label={label}
    />
  )
}

function ViewModeToolbar({
  count,
  viewMode,
  onChange,
  tiersEnabled,
  tiersAvailable,
  onTiersChange,
}: {
  count: number
  viewMode: ViewMode
  onChange: (mode: ViewMode) => void
  tiersEnabled: boolean
  /** Falso quando a ordenação atual não forma tiers — o switch fica desabilitado. */
  tiersAvailable: boolean
  onTiersChange: (enabled: boolean) => void
}) {
  // ⚠️ Só a LISTA agrupa por tier, e só ela depende de a ordenação formar tiers.
  // Cards e Bússola agrupam por ARQUÉTIPO, que sai das forças da obra e independe
  // da ordenação — desabilitar o controle lá porque o sort é "título" seria
  // proibir um agrupamento que funciona perfeitamente.
  const groupAvailable = viewMode === "list" ? tiersAvailable : true
  const tiersActive = tiersEnabled && groupAvailable
  const groupTitle = !groupAvailable
    ? "Agrupar em tiers só se aplica ao ordenar por Prioridade ou Nota Prevista (decrescente)."
    : viewMode === "list"
      ? "Agrupar em tiers de prioridade equivalente. Traz junto a coluna “O que a separa”."
      : viewMode === "cards"
        ? "Agrupar os cards em prateleiras por tipo de aposta."
        : "Agrupar a lista ao lado do mapa em prateleiras por tipo de aposta."
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">
        {count} obra{count !== 1 ? "s" : ""} no ranking
      </p>
      <div className="flex items-center gap-2">
        {/* Fica em TODA view, desabilitado fora da Lista: um controle que some e
            volta obriga a reencontrar a barra a cada troca de view. */}
        <WorkColumnPicker
          namespace="ranking"
          disabled={viewMode !== "list"}
          disabledTitle="As colunas valem na view Lista."
        />
        <button
              type="button"
              onClick={() => onTiersChange(!tiersEnabled)}
              aria-pressed={tiersEnabled}
              disabled={!groupAvailable}
              title={groupTitle}
              className={cn(
                "inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors",
                tiersActive
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border/70 bg-background/60 text-muted-foreground hover:text-foreground",
                !groupAvailable && "cursor-not-allowed opacity-50 hover:text-muted-foreground",
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Agrupar
              </span>
              <span
                className={cn(
                  "relative h-[18px] w-[34px] flex-none rounded-full transition-colors",
                  tiersActive ? "bg-primary" : "bg-muted-foreground/40",
                )}
              >
                <span
                  className={cn(
                    "absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
                    tiersEnabled && "translate-x-4",
                  )}
                />
              </span>
            </button>
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
          <button
            type="button"
            onClick={() => onChange("bussola")}
            aria-label="Visualizar na Bússola"
            aria-pressed={viewMode === "bussola"}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded px-2 text-xs font-medium transition-colors",
              viewMode === "bussola"
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Compass className="h-3.5 w-3.5" />
            Bússola
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

/** Quantos cards cada prateleira mostra antes do "ver todas". */
const SHELF_PREVIEW = 6

function RankingCardsView({
  entries,
  scoreThresholds,
  criterionMoments,
  highlightWeights,
  grouped,
}: {
  entries: RankingEntry[]
  scoreThresholds: ColumnThresholds | null
  criterionMoments?: CriterionMoments | null
  highlightWeights?: HighlightWeight[] | null
  /** "Agrupar" ligado → prateleiras por tipo de aposta. */
  grouped?: boolean
}) {
  // Arquétipo por PERCENTIL do conjunto exibido — a mesma escolha do divisor de
  // tier e da Bússola. Calcular por prateleira faria "vale o risco" querer dizer
  // coisas diferentes em cada uma.
  const shelves = useMemo(() => {
    if (!grouped) return null
    const archetypes = archetypesOf(entries)
    const byArchetype = new Map<ForceArchetype, RankingEntry[]>()
    for (let i = 0; i < entries.length; i++) {
      const a = archetypes[i]
      if (a == null) continue
      const list = byArchetype.get(a) ?? []
      list.push(entries[i])
      byArchetype.set(a, list)
    }
    // Obra sem NENHUMA das duas forças não tem aposta a nomear; vai para o fim,
    // sem inventar um grupo para ela.
    const unclassified = entries.filter((_, i) => archetypes[i] == null)
    return {
      groups: ARCHETYPE_ORDER.filter((a) => byArchetype.has(a)).map((a) => ({
        archetype: a,
        items: byArchetype.get(a)!,
      })),
      unclassified,
    }
  }, [entries, grouped])

  // 3 colunas no máximo (era 4): com o AdultBadge + as stats, 4/linha ficava espremido
  // e a linha de metadados quebrava. Mais largura → tudo respira e o 18+ não empurra linha.
  const grid = (items: RankingEntry[]) => (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((entry) => (
        <RankingCard
          key={entry.workId}
          entry={entry}
          scoreThresholds={scoreThresholds}
          criterionMoments={criterionMoments}
          highlightWeights={highlightWeights}
        />
      ))}
    </div>
  )

  if (!shelves) return grid(entries)

  return (
    <div className="flex flex-col gap-8">
      {shelves.groups.map(({ archetype, items }) => (
        <CardShelf
          key={archetype}
          archetype={archetype}
          items={items}
          scoreThresholds={scoreThresholds}
          criterionMoments={criterionMoments}
          highlightWeights={highlightWeights}
        />
      ))}
      {shelves.unclassified.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-2 border-b-2 border-border pb-2">
            <h3 className="text-lg font-bold leading-tight tracking-tight text-muted-foreground">
              Sem dados para classificar
            </h3>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums text-muted-foreground">
              {shelves.unclassified.length}
            </span>
          </div>
          {grid(shelves.unclassified)}
        </section>
      )}
    </div>
  )
}

/**
 * Uma prateleira dos Cards. Mostra `SHELF_PREVIEW` e expande sob demanda — o
 * ranking pode ter centenas de obras num grupo só, e a prateleira existe para
 * dizer QUE TIPO de aposta cada bloco é, não para ser um segundo scroll infinito.
 */
function CardShelf({
  archetype,
  items,
  scoreThresholds,
  criterionMoments,
  highlightWeights,
}: {
  archetype: ForceArchetype
  items: RankingEntry[]
  scoreThresholds: ColumnThresholds | null
  criterionMoments?: CriterionMoments | null
  highlightWeights?: HighlightWeight[] | null
}) {
  const [expanded, setExpanded] = useState(false)
  const style = ARCHETYPE_STYLE[archetype]
  const shown = expanded ? items : items.slice(0, SHELF_PREVIEW)

  return (
    <section className="flex flex-col gap-3">
      <div className={cn("flex flex-wrap items-baseline gap-2 border-b-2 pb-2", style.border)}>
        {/* first-letter, não uma segunda string: o rótulo é minúsculo na fonte
            porque também entra em frase no divisor de tier. */}
        <h3 className={cn("text-lg font-bold leading-tight tracking-tight first-letter:uppercase", style.text)}>
          {ARCHETYPE_LABEL[archetype]}
        </h3>
        <span className={cn("rounded px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums", style.chipBg)}>
          {items.length}
        </span>
        <p className="text-[13px] text-muted-foreground">{ARCHETYPE_MEANING[archetype]}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((entry) => (
          <RankingCard
            key={entry.workId}
            entry={entry}
            scoreThresholds={scoreThresholds}
            criterionMoments={criterionMoments}
            highlightWeights={highlightWeights}
          />
        ))}
      </div>

      {items.length > SHELF_PREVIEW && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className={cn("cursor-pointer rounded px-1 py-0.5 text-[13px] font-semibold hover:underline", style.text)}
          >
            {expanded ? "Ver menos" : `Ver as ${items.length} →`}
          </button>
        </div>
      )}
    </section>
  )
}

/** Renderiza a escala de 4 corações a partir da string ♥ (preenchidos = valor, resto esmaecido). */
function heartSet(quality: string, variant: "manual" | "pred"): ReactNode {
  const filled = Math.min(4, Math.max(0, [...quality].length))
  const empty = 4 - filled
  return (
    <span
      className={cn(
        "text-[17px] leading-none tracking-[0.12em]",
        variant === "manual" ? "text-red-500" : "text-orange-500",
      )}
    >
      {"♥".repeat(filled)}
      {empty > 0 && <span className="opacity-25">{"♥".repeat(empty)}</span>}
    </span>
  )
}

/** Interesse na obra: manual (♥ sólido) + previsto (♥ esmaecido + selo IA), sem label. */
function InterestHearts({
  manual,
  manualFromPrediction = false,
  predicted,
  predictedStale,
}: {
  manual: string | null
  /** Manual foi aplicado da previsão (não definido à mão) → selo ✨. */
  manualFromPrediction?: boolean
  predicted: string | null
  predictedStale: boolean
}) {
  if (!manual && !predicted) return null
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" aria-label="Interesse na obra">
      {manual && heartSet(manual, "manual")}
      {manual && manualFromPrediction && <InterestAppliedMark size={13} />}
      {manual && predicted && <span className="h-3.5 w-px bg-border/70" aria-hidden />}
      {predicted && (
        <span className="inline-flex items-center gap-1">
          {heartSet(predicted, "pred")}
          <span
            className={cn(
              "rounded border border-orange-500/40 px-[3px] text-[8px] font-extrabold leading-[1.4] tracking-wide text-orange-500 dark:text-orange-400",
              predictedStale && "opacity-60",
            )}
          >
            IA
          </span>
        </span>
      )}
    </span>
  )
}

function RankingCard({
  entry,
  scoreThresholds,
  criterionMoments,
  highlightWeights,
}: {
  entry: RankingEntry
  scoreThresholds: ColumnThresholds | null
  criterionMoments?: CriterionMoments | null
  highlightWeights?: HighlightWeight[] | null
}) {
  const slug = titleToSlug(entry.title)
  const isTop3 = entry.rank <= 3
  const highlights = useMemo(
    () => criterionHighlights(entry.scores, criterionMoments, highlightWeights),
    [entry.scores, criterionMoments, highlightWeights],
  )

  return (
    <div
      className={cn(
        "group relative flex overflow-hidden rounded-xl border bg-card shadow-sm transition-all",
        "hover:-translate-y-0.5 hover:shadow-md focus-within:-translate-y-0.5",
        rankCardStyles(entry.rank),
      )}
    >
      {/* Link esticado + prévia rica no hover: o MESMO WorkHoverPreview da view Lista
          (via entryToPreview), no lugar do tooltip branco de texto plano. Clicar em qualquer
          lugar do card abre a obra; passar o mouse abre a prévia (interativa, com "Ler mais").
          O coração (FavoriteCell) fica por cima (z-20). */}
      <WorkTitleLink
        workId={entry.workId}
        title={entry.title}
        preview={entryToPreview(entry)}
        previewVariant="compact"
        href={`/titles/${slug}`}
        className="absolute inset-0 z-10 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <span className="sr-only">{entry.title}</span>
      </WorkTitleLink>

      {/* Capa: rank (canto sup-esq) + Nota Prevista (canto sup-dir) */}
      <div className="relative w-[150px] shrink-0 self-stretch overflow-hidden bg-muted/40">
        {entry.coverUrl ? (
          <CoverImage
            url={entry.coverUrl}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full min-h-[150px] w-full items-center justify-center text-muted-foreground">
            <ImageOff className="size-7 opacity-40" />
          </div>
        )}

        <div
          className={cn(
            "absolute left-1.5 top-1.5 inline-flex items-center justify-center rounded-full font-bold tabular-nums",
            isTop3 ? "h-7 min-w-7 px-1.5 text-sm" : "h-6 min-w-6 px-1.5 text-xs",
            rankBadgeStyles(entry.rank),
          )}
          aria-label={`Posição ${entry.rank}`}
        >
          {entry.rank}
        </div>
      </div>

      {/* Corpo */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-2.5 py-3.5">
        <div className="flex items-start justify-between gap-1.5">
          <div className="min-w-0">
            <h3 className="line-clamp-2 min-h-[2.5em] text-[13.5px] font-semibold leading-tight text-foreground group-hover:text-primary">
              {entry.title}
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <PublicationStatusBadge statusId={entry.publicationStatusId} compact className="gap-1 px-1.5 py-0 text-[10px]" hiatusKind={entry.hiatusKind} hiatusKindConfidence={entry.hiatusKindConfidence} publicationStatusNote={entry.publicationStatusNote} />
              {entry.isAdult && <AdultBadge className="px-1.5 py-0 text-[10px]" />}
              {entry.totalChapters != null && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold tabular-nums text-muted-foreground">
                  <BookOpen className="size-3 text-muted-foreground/70" />
                  {entry.totalChapters}
                </span>
              )}
              <InterestHearts
                manual={entry.synopsisQuality}
                manualFromPrediction={entry.synopsisFromPrediction}
                predicted={entry.predictedSynopsisQuality}
                predictedStale={entry.predictedSynopsisStale}
              />
            </div>
          </div>
          {/* Favoritar — acima do link esticado */}
          <div className="relative z-20 shrink-0">
            <FavoriteCell workId={entry.workId} workTitle={entry.title} isFavorite={entry.isFavorite} />
          </div>
        </div>

        {/* Atributos em destaque — ocupam a folga da capa (78 px, medidos) que ficava
            vazia entre o cabeçalho e as notas. Some sozinho quando a obra não tem nada
            acima de 1σ (6,5% do acervo), e aí o card volta ao que era.

            `flex-1 items-center` em vez de deixar os chips colados no cabeçalho: o
            sobrante da capa varia por obra (1, 2 ou 3 chips = 1 ou 2 linhas), e
            ancorar no topo só empurrava o mesmo buraco pra baixo dos chips. Centrado,
            a folga se divide e vira respiro em vez de vazio. */}
        <div className="flex min-h-0 flex-1 items-center">
          <CriterionHighlightChips highlights={highlights} />
        </div>

        {/* Notas de decisão (Prevista + Chance) + stats externos — fixados na base.
            Substituem as barras da Bússola: Avaliação/Alcance eram só reescala de
            Externa (nota×10) e Votos (log), então voltam como números crus. */}
        <CardScores entry={entry} scoreThresholds={scoreThresholds} />
      </div>
    </div>
  )
}

/**
 * Nome CURTO do atributo, só para o chip de destaque do card — os nomes canônicos
 * (`CRITERIA_INFO[slug].name`) vão até "Dinâmica entre Protagonistas" e não cabem em
 * três chips numa linha de ~300 px.
 *
 * ⚠️ É mapa de EXIBIÇÃO, não fonte de verdade: um slug que não esteja aqui cai no
 * nome canônico (truncado pelo CSS) em vez de sumir. Critério novo entra pela DB +
 * `sync-constants` como sempre; isto só encurta o rótulo depois.
 */
const HIGHLIGHT_SHORT_NAME: Record<string, string> = {
  romance: "Romance",
  couple_dynamics: "Casal",
  protagonist: "Protagonista",
  fantasy_nobility: "Fantasia",
  action_adventure: "Ação",
  humor: "Humor",
  drama: "Drama",
  tragedy: "Tragédia",
  adult_content: "18+",
}

/**
 * Chips "atributos em destaque": em que a obra foge do normal do catálogo, em σ.
 *
 * 🔴 A cor diz DIREÇÃO (acima/abaixo do catálogo), nunca valor. Tragédia +1,3σ não é
 * boa nem ruim — é uma característica; pintar de verde/vermelho transformaria "mais
 * trágica que a média" em elogio, que para quem penaliza clima pesado é o oposto da
 * verdade. Quem opina é o ▲/▼, que vem dos PESOS (ver criterion-highlights).
 *
 * O σ vai impresso de propósito: os destaques são escolhidos por LIMIAR e o corte em
 * 3 é de exibição, então o número deixa a margem visível em vez de sugerir que o
 * primeiro chip é "o atributo dominante" — afirmação que o dado não sustenta (a
 * margem entre 1º e 2º é menor que 0,25σ em 46,9% do catálogo).
 */
function CriterionHighlightChips({ highlights }: { highlights: CriterionHighlight[] }) {
  if (highlights.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-1">
      {highlights.map((h) => {
        const info = CRITERIA_INFO[h.slug]
        const nome = HIGHLIGHT_SHORT_NAME[h.slug] ?? info?.name ?? h.slug
        const acima = h.z > 0
        const sigma = `${acima ? "+" : "−"}${Math.abs(h.z).toFixed(1)}σ`
        const direcao = acima ? "acima" : "abaixo"
        const opiniao =
          h.favor === "favor"
            ? " — joga a favor do seu gosto"
            : h.favor === "contra"
              ? " — joga contra o seu gosto"
              : ""
        return (
          <span
            key={h.slug}
            title={`${info?.name ?? nome}: nota ${h.score.toFixed(1)}, ${sigma} (${direcao} da média do catálogo)${opiniao}`}
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-[1px] text-[10.5px] font-medium",
              acima
                ? "border-fuchsia-500/35 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300"
                : "border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
            )}
          >
            {info?.emoji && <span aria-hidden>{info.emoji}</span>}
            <span className="truncate">{nome}</span>
            <span className="font-mono text-[9.5px] font-bold tabular-nums opacity-85">{sigma}</span>
            {h.favor !== "neutro" && (
              <span
                aria-hidden
                className={cn(
                  "text-[9px] leading-none",
                  h.favor === "favor" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400",
                )}
              >
                {h.favor === "favor" ? "▲" : "▼"}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

/** Rótulo minúsculo em caixa alta pros stats do card (trunca em vez de vazar).
 *  Sem tracking pra caber nas 4 colunas estreitas do card. */
function CardStatLabel({ children }: { children: ReactNode }) {
  return (
    <span className="truncate text-[8px] font-bold uppercase text-muted-foreground">{children}</span>
  )
}

/**
 * Rodapé do card do ranking (visualização Cards): Prevista + Chance de gostar
 * lado a lado (os dois números de decisão) e, abaixo, a fileira de stats
 * externos que existia na lista — Externa, Votos, Alinhamento, Veredito IA.
 */
function CardScores({
  entry,
  scoreThresholds,
}: {
  entry: RankingEntry
  scoreThresholds: ColumnThresholds | null
}) {
  const chance = computeWorkForces({
    chanceScore: entry.chanceScore,
    platformAvg: entry.platformAvg,
    totalVotes: entry.totalVotes,
  }).chance
  const veredito = entry.alignmentScore != null ? Math.round(entry.alignmentScore) : null
  const alinhamento =
    entry.personalFitPercentile ?? (entry.personalFit != null ? Math.round(entry.personalFit * 100) : null)
  // Chip da Prevista tinge pela faixa (verde/âmbar/vermelho), igual ao ScoreBadge.
  const prevChipClass =
    entry.expectedScore != null
      ? getSoftScoreColor(entry.expectedScore, scoreThresholds?.expected)
      : "border border-border/60 bg-background/40 text-muted-foreground"

  return (
    <div className="mt-auto flex flex-col gap-1.5">
      {/* As 2 notas de decisão em chips tintados (estilo da proposta A): número
          grande em cima, rótulo embaixo. Prevista tinge pela faixa; Chance em
          violeta. Rótulo centralizado no chip cabe mesmo no card estreito. */}
      <div className="grid grid-cols-2 gap-2">
        <div
          className={cn("flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-center", prevChipClass)}
          title={LABELS.expected_score.tooltip_short}
        >
          {/* Prevista sozinha, ou "Prevista / Real" quando você já avaliou (mesmo
              pareamento do cabeçalho da obra). O chip tinge pela faixa da Prevista. */}
          <span className="font-mono text-base font-extrabold leading-none tabular-nums">
            {entry.expectedScore != null ? entry.expectedScore.toFixed(1) : "—"}
            {entry.expectedIsStub && <span className="ml-0.5 text-[10px] font-normal opacity-60">~</span>}
            {entry.userScore != null && (
              <>
                <span className="mx-1 font-normal opacity-40">/</span>
                {entry.userScore.toFixed(1)}
              </>
            )}
          </span>
          <span className="whitespace-nowrap text-[8.5px] font-bold uppercase tracking-wide text-muted-foreground">
            {entry.userScore != null ? "Prevista / Real" : LABELS.expected_score.short}
          </span>
        </div>
        <div
          className="flex flex-col items-center gap-0.5 rounded-lg border border-violet-500/25 bg-violet-500/[0.12] px-1 py-1.5 text-center text-violet-700 dark:text-violet-300"
          title="Chance de gostar (0–100)"
        >
          <span className="font-mono text-base font-extrabold leading-none tabular-nums">
            {chance == null ? "—" : `${chance}%`}
          </span>
          <span className="text-[8.5px] font-bold uppercase tracking-wide text-muted-foreground">Chance</span>
        </div>
      </div>

      {/* Stats externos (ex-lista) numa linha só: Externa · Votos · Alinhamento
          · Veredito IA. Rótulos curtos + truncate: no card estreito degradam sem
          colidir (min-w-0 evita o overflow que sobrepunha os vizinhos). */}
      <div className="grid grid-cols-4 gap-x-1.5">
        <div className="flex min-w-0 flex-col gap-0.5" title={LABELS.platform_avg.tooltip_short}>
          <CardStatLabel>Externa</CardStatLabel>
          <span className="inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {entry.platformAvg != null && <Star className="size-3 shrink-0 fill-current" />}
            {entry.platformAvg != null ? entry.platformAvg.toFixed(1) : "—"}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5" title={LABELS.total_votes.tooltip_short}>
          <CardStatLabel>{LABELS.total_votes.short}</CardStatLabel>
          <span className="truncate text-xs font-semibold tabular-nums text-foreground">{formatVotes(entry.totalVotes)}</span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5" title={LABELS.personal_fit.tooltip_short}>
          <CardStatLabel>{LABELS.personal_fit.abbrev}</CardStatLabel>
          <span className="text-xs font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
            {alinhamento != null ? `${Math.round(alinhamento)}%` : "—"}
          </span>
        </div>
        <div className="flex min-w-0 flex-col gap-0.5" title={LABELS.alignment_score.tooltip_short}>
          <CardStatLabel>{LABELS.alignment_score.short}</CardStatLabel>
          <span className="inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums text-violet-600 dark:text-violet-400">
            {veredito != null && <Sparkles className="size-3 shrink-0" />}
            {veredito ?? "—"}
          </span>
        </div>
      </div>
    </div>
  )
}

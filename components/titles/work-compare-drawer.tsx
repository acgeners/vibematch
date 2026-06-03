"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GripVertical,
  ImageOff,
  Loader2,
  Minus,
  Plus,
  Rows3,
  Sparkles,
  Trophy,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ScoreBadge, getCriterionColorClass, type ColumnThresholds, type ScoreColorThresholds } from "@/components/ui/score-badge"
import {
  PersonalStatusBadge,
  PublicationStatusBadge,
} from "@/components/ui/status-badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { CRITERION_SLUGS } from "@/types/domain"
import { cn } from "@/lib/utils"
import { CoverImage } from "@/components/ui/cover-image"
import { fetchCompareWorks, type CompareWork } from "@/server/actions/compare"
import { rerankClusterAction } from "@/server/actions/recommendations"
import {
  ColumnPicker,
  type ColumnPickerColumnDef,
  type ColumnPickerConfig,
} from "@/components/ui/column-picker"

const HIDDEN_ROWS_STORAGE_KEY = "compare_hidden_rows_v1"
// v3 → v4: adiciona as linhas "Nota Final" (decision) e "Alinhamento"
// (personal_fit) ao grupo Notas, posicionadas na ordem canônica.
const ROWS_CONFIG_STORAGE_KEY = "compare_rows_config_v4"

interface CompareRowDef {
  key: string
  label: string
}

interface CompareRowGroup {
  id: string
  label: string
  rows: CompareRowDef[]
}

const COMPARE_ROW_GROUPS: CompareRowGroup[] = [
  {
    id: "basico",
    label: "Básico",
    rows: [
      { key: "status", label: "Status" },
      { key: "chapters", label: "Capítulos" },
      { key: "ano", label: "Ano" },
    ],
  },
  {
    id: "notas",
    label: "Notas",
    rows: [
      { key: "score:decision", label: "Nota Final" },
      { key: "score:expectedScore", label: "Nota Prevista" },
      { key: "score:personalFit", label: "Alinhamento" },
      { key: "score:alignmentScore", label: "IA Rk." },
      { key: "score:platformAvg", label: "Média externa" },
      { key: "score:userScore", label: "Pessoal" },
      { key: "score:finalScore", label: "Final (legado)" },
      { key: "score:calcScore", label: "IA (legado)" },
      { key: "score:predictedScore", label: "Pr (legado)" },
    ],
  },
  {
    id: "criterios",
    label: "Critérios",
    rows: CRITERION_SLUGS.map((slug) => ({
      key: `crit:${slug}`,
      label: `${CRITERIA_INFO[slug]?.emoji ?? ""} ${CRITERIA_INFO[slug]?.name ?? slug}`.trim(),
    })),
  },
  {
    id: "outros",
    label: "Outros",
    rows: [{ key: "tags-genres", label: "Gêneros · Tags" }],
  },
]

const ALL_ROW_KEYS = COMPARE_ROW_GROUPS.flatMap((g) => g.rows.map((r) => r.key))

const COMPARE_ROW_GROUP_LABELS: Record<string, string> = Object.fromEntries(
  COMPARE_ROW_GROUPS.map((g) => [g.id, g.label])
)

const COMPARE_ROW_COLUMN_DEFS: ColumnPickerColumnDef[] = COMPARE_ROW_GROUPS.flatMap((g) =>
  g.rows.map((r) => ({ key: r.key, label: r.label, group: g.id }))
)

// Default enxuto (cutover Fase 1.5): visíveis = Capítulos, Ano, Nota Prevista,
// IA Rk, Média externa, todos os atributos e Gêneros/Tags. Escondidos por padrão:
// Status, Pessoal e as notas legadas (Final/IA/Pr).
const DEFAULT_ROWS_CONFIG: ColumnPickerConfig = {
  order: ALL_ROW_KEYS,
  hidden: [
    "status",
    "score:userScore",
    "score:finalScore",
    "score:calcScore",
    "score:predictedScore",
  ],
}

/**
 * Normaliza o config armazenado: descarta chaves desconhecidas, completa
 * rows novas (adicionadas em versões posteriores) no fim mantendo a ordem
 * canônica do grupo.
 */
function normalizeRowsConfig(value: Partial<ColumnPickerConfig> | null | undefined): ColumnPickerConfig {
  const known = new Set(ALL_ROW_KEYS)
  const userOrder = (value?.order ?? []).filter((k) => known.has(k))
  const missing = ALL_ROW_KEYS.filter((k) => !userOrder.includes(k))
  const hidden = (value?.hidden ?? []).filter((k) => known.has(k))
  return { order: [...userOrder, ...missing], hidden }
}

function readRowsConfig(): ColumnPickerConfig {
  if (typeof window === "undefined") return DEFAULT_ROWS_CONFIG
  try {
    const raw = window.localStorage.getItem(ROWS_CONFIG_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ColumnPickerConfig>
      return normalizeRowsConfig(parsed)
    }
    // Migração suave: se tem o storage antigo (só hidden), aproveita.
    const legacy = window.localStorage.getItem(HIDDEN_ROWS_STORAGE_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy)
      if (Array.isArray(parsed)) {
        return normalizeRowsConfig({ order: ALL_ROW_KEYS, hidden: parsed.filter((k): k is string => typeof k === "string") })
      }
    }
    return DEFAULT_ROWS_CONFIG
  } catch {
    return DEFAULT_ROWS_CONFIG
  }
}

function writeRowsConfig(config: ColumnPickerConfig) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(ROWS_CONFIG_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // ignore quota / privacy mode errors
  }
}

interface VerdictItem {
  workId: string
  title: string
  slug: string
  coverUrl: string | null
  alignmentScore: number
  justification: string
}

interface WorkCompareDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ids: string[]
  onClear: () => void
  onRemoveId: (id: string) => void
  scoreThresholds: ColumnThresholds | null
  /** Quando false, o "Desempatar com IA" mostra upsell em vez de rodar (feature Pago). */
  isPaid?: boolean
}

export function WorkCompareDrawer({
  open,
  onOpenChange,
  ids,
  onClear,
  onRemoveId,
  scoreThresholds,
  isPaid = true,
}: WorkCompareDrawerProps) {
  const [works, setWorks] = useState<CompareWork[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffOnly, setDiffOnly] = useState(false)
  const [showBestWorst, setShowBestWorst] = useState(true)
  const [reranking, setReranking] = useState(false)
  // Bump pra forçar o re-fetch das obras após o desempate por IA (repovoar a
  // linha "IA Rk." com os alignment_score recém-computados).
  const [reloadKey, setReloadKey] = useState(0)
  // Veredito do último desempate por IA (popup com 1º/2º/3º + justificativa).
  const [verdict, setVerdict] = useState<VerdictItem[] | null>(null)
  const [rowsConfig, setRowsConfig] = useState<ColumnPickerConfig>(() => readRowsConfig())
  const hiddenRows = useMemo(() => new Set(rowsConfig.hidden), [rowsConfig.hidden])
  
  const [orderedIds, setOrderedIds] = useState<string[]>([])
  const parentIdsSortedKey = useMemo(() => [...ids].sort().join(","), [ids])

  // Espelho do `works` atual, lido dentro do effect de fetch sem precisar
  // adicioná-lo às deps (o que causaria loop de re-fetch).
  const worksRef = useRef<CompareWork[]>([])
  useEffect(() => {
    worksRef.current = works
  }, [works])
  // Último reloadKey já materializado por fetch — distingue "rerank pediu
  // reload" de uma simples mudança de ids.
  const appliedReloadKey = useRef(0)
  // Cada abertura do drawer faz um fetch inicial; resetado ao fechar.
  const fetchedForOpenRef = useRef(false)
  useEffect(() => {
    if (!open) fetchedForOpenRef.current = false
  }, [open])

  // Synchronize orderedIds with parent ids while preserving any custom ordering.
  // Sync de estado a partir de props é intencional aqui (mantém a ordem custom
  // do drag em dia quando a tabela pai é reordenada), por isso a supressão.
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrderedIds((prev) => {
      const filteredPrev = prev.filter((id) => ids.includes(id))
      const newIds = ids.filter((id) => !prev.includes(id))
      return [...filteredPrev, ...newIds]
    })
  }, [ids, open])

  useEffect(() => {
    if (!open || ids.length === 0) return

    // Reconciliação ordem ↔ dados: preserva a ordem custom (drag) e joga ids
    // novos pro fim. Usada tanto no caminho local quanto no de fetch.
    const applyData = (dataById: Map<string, CompareWork>) => {
      setOrderedIds((currentOrder) => {
        const filteredOrder = currentOrder.filter((id) => dataById.has(id))
        const newIds = ids.filter((id) => !currentOrder.includes(id))
        const finalOrder = [...filteredOrder, ...newIds]

        const sortedData = finalOrder
          .map((id) => dataById.get(id))
          .filter((w): w is CompareWork => Boolean(w))

        setWorks(sortedData)
        return finalOrder
      })
    }

    // Remoção/reordenação dentro de uma sessão já carregada: já temos os dados
    // de todos os ids pedidos e não é reload forçado (rerank) nem a primeira
    // carga. Atualiza na hora — sem spinner nem round-trip — pra que o grid e o
    // resumo "Onde diferenciam" reflitam imediatamente os itens exibidos.
    const forcedReload = reloadKey !== appliedReloadKey.current
    const haveAll = ids.every((id) => worksRef.current.some((w) => w.id === id))
    if (fetchedForOpenRef.current && !forcedReload && haveAll) {
      // Só os ids ainda pedidos — `applyData` descarta do finalOrder o que não
      // está no mapa, então isto remove a coluna excluída.
      const idSet = new Set(ids)
      applyData(
        new Map(worksRef.current.filter((w) => idSet.has(w.id)).map((w) => [w.id, w]))
      )
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)
    fetchCompareWorks(ids)
      .then((data) => {
        if (cancelled) return
        fetchedForOpenRef.current = true
        appliedReloadKey.current = reloadKey
        applyData(new Map(data.map((w) => [w.id, w])))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : "Erro ao carregar"
        setError(message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, parentIdsSortedKey, reloadKey])

  const moveColumn = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return
    const nextWorks = [...works]
    const [draggedItem] = nextWorks.splice(fromIndex, 1)
    nextWorks.splice(toIndex, 0, draggedItem)
    setWorks(nextWorks)

    const nextIds = nextWorks.map((w) => w.id)
    setOrderedIds(nextIds)
  }

  const updateRowsConfig = (next: ColumnPickerConfig) => {
    const normalized = normalizeRowsConfig(next)
    setRowsConfig(normalized)
    writeRowsConfig(normalized)
  }

  const resetRows = () => updateRowsConfig(DEFAULT_ROWS_CONFIG)

  // Desempate por IA: roda o re-ranker comparando só as obras do drawer
  // cabeça-a-cabeça (rerankClusterAction), depois re-fetcha pra repovoar a linha
  // "IA Rk." com os scores/justificativas frescos. O destaque "Melhor/pior"
  // marca o vencedor em verde automaticamente.
  const handleRerank = () => {
    if (ids.length < 2 || reranking) return
    setReranking(true)
    rerankClusterAction(ids)
      .then((res) => {
        if (res.error || !res.data) {
          toast.error(res.error ?? "Erro ao desempatar com IA.")
          return
        }
        // Monta o veredito: ordena (já vem desc) e enriquece com título/capa das
        // obras carregadas (estáveis), pra abrir o popup 1º/2º/3º.
        const worksById = new Map(works.map((w) => [w.id, w]))
        const items: VerdictItem[] = res.data.rankings.map((r) => {
          const w = worksById.get(r.workId)
          return {
            workId: r.workId,
            title: w?.title ?? "Obra",
            slug: w?.slug ?? "",
            coverUrl: w?.coverUrl ?? null,
            alignmentScore: r.alignmentScore,
            justification: r.justification,
          }
        })
        setVerdict(items)
        // Re-fetch em paralelo pra atualizar as linhas IA Rk. / Nota Final no fundo.
        setReloadKey((k) => k + 1)
      })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Erro ao desempatar com IA."),
      )
      .finally(() => setReranking(false))
  }

  return (
    <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-screen max-h-screen gap-0 overflow-hidden p-0"
        showCloseButton={false}
      >
        <SheetHeader className="flex flex-row items-center justify-between gap-2 border-b bg-card/80 px-4 py-3">
          <SheetTitle className="text-base">
            Comparar {loading ? ids.length : works.length} obra
            {(loading ? ids.length : works.length) !== 1 ? "s" : ""}
            {!loading && works.length < ids.length && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                ({ids.length - works.length} não carregada
                {ids.length - works.length !== 1 ? "s" : ""})
              </span>
            )}
          </SheetTitle>
          {!loading && works.length >= 2 && (
            <div className="hidden min-w-0 flex-1 items-center justify-center overflow-x-auto px-2 lg:flex">
              <DifferentialsSummary works={works} compact />
            </div>
          )}
          <div className="flex shrink-0 items-center gap-2">
            <ColumnPicker
              columns={COMPARE_ROW_COLUMN_DEFS}
              groupLabels={COMPARE_ROW_GROUP_LABELS}
              config={rowsConfig}
              onChange={updateRowsConfig}
              onReset={resetRows}
              triggerLabel="Linhas"
              triggerIcon={<Rows3 className="h-3.5 w-3.5" />}
            />
            {works.length >= 2 && (
              <Button
                variant={diffOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setDiffOnly((v) => !v)}
                className="h-7 text-xs"
              >
                Só diferenças
              </Button>
            )}
            {works.length >= 2 && (
              <Button
                variant={showBestWorst ? "default" : "outline"}
                size="sm"
                onClick={() => setShowBestWorst((v) => !v)}
                className="h-7 text-xs"
                title="Mostra/oculta o destaque de melhor (verde) e pior (vermelho) por linha"
              >
                Melhor/pior
              </Button>
            )}
            {works.length >= 2 && (
              <Button
                variant="default"
                size="sm"
                onClick={handleRerank}
                disabled={reranking || !isPaid}
                className="h-7 gap-1 text-xs"
                title={
                  isPaid
                    ? "Roda o IA re-rank comparando estas obras entre si e desempata por veredito (IA Rk. + justificativa). Conta uma execução do limite diário."
                    : "Desempate por IA é uma feature do plano Pago."
                }
              >
                {reranking ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {reranking ? "Desempatando…" : isPaid ? "Desempatar com IA" : "Desempatar com IA · Pago"}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onClear} className="h-7 text-xs">
              Limpar
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              className="h-7 w-7"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando comparação…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-destructive">
              {error}
            </div>
          ) : works.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Nenhuma obra selecionada.
            </div>
          ) : (
            <CompareGrid
              works={works}
              onRemoveId={onRemoveId}
              onMoveColumn={moveColumn}
              scoreThresholds={scoreThresholds}
              diffOnly={diffOnly}
              highlightBestWorst={showBestWorst}
              hiddenRows={hiddenRows}
              rowOrder={rowsConfig.order}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>

    <VerdictDialog items={verdict} onClose={() => setVerdict(null)} />
    </>
  )
}

/**
 * Popup do "Desempate por IA": ranking 1º/2º/3º das obras comparadas, com o
 * vencedor destacado (🏆) e a justificativa do LLM por obra. Espelha o visual do
 * "Surpreenda-me" (/ranking). Aberto quando `items` não é null.
 */
function VerdictDialog({
  items,
  onClose,
}: {
  items: VerdictItem[] | null
  onClose: () => void
}) {
  const open = items != null && items.length > 0
  const total = items?.length ?? 0
  // Remonta a lista (resetando a contagem visível pro default) a cada novo
  // veredito — a key muda quando o conjunto/ordem das obras muda.
  const verdictKey = (items ?? []).map((i) => i.workId).join(",")
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="grid max-h-[85vh] grid-rows-[auto_minmax(0,1fr)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-amber-500" />
            Veredito da IA
          </DialogTitle>
          <DialogDescription>
            Comparação cabeça-a-cabeça destas {total} obras. A IA Rk. (0–100)
            ordena o desempate e já entrou na Nota Final de cada uma.
          </DialogDescription>
        </DialogHeader>

        {items && items.length > 0 && <VerdictList key={verdictKey} items={items} />}
      </DialogContent>
    </Dialog>
  )
}

/**
 * Lista do veredito: por padrão mostra o top 3, com um stepper (− / +) pra
 * ajustar manualmente quantas obras exibir, e um atalho "Ver todas". A área
 * de cards rola sozinha quando excede a altura disponível do diálogo.
 */
function VerdictList({ items }: { items: VerdictItem[] }) {
  const [visibleCount, setVisibleCount] = useState(() => Math.min(3, items.length))
  const showControl = items.length > 3
  const shown = items.slice(0, visibleCount)
  const remaining = items.length - visibleCount

  return (
    <div className="flex min-h-0 flex-col gap-2.5">
      {showControl && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            Mostrando top{" "}
            <span className="font-semibold tabular-nums text-foreground">{visibleCount}</span> de{" "}
            {items.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6"
              disabled={visibleCount <= 1}
              onClick={() => setVisibleCount((c) => Math.max(1, c - 1))}
              aria-label="Mostrar menos obras"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-6 w-6"
              disabled={visibleCount >= items.length}
              onClick={() => setVisibleCount((c) => Math.min(items.length, c + 1))}
              aria-label="Mostrar mais obras"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pr-1">
        {shown.map((item, index) => (
          <VerdictCard key={item.workId} item={item} position={index + 1} />
        ))}
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => setVisibleCount(items.length)}
            className="mt-0.5 rounded-md border border-dashed border-border/70 py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            Ver todas as {items.length} obras (+{remaining})
          </button>
        )}
      </div>
    </div>
  )
}

function VerdictCard({ item, position }: { item: VerdictItem; position: number }) {
  const medal = position === 1 ? "🥇" : position === 2 ? "🥈" : position === 3 ? "🥉" : null
  const isWinner = position === 1
  const card = (
    <div
      className={cn(
        "group flex gap-3 rounded-lg border bg-card/60 p-3 transition-colors",
        isWinner
          ? "border-amber-400/60 bg-amber-50/40 dark:bg-amber-500/5"
          : "hover:border-primary/40 hover:bg-card",
      )}
    >
      <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded border bg-muted">
        {item.coverUrl ? (
          <CoverImage
            url={item.coverUrl}
            alt={item.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-4 w-4" />
          </div>
        )}
        <span className="absolute left-0.5 top-0.5 text-base leading-none drop-shadow">
          {medal ?? <span className="rounded bg-background/80 px-1 text-[10px] font-bold tabular-nums">{position}º</span>}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
          <span className="text-muted-foreground">{position}º</span>
          <span className="line-clamp-2 group-hover:underline">{item.title}</span>
          {item.slug && (
            <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </h3>
        <span className="inline-flex w-fit items-center gap-1 rounded-md border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
          IA Rk. {Math.round(item.alignmentScore)}
        </span>
        <p className="text-xs leading-relaxed text-muted-foreground">{item.justification}</p>
      </div>
    </div>
  )
  return item.slug ? (
    <Link href={`/titles/${item.slug}`} target="_blank" rel="noreferrer" className="block">
      {card}
    </Link>
  ) : (
    card
  )
}

/**
 * Identifica os critérios com maior amplitude (max - min) entre as obras
 * comparadas. Útil pra um sumário "O que diferencia" no topo do drawer —
 * o usuário foca direto nos eixos onde as obras de fato divergem.
 */
function getMaxAmplitudeCriteria(
  works: CompareWork[],
  threshold = 1.5
): Array<{ slug: string; max: number; min: number; amplitude: number }> {
  if (works.length < 2) return []
  const results: Array<{ slug: string; max: number; min: number; amplitude: number }> = []
  const slugs = works[0].criteria.map((c) => c.slug)
  for (const slug of slugs) {
    const values = works
      .map((w) => w.criteria.find((c) => c.slug === slug)?.score)
      .filter((v): v is number => v != null)
    if (values.length < 2) continue
    const max = Math.max(...values)
    const min = Math.min(...values)
    const amplitude = max - min
    if (amplitude >= threshold) results.push({ slug, max, min, amplitude })
  }
  results.sort((a, b) => b.amplitude - a.amplitude)
  return results.slice(0, 3)
}

function getUniqueBestWorst(
  works: CompareWork[],
  getValue: (w: CompareWork) => number | null,
  negative = false
): { bestIndex: number | null; worstIndex: number | null } {
  const values = works.map(getValue)
  const valid = values
    .map((v, i) => ({ value: v, index: i }))
    .filter((item): item is { value: number; index: number } => item.value != null)

  if (valid.length < 2) return { bestIndex: null, worstIndex: null }

  const nums = valid.map((item) => item.value)
  const max = Math.max(...nums)
  const min = Math.min(...nums)

  if (Math.abs(max - min) < 0.0001) {
    return { bestIndex: null, worstIndex: null }
  }

  const maxItems = valid.filter((item) => Math.abs(item.value - max) < 0.0001)
  const minItems = valid.filter((item) => Math.abs(item.value - min) < 0.0001)

  const bestItems = negative ? minItems : maxItems
  const worstItems = negative ? maxItems : minItems

  return {
    bestIndex: bestItems.length === 1 ? bestItems[0].index : null,
    worstIndex: worstItems.length === 1 ? worstItems[0].index : null,
  }
}

interface CompareGridProps {
  works: CompareWork[]
  onRemoveId: (id: string) => void
  onMoveColumn?: (fromIndex: number, toIndex: number) => void
  scoreThresholds: ColumnThresholds | null
  diffOnly: boolean
  /** Liga/desliga o destaque visual de melhor (verde) / pior (vermelho) por linha. */
  highlightBestWorst: boolean
  hiddenRows: Set<string>
  /** Ordem das linhas escolhida pelo usuário (lista achatada de keys).
   *  Aplicada às seções iteradas (Notas, Critérios). */
  rowOrder: string[]
}

type SectionKey = "notas" | "criterios" | "tags-generos"

const NEGATIVE_CRITERIA = new Set<string>(["drama", "tragedy"])

/** Reordena `items` pra refletir a posição da sua key em `order`. Items
 *  cuja key não está em `order` vão pro fim mantendo ordem canônica. */
function sortByOrder<T>(items: T[], getKey: (item: T) => string, order: string[]): T[] {
  const index = new Map(order.map((k, i) => [k, i]))
  return [...items].sort((a, b) => {
    const ai = index.get(getKey(a)) ?? Number.MAX_SAFE_INTEGER
    const bi = index.get(getKey(b)) ?? Number.MAX_SAFE_INTEGER
    return ai - bi
  })
}

function CompareGrid({
  works,
  onRemoveId,
  onMoveColumn,
  scoreThresholds,
  diffOnly,
  highlightBestWorst,
  hiddenRows,
  rowOrder,
}: CompareGridProps) {
  const n = works.length
  const [collapsed, setCollapsed] = useState<Set<SectionKey>>(new Set())
  const [draggedOverIndex, setDraggedOverIndex] = useState<number | null>(null)

  const toggleSection = (key: SectionKey) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const isCollapsed = (key: SectionKey) => collapsed.has(key)



  const allEqualScore = (getter: (w: CompareWork) => number | null): boolean => {
    if (works.length < 2) return false
    const values = works.map(getter)
    const first = values[0]
    return values.every(
      (v) =>
        (v == null && first == null) ||
        (v != null && first != null && Math.abs(v - first) < 0.05)
    )
  }
  const allEqual = <T,>(getter: (w: CompareWork) => T): boolean => {
    if (works.length < 2) return false
    const values = works.map(getter)
    return values.every((v) => v === values[0])
  }

  // Per-row visibility: user hide + diff-only filter
  const isRowVisible = (
    key: string,
    diffEqualFn?: () => boolean
  ): boolean => {
    if (hiddenRows.has(key)) return false
    if (diffOnly && diffEqualFn && diffEqualFn()) return false
    return true
  }

  const statusVisible = isRowVisible(
    "status",
    () => allEqual((w) => w.publicationStatusId) && allEqual((w) => w.personalStatusId)
  )
  const chaptersVisible = isRowVisible("chapters", () =>
    allEqual((w) => `${w.chaptersRead ?? "?"}/${w.totalChapters ?? "?"}`)
  )
  const yearVisible = isRowVisible("ano", () => allEqual((w) => w.year))

  const notasRowDefs: Array<{
    key: string
    label: string
    get: (w: CompareWork) => number | null
    stub?: (w: CompareWork) => boolean
    formatScore?: (v: number) => string
    thresholds: ScoreColorThresholds | null
    renderExtra?: (w: CompareWork) => React.ReactNode
    wrapScore?: (node: React.ReactNode, w: CompareWork) => React.ReactNode
    /** Renderiza o número no mesmo box dos atributos (h-7 w-12, font-bold) em
     *  vez do ScoreBadge pequeno — pra dar o mesmo destaque visual. */
    asAttributeBox?: boolean
  }> = [
    {
      // Nota Final (0–10) — número de prioridade que combina Prevista + Alinhamento
      // + IA Rk. Mesmo box colorido dos atributos (escala 0–10).
      key: "score:decision",
      label: "Nota Final",
      get: (w) => w.decisionScore,
      thresholds: scoreThresholds?.final ?? null,
      asAttributeBox: true,
    },
    {
      key: "score:expectedScore",
      label: "Nota Prevista",
      get: (w) => w.expectedScore,
      thresholds: scoreThresholds?.final ?? null,
      asAttributeBox: true,
    },
    {
      // Alinhamento — percentil na biblioteca (fallback pro cru × 100). Escala
      // 0–100%, então formatScore mostra "%" e thresholds=null (sem ScoreBadge).
      key: "score:personalFit",
      label: "Alinhamento",
      get: (w) => w.personalFitPercentile ?? (w.personalFit != null ? w.personalFit * 100 : null),
      thresholds: null,
      formatScore: (v) => `${Math.round(v)}%`,
    },
    {
      key: "score:finalScore",
      label: "Final (legado)",
      get: (w) => w.finalScore,
      thresholds: scoreThresholds?.final ?? null,
    },
    {
      key: "score:calcScore",
      label: "IA (legado)",
      get: (w) => w.calcScore,
      thresholds: scoreThresholds?.calc ?? null,
    },
    {
      key: "score:predictedScore",
      label: "Pr (legado)",
      get: (w) => w.predictedScore,
      stub: (w) => w.predictedIsStub,
      thresholds: scoreThresholds?.predicted ?? null,
    },
    {
      // IA Rk usa escala 0–100 (diferente dos demais 0–10). thresholds=null
      // pula o ScoreBadge colorido por percentil; formatScore mostra inteiro.
      // wrapScore anexa tooltip com a justificativa do LLM no hover do score
      // (em vez de inline, que ocupava muito espaço vertical).
      key: "score:alignmentScore",
      label: "IA Rk.",
      get: (w) => w.alignmentScore,
      thresholds: null,
      formatScore: (v) => `${Math.round(v)}/100`,
      wrapScore: (node, w) =>
        w.alignmentJustification ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2">
                {node}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm whitespace-pre-wrap text-xs leading-relaxed">
              {w.alignmentJustification}
            </TooltipContent>
          </Tooltip>
        ) : node,
    },
    {
      key: "score:userScore",
      label: "Pessoal",
      get: (w) => w.userScore,
      thresholds: null,
    },
    {
      key: "score:platformAvg",
      label: "Média externa",
      get: (w) => w.platformAvg,
      thresholds: null,
      formatScore: (v) => v.toFixed(2),
      renderExtra: (w) =>
        w.totalVotes > 0 ? (
          <span className="text-[10px] text-muted-foreground">
            {formatVotes(w.totalVotes)} votos
          </span>
        ) : null,
    },
  ]

  const orderedNotasRows = sortByOrder(notasRowDefs, (r) => r.key, rowOrder)
  const visibleNotasRows = orderedNotasRows.filter((r) =>
    isRowVisible(r.key, () => allEqualScore(r.get))
  )
  const orderedCritSlugs = sortByOrder([...CRITERION_SLUGS], (slug) => `crit:${slug}`, rowOrder)
  const visibleCritSlugs = orderedCritSlugs.filter((slug) =>
    isRowVisible(`crit:${slug}`, () =>
      allEqualScore((w) => w.criteria.find((c) => c.slug === slug)?.score ?? null)
    )
  )
  const tagsGenresVisible = isRowVisible("tags-genres")

  const showNotasSection = visibleNotasRows.length > 0
  const showCriteriosSection = visibleCritSlugs.length > 0

  const gridStyle: React.CSSProperties = {
    gridTemplateColumns: `120px repeat(${n}, minmax(180px, 240px))`,
  }

  return (
    <TooltipProvider delayDuration={150}>
      {/* O sumário "Onde elas se diferenciam" foi movido pra barra superior
          (renderizado no WorkCompareDrawer, abaixo do header). */}
      <div
        className="mx-auto grid w-fit gap-x-2 px-4 py-4 text-sm sm:px-6"
        style={gridStyle}
      >
        {/* Header */}
        <div className="sticky left-0 top-0 z-30 bg-background/95 backdrop-blur-md" />
        {works.map((w, index) => (
          <div
            key={w.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/plain", String(index))
              e.dataTransfer.effectAllowed = "move"
            }}
            onDragOver={(e) => {
              e.preventDefault()
            }}
            onDragEnter={() => {
              setDraggedOverIndex(index)
            }}
            onDragEnd={() => {
              setDraggedOverIndex(null)
            }}
            onDrop={(e) => {
              e.preventDefault()
              const fromIndex = Number(e.dataTransfer.getData("text/plain"))
              if (!isNaN(fromIndex) && fromIndex !== index) {
                onMoveColumn?.(fromIndex, index)
              }
              setDraggedOverIndex(null)
            }}
            className={cn(
              "sticky top-0 z-20 transition-all duration-200",
              draggedOverIndex === index && "ring-2 ring-dashed ring-primary ring-offset-2 rounded-lg scale-[0.98] opacity-70"
            )}
          >
            <CompareHeaderCell
              work={w}
              onRemove={() => onRemoveId(w.id)}
            />
          </div>
        ))}

        {/* Status */}
        {statusVisible && (
          <>
            <SectionLabel label="Status" />
            {works.map((w) => (
              <CompareCell key={w.id}>
                <div className="flex flex-wrap items-center gap-1">
                  <PublicationStatusBadge statusId={w.publicationStatusId ?? undefined} />
                  <PersonalStatusBadge statusId={w.personalStatusId ?? undefined} />
                </div>
              </CompareCell>
            ))}
          </>
        )}

        {/* Capítulos */}
        {chaptersVisible && (
          <>
            <SectionLabel label="Capítulos" />
            {works.map((w) => (
              <CompareCell key={w.id} horizontalAlign="center">
                <span className="font-mono text-sm">
                  {w.totalChapters ?? "—"}
                </span>
              </CompareCell>
            ))}
          </>
        )}

        {/* Ano */}
        {yearVisible && (
          <>
            <SectionLabel label="Ano" />
            {works.map((w) => (
              <CompareCell key={w.id} horizontalAlign="center">
                <span className="tabular-nums text-xs text-muted-foreground">
                  {w.year ?? "—"}
                </span>
              </CompareCell>
            ))}
          </>
        )}

        {/* Notas */}
        {showNotasSection && (
          <SectionTitle
            label="Notas"
            collapsed={isCollapsed("notas")}
            onToggle={() => toggleSection("notas")}
          />
        )}
         {showNotasSection && !isCollapsed("notas") &&
          visibleNotasRows.map((row) => {
            const { bestIndex, worstIndex } = highlightBestWorst
              ? getUniqueBestWorst(works, row.get)
              : { bestIndex: null, worstIndex: null }
            return (
              <ScoreRow
                key={row.key}
                label={row.label}
                works={works}
                getScore={row.get}
                bestIndex={bestIndex}
                worstIndex={worstIndex}
                thresholds={row.thresholds}
                formatScore={row.formatScore}
                getStub={row.stub}
                renderExtra={row.renderExtra}
                wrapScore={row.wrapScore}
                asAttributeBox={row.asAttributeBox}
              />
            )
          })}

        {/* Critérios */}
        {showCriteriosSection && (
          <SectionTitle
            label="Critérios"
            collapsed={isCollapsed("criterios")}
            onToggle={() => toggleSection("criterios")}
          />
        )}
        {showCriteriosSection && !isCollapsed("criterios") &&
          visibleCritSlugs.map((slug) => {
            const info = CRITERIA_INFO[slug]
            const isNegative = slug === "drama" || slug === "tragedy"
            const { bestIndex, worstIndex } = highlightBestWorst
              ? getUniqueBestWorst(
                  works,
                  (w) => w.criteria.find((c) => c.slug === slug)?.score ?? null,
                  isNegative
                )
              : { bestIndex: null, worstIndex: null }
            return (
              <CriterionRow
                key={slug}
                slug={slug}
                label={info.name}
                emoji={info.emoji}
                works={works}
                bestIndex={bestIndex}
                worstIndex={worstIndex}
                thresholds={scoreThresholds?.criteria?.[slug] ?? null}
              />
            )
          })}

        {/* Gêneros · Tags */}
        {tagsGenresVisible && (
          <SectionTitle
            label="Gêneros · Tags"
            collapsed={isCollapsed("tags-generos")}
            onToggle={() => toggleSection("tags-generos")}
          />
        )}
        {tagsGenresVisible && !isCollapsed("tags-generos") && (
          <>
            <SectionLabel label="" />
            {works.map((w) => (
              <CompareCell key={w.id} verticalAlign="top">
                <GenresTagsCell genres={w.genres} tags={w.tags} />
              </CompareCell>
            ))}
          </>
        )}
      </div>
    </TooltipProvider>
  )
}

function DifferentialsSummary({ works, compact = false }: { works: CompareWork[]; compact?: boolean }) {
  const diffs = getMaxAmplitudeCriteria(works)
  if (diffs.length === 0) return null
  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <span className="shrink-0 font-semibold uppercase tracking-wide text-muted-foreground">
          Onde diferenciam:
        </span>
        {diffs.map((d) => {
          const info = CRITERIA_INFO[d.slug]
          return (
            <span
              key={d.slug}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300/40 bg-background/60 px-1.5 py-0.5"
              title={`${info?.name ?? d.slug}: ${d.min.toFixed(1)} → ${d.max.toFixed(1)}`}
            >
              <span>{info?.emoji}</span>
              <span className="font-medium">{info?.name ?? d.slug}</span>
              <span className="font-mono text-amber-700 dark:text-amber-300">Δ{d.amplitude.toFixed(1)}</span>
            </span>
          )
        })}
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-amber-300/40 bg-amber-50/40 p-3 dark:bg-amber-500/5">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Onde elas se diferenciam
        </span>
        <span className="text-[10px] text-muted-foreground">
          critérios com pelo menos 1.5 ponto de diferença entre maior e menor nota
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {diffs.map((d) => {
          const info = CRITERIA_INFO[d.slug]
          return (
            <div
              key={d.slug}
              className="flex flex-col gap-0.5 rounded-md border border-amber-300/40 bg-background/60 px-2.5 py-1.5 text-xs"
              title={info?.description ?? undefined}
            >
              <div className="flex items-center gap-1.5">
                <span>{info?.emoji}</span>
                <span className="font-medium">{info?.name ?? d.slug}</span>
                <span className="ml-1 rounded-sm bg-amber-200/60 px-1 font-mono text-[10px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  diferença {d.amplitude.toFixed(1)}
                </span>
              </div>
              <div className="font-mono text-[11px] text-muted-foreground">
                menor {d.min.toFixed(1)}
                <span className="mx-1.5 opacity-60">→</span>
                maior {d.max.toFixed(1)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CompareHeaderCell({
  work,
  onRemove,
}: {
  work: CompareWork
  onRemove: () => void
}) {
  return (
    <div className="relative flex flex-col gap-2.5 rounded-lg border border-border/80 bg-card/95 backdrop-blur-md p-2.5 shadow-sm transition-all hover:bg-card">
      {/* Top Actions Row: Drag handle & Action buttons */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2 text-muted-foreground select-none">
        {/* Drag handle */}
        <div 
          className="flex items-center gap-1 cursor-grab active:cursor-grabbing hover:text-foreground transition-colors"
          title="Arraste para reordenar"
        >
          <GripVertical className="h-3.5 w-3.5" />
          <span className="text-[10px] font-semibold uppercase tracking-wider">Mover</span>
        </div>

        {/* Action buttons (External link & Remove) */}
        <div className="flex items-center gap-1">
          <Link
            href={`/titles/${work.slug}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Abrir página da obra"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border/40 bg-background/50 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-foreground hover:border-primary/40"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remover da comparação"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border/40 bg-background/50 text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground hover:border-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Details Row (Cover + Title + Synopsis) */}
      <div className="flex gap-2.5">
        <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-md border bg-muted/40">
          {work.coverUrl ? (
            <CoverImage
              url={work.coverUrl}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-muted-foreground">
              <ImageOff className="h-5 w-5 opacity-40" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 flex flex-col justify-between">
          <Link
            href={`/titles/${work.slug}`}
            target="_blank"
            rel="noreferrer"
            className="block text-xs font-semibold leading-snug hover:underline text-foreground hover:text-primary"
          >
            <span className="line-clamp-2">{work.title}</span>
          </Link>
          <SynopsisButton
            synopsis={work.synopsis}
            synopsisQuality={work.synopsisQuality}
          />
        </div>
      </div>
    </div>
  )
}

function SynopsisButton({
  synopsis,
  synopsisQuality,
}: {
  synopsis: string | null
  synopsisQuality: string | null
}) {
  if (!synopsis) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="mt-2 inline-flex h-6 cursor-not-allowed items-center gap-1 rounded-md border border-dashed bg-background/40 px-2 text-[11px] text-muted-foreground/60"
            aria-disabled="true"
          >
            <BookOpen className="h-3 w-3" />
            Sinopse
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Sem sinopse
        </TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="mt-2 inline-flex flex-col items-start gap-0 rounded-md border bg-background/60 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-background hover:text-foreground"
        >
          <span className="inline-flex items-center gap-1">
            <BookOpen className="h-3 w-3" />
            Sinopse
          </span>
          {synopsisQuality && (
            <span className="text-rose-600 leading-tight">{synopsisQuality}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        portalled={false}
        className="max-w-sm space-y-2 p-3 text-sm"
      >
        {synopsisQuality && (
          <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-1.5 text-[10px] font-semibold text-rose-700">
            Interesse: {synopsisQuality}
          </span>
        )}
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
          {synopsis}
        </p>
      </PopoverContent>
    </Popover>
  )
}

function GenresTagsCell({
  genres,
  tags,
}: {
  genres: string[]
  tags: Array<{ slug: string; name: string; groupId: string | null; groupName: string | null; subGroupName?: string | null }>
}) {
  const total = genres.length + tags.length
  if (total === 0) {
    return <span className="text-xs italic text-muted-foreground">—</span>
  }
  const VISIBLE = 5
  const visibleGenres = genres.slice(0, VISIBLE)
  const remainingForTags = Math.max(0, VISIBLE - visibleGenres.length)
  const visibleTags = tags.slice(0, remainingForTags)
  const remaining = total - visibleGenres.length - visibleTags.length

  const groupedTags = (() => {
    const groups = new Map<string, typeof tags>()
    for (const tag of tags) {
      const label = tag.groupName ?? "Sem grupo"
      const list = groups.get(label) ?? []
      list.push(tag)
      groups.set(label, list)
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === "Sem grupo") return 1
      if (b === "Sem grupo") return -1
      return a.localeCompare(b)
    })
  })()

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visibleGenres.map((g) => (
        <Badge
          key={`g:${g}`}
          variant="secondary"
          className="h-5 py-0 text-[10px] font-normal"
        >
          {g}
        </Badge>
      ))}
      {visibleTags.map((t) => (
        <Badge
          key={`t:${t.slug}`}
          variant="outline"
          className="h-5 py-0 text-[10px] font-normal"
        >
          {t.name}
        </Badge>
      ))}
      {remaining > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-5 items-center rounded-full border border-dashed border-border/70 bg-background/40 px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              +{remaining} ver
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            portalled={false}
            className="max-h-[60vh] w-80 max-w-[90vw] space-y-3 overflow-y-auto p-3"
          >
            {genres.length > 0 && (
              <div>
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Gêneros{" "}
                  <span className="text-muted-foreground/60">({genres.length})</span>
                </p>
                <div className="flex flex-wrap gap-1">
                  {genres.map((g) => (
                    <Badge
                      key={`g:${g}`}
                      variant="secondary"
                      className="h-5 py-0 text-[10px] font-normal"
                    >
                      {g}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
            {groupedTags.map(([groupName, groupTags]) => {
              // Split into collapsible sub-group sections when the group has any.
              const subSections = groupTags.some((t) => t.subGroupName)
                ? (() => {
                    const bySub = new Map<string, typeof groupTags>()
                    const ungrouped: typeof groupTags = []
                    for (const t of groupTags) {
                      if (t.subGroupName) {
                        const arr = bySub.get(t.subGroupName) ?? []
                        arr.push(t)
                        bySub.set(t.subGroupName, arr)
                      } else ungrouped.push(t)
                    }
                    const out = [...bySub.entries()]
                      .map(([name, tgs]) => ({ name, tags: tgs }))
                      .sort((a, b) => a.name.localeCompare(b.name))
                    if (ungrouped.length) out.push({ name: "Outras", tags: ungrouped })
                    return out
                  })()
                : null
              return (
                <div key={groupName}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {groupName}{" "}
                    <span className="text-muted-foreground/60">({groupTags.length})</span>
                  </p>
                  {subSections ? (
                    <div className="space-y-1">
                      {subSections.map((sg) => (
                        <details key={sg.name} className="group">
                          <summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] font-medium text-muted-foreground">
                            <ChevronDown className="h-2.5 w-2.5 transition-transform group-open:rotate-180" />
                            {sg.name}{" "}
                            <span className="text-muted-foreground/60">({sg.tags.length})</span>
                          </summary>
                          <div className="mt-1 flex flex-wrap gap-1 pl-3.5">
                            {sg.tags.map((t) => (
                              <Badge key={`t:${t.slug}`} variant="outline" className="h-5 py-0 text-[10px] font-normal">
                                {t.name}
                              </Badge>
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {groupTags.map((t) => (
                        <Badge
                          key={`t:${t.slug}`}
                          variant="outline"
                          className="h-5 py-0 text-[10px] font-normal"
                        >
                          {t.name}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="sticky left-0 z-10 flex items-center bg-background text-xs font-medium text-muted-foreground">
      {label}
    </div>
  )
}

function SectionTitle({
  label,
  collapsed,
  onToggle,
}: {
  label: string
  collapsed: boolean
  onToggle: () => void
}) {
  return (
    <div className="col-span-full mt-4 mb-1 border-t bg-background pt-3">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="sticky left-0 inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            collapsed && "-rotate-90"
          )}
        />
        <span>{label}</span>
      </button>
    </div>
  )
}

interface CompareCellProps {
  children: React.ReactNode
  highlightVariant?: "best" | "worst"
  verticalAlign?: "center" | "top"
  horizontalAlign?: "center" | "left"
}

function CompareCell({
  children,
  highlightVariant,
  verticalAlign = "center",
  horizontalAlign = "left",
}: CompareCellProps) {
  return (
    <div
      className={cn(
        "flex min-h-[2.25rem] rounded-md border bg-card/30 px-2.5 py-1.5 transition-all duration-200 hover:bg-card/50",
        verticalAlign === "top" ? "items-start" : "items-center",
        horizontalAlign === "center" ? "justify-center" : "justify-start",
        !highlightVariant && "border-border/30",
        highlightVariant === "best" && "!bg-emerald-500/5 dark:!bg-emerald-500/10 !border-emerald-500/30 dark:!border-emerald-400/40 shadow-sm",
        highlightVariant === "worst" && "!bg-rose-500/5 dark:!bg-rose-500/10 !border-rose-500/25 dark:!border-rose-400/30 shadow-sm"
      )}
    >
      {children}
    </div>
  )
}

interface ScoreRowProps {
  label: string
  works: CompareWork[]
  getScore: (w: CompareWork) => number | null
  bestIndex: number | null
  worstIndex: number | null
  thresholds: ScoreColorThresholds | null
  formatScore?: (v: number) => string
  getStub?: (w: CompareWork) => boolean
  renderExtra?: (w: CompareWork) => React.ReactNode
  /** Quando definido, envolve o elemento do score com este wrapper — útil
   *  pra anexar tooltip/popover (ex.: justificativa do IA Rk no hover). */
  wrapScore?: (node: React.ReactNode, w: CompareWork) => React.ReactNode
  /** Renderiza o número no mesmo box dos atributos (CriterionRow) em vez do
   *  ScoreBadge pequeno — usado por Nota Final / Nota Prevista. */
  asAttributeBox?: boolean
}

function ScoreRow({
  label,
  works,
  getScore,
  bestIndex,
  worstIndex,
  thresholds,
  formatScore,
  getStub,
  renderExtra,
  wrapScore,
  asAttributeBox,
}: ScoreRowProps) {
  return (
    <>
      <SectionLabel label={label} />
      {works.map((w, index) => {
        const score = getScore(w)
        const variant =
          index === bestIndex ? "best" : index === worstIndex ? "worst" : undefined
        const baseScoreNode = formatScore && score != null ? (
          <span className="font-mono text-sm font-semibold">
            {formatScore(score)}
          </span>
        ) : asAttributeBox ? (
          // Mesmo box dos atributos (CriterionRow): escala 0–10 positiva, então
          // passa um slug não-negativo pro getCriterionColorClass.
          score == null ? (
            <span className="font-mono text-sm text-muted-foreground">—</span>
          ) : (
            <span
              className={cn(
                "grid h-7 w-12 place-items-center rounded-md font-mono text-sm font-bold",
                getCriterionColorClass(score, "decision", thresholds)
              )}
            >
              {score.toFixed(1)}
            </span>
          )
        ) : (
          <ScoreBadge
            score={score}
            size="sm"
            thresholds={thresholds}
            showStub={getStub?.(w) ?? false}
          />
        )
        const scoreNode = wrapScore ? wrapScore(baseScoreNode, w) : baseScoreNode
        return (
          <CompareCell key={w.id} highlightVariant={variant} horizontalAlign="center">
            <div className="flex items-baseline gap-2">
              {scoreNode}
              {renderExtra?.(w)}
            </div>
          </CompareCell>
        )
      })}
    </>
  )
}

interface CriterionRowProps {
  slug: string
  label: string
  emoji: string
  works: CompareWork[]
  bestIndex: number | null
  worstIndex: number | null
  thresholds: ScoreColorThresholds | null
}

function CriterionRow({ slug, label, emoji, works, bestIndex, worstIndex, thresholds }: CriterionRowProps) {
  return (
    <>
      <div className="sticky left-0 z-10 flex items-center gap-1.5 bg-background text-xs text-muted-foreground">
        <span aria-hidden className="text-base">
          {emoji}
        </span>
        <span className="truncate">{label}</span>
      </div>
      {works.map((w, index) => {
        const entry = w.criteria.find((c) => c.slug === slug)
        const score = entry?.score ?? null
        const justification = entry?.aiJustification ?? null
        const variant =
          index === bestIndex ? "best" : index === worstIndex ? "worst" : undefined
        return (
          <CompareCell key={w.id} highlightVariant={variant} horizontalAlign="center">
            <div className="flex items-center gap-2">
              {score == null ? (
                <span className="font-mono text-sm text-muted-foreground">—</span>
              ) : (
                <span
                  className={cn(
                    "grid h-7 w-12 place-items-center rounded-md font-mono text-sm font-bold",
                    getCriterionColorClass(score, slug, thresholds)
                  )}
                >
                  {score.toFixed(1)}
                </span>
              )}
              {justification && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Ver justificativa da IA"
                      className="inline-flex items-center justify-center h-6 w-6 rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-violet-500 dark:text-violet-400" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    className="max-w-xs text-xs leading-relaxed"
                  >
                    {justification}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </CompareCell>
        )
      })}
    </>
  )
}



function formatVotes(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`
  return String(count)
}

"use client"

import { useState, useMemo, useTransition, useEffect, useRef } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { toast } from "sonner"
import { runTask, setTaskProgress } from "@/lib/tasks-store"
import { useAppTasks } from "@/components/tasks/use-app-tasks"
import {
  RefreshCw,
  Loader2,
  BookOpen,
  Clock,
  CalendarClock,
  ExternalLink,
  AlertCircle,
  ArrowDownUp,
  Check,
  CheckCheck,
  BookOpenCheck,
  RotateCw,
  Plus,
  Minus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  PauseCircle,
  Archive,
  CalendarDays,
  List,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { CoverImage } from "@/components/ui/cover-image"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { PublicationStatusBadge } from "@/components/ui/status-badge"
import { WorkContentChip } from "@/components/ui/work-content-chip"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, selectedOptionLabel } from "@/components/ui/select"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"
import {
  isCancelledPublicationStatus,
  isConcludedPublicationStatus,
  isHiatusPublicationStatus,
  personalStatusNameBySlugOrThrow,
} from "@/lib/constants/status-lookups"
import { cn } from "@/lib/utils"
import { formatRelativeDate, formatPredictedDate, formatRelativeDateTime } from "@/lib/date-utils"
import { differenceInCalendarDays, startOfMonth, addMonths, format } from "date-fns"
import {
  BEHIND_PCT,
  CONTINUE_PCT,
  NEAR_CHAPTERS,
  SILENT_RELEASE_DAYS,
  STALE_DAYS,
  STALLED_DAYS,
  classifyCompleted,
  classifyOngoing,
  daysSince,
  hiatusBand,
  recencyDate,
} from "@/lib/reading/pace-bands"
import type { CompletedBand, OngoingBand, PaceInput } from "@/lib/reading/pace-bands"
import { ptBR } from "date-fns/locale"
import { checkReadingUpdates, type ReadingUpdateResult } from "@/server/actions/reading"
import { setChaptersRead, setReadingStatusForWorks, archiveWork } from "@/server/actions/works"
import { ReadingCalendar, CalendarLegend } from "@/components/reading/reading-calendar"
import {
  ReadingActiveFilters,
  ReadingFilterEcho,
  ReadingFiltersButton,
  ReadingFiltersPanel,
} from "@/components/reading/reading-filters-panel"
import {
  activeReadingFilterCount,
  clearedReadingFilterParams,
  matchesReadingFilters,
  parseReadingFilters,
} from "@/lib/reading/reading-filters"
import type { ReadingFilters } from "@/lib/reading/reading-filters"
import { writeCollapsedBandsCookie, writeReadingViewCookie } from "@/lib/reading-view-preference"
import type { ReadingView } from "@/lib/reading-view-preference"
import type { ReadingWork } from "@/server/queries/reading"

type SortKey = "last_read" | "released" | "predicted" | "progress"
type SectionKey = "ongoing" | "completed" | "others"

/**
 * "Verificar atualizações" é tarefa DURÁVEL: ela grava `total_chapters`, o status de
 * publicação e as datas de capítulo enquanto roda. Pela régua das duas cores, isso é
 * AZUL — indicador global, "pode navegar" — e não um spinner preso no botão. Estava
 * num `useTransition` local, que some na navegação e não conta nada; com ~40s de
 * duração, isso é justamente a informação que falta.
 *
 * ⚠️ O que sobrevive à navegação é o que foi PERSISTIDO (capítulos, status, datas), não
 * o realce de "capítulo novo" desta sessão — esse mora em `results`, que é estado de
 * componente. Sair e voltar mostra os totais atualizados sem os anéis; é aceito, e é a
 * razão de a faixa do topo não ser a única forma de ver a novidade.
 */
const CHECK_TASK_ID = "reading-check"

/**
 * Obras por rodada. O contador do card precisa de alguém que ITERE — o `runTask` não
 * conta sozinho —, então a checagem vai em fatias e cada uma reporta o andamento.
 *
 * ⚠️ Múltiplo do teto do servidor (`CHECK_CONCURRENCY = 3` em `server/actions/reading.ts`):
 * fatia menor deixa slot ocioso e fatia quebrada termina cada rodada com o pool pela
 * metade. Duas rodadas por fatia dão passo de ~5–7s — fino o bastante pra barra andar,
 * grosso o bastante pra não pagar ida-e-volta de server action por obra.
 */
const CHECK_CHUNK = 6

// Rótulo PT curto pros status que a checagem pode APLICAR (transições de fim/hiato).
const APPLIED_STATUS_LABEL: Record<string, string> = {
  Completed: "Completo",
  Hiatus: "Hiato",
  Cancelled: "Cancelado",
}

const READ_FILTER_OPTIONS: Array<[value: string, label: string]> = [
  ["all", "Leitura: todas"],
  ["pending", "Com cap. pra ler"],
  ["uptodate", "Em dia"],
]

const SORT_LABELS: Record<SortKey, string> = {
  last_read: "Última leitura",
  released: "Último lançamento",
  predicted: "Próximo previsto",
  progress: "% lido",
}

const SECTIONS: Record<
  SectionKey,
  { label: string; dotClass: string; hint: string }
> = {
  ongoing: {
    label: "Em andamento",
    dotClass: "bg-amber-500",
    hint: "publicação ativa — você espera capítulos novos",
  },
  completed: {
    label: "Concluídas",
    dotClass: "bg-emerald-500",
    hint: "a publicação terminou — dá pra maratonar ou decidir",
  },
  others: {
    label: "Outras",
    dotClass: "bg-slate-500",
    hint: "publicação parada, cancelada ou sem status",
  },
}

const SECTION_ORDER: readonly SectionKey[] = ["ongoing", "completed", "others"]

/**
 * Conta capítulos como inteiros: cada decimal (ex.: 129.7) é 1 capítulo inteiro,
 * então arredonda pra cima. O `toFixed(3)` mata o ruído de ponto flutuante
 * (129.7 − 121 = 8.699999999999989 → 9).
 */
function wholeChapters(n: number): number {
  return Math.max(0, Math.ceil(Number(n.toFixed(3))))
}

/** Último capítulo lançado conhecido: contagem externa pós-check, senão o total salvo. */
function latestOf(w: ReadingWork, result: ReadingUpdateResult | undefined): number | null {
  return result?.latestExternal ?? w.totalChapters
}

/** Quantos capítulos novos a checagem achou (badge "+N novo"); mínimo 1 quando `hasNew`. */
function newChapterCount(result: ReadingUpdateResult | undefined): number {
  return result?.delta != null ? Math.max(1, wholeChapters(result.delta)) : 1
}

/**
 * Quantos capítulos lançados ainda não foram lidos. Preferência: contagem EXATA da
 * lista real (mangago, pós-check), mas só enquanto `read` for o valor salvo — depois
 * de uma edição in-loco ela fica velha e recomputamos por `lançado − lido`. `null` quando
 * não dá pra saber.
 */
function pendingOf(
  w: ReadingWork,
  result: ReadingUpdateResult | undefined,
  read: number,
): number | null {
  if (result?.unreadCount != null && read === (w.chaptersRead ?? 0)) return result.unreadCount
  const lancado = latestOf(w, result)
  if (lancado == null) return null
  return wholeChapters(lancado - read)
}

/** Fração lida (0–1): lido / lançado. `null` quando não há total conhecido. */
function progressOf(w: ReadingWork, result: ReadingUpdateResult | undefined): number | null {
  const total = latestOf(w, result)
  if (total == null || total <= 0) return null
  return Math.min(1, Math.max(0, (w.chaptersRead ?? 0) / total))
}

/** Config visual compartilhada por qualquer banda (ritmo ou triagem). */
type BandConfig = { label: string; hint: string; bar: string; progress: string; chip: string }

// ─────────────────────────────────────────────────────────────────────────────
// TAXONOMIA A — RITMO (só seção "Em andamento" / publicação Ongoing).
// 6 bandas cruzando % lido × recência (STALE_DAYS) + hiato de publicação. O % dirige a
// maior parte; a recência separa "lendo agora" de "esfriou". A ORDEM DE EXIBIÇÃO é o pedido
// do usuário, não o gradiente de %.
// ─────────────────────────────────────────────────────────────────────────────

// A régua e os limiares moram em `lib/reading/pace-bands.ts` — a home usa a MESMA pra escolher o
// destaque "Continue lendo". Os textos de cada grupo derivam das constantes de lá: escrever "7" ou
// "30 dias" aqui deixaria a tela explicando uma regra que não é a que roda.
type ReadingState = OngoingBand

const READING_STATE_ORDER: readonly ReadingState[] = ["onpace", "uptodate", "catching", "slowing", "quiet", "behind"]

const READING_STATE_CONFIG: Record<ReadingState, BandConfig> = {
  onpace: {
    label: "Acompanhando",
    hint: `faltam até ${NEAR_CHAPTERS} capítulos e você leu há menos de ${STALE_DAYS} dias`,
    bar: "bg-lime-500",
    progress: "bg-lime-500",
    chip: "border-lime-500/30 bg-lime-500/15 text-lime-600 dark:text-lime-400",
  },
  uptodate: {
    label: "Em dia",
    hint: "você leu tudo o que saiu",
    bar: "bg-emerald-500",
    progress: "bg-emerald-500",
    chip: "border-emerald-500/30 text-emerald-600 dark:text-emerald-400",
  },
  catching: {
    label: "Alcançando",
    hint: `faltam mais de ${NEAR_CHAPTERS} capítulos e você leu há menos de ${STALE_DAYS} dias`,
    bar: "bg-amber-500",
    progress: "bg-amber-500",
    chip: "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400",
  },
  slowing: {
    label: "Desacelerando",
    hint: `faltam até ${NEAR_CHAPTERS} e você não lê há ${STALE_DAYS} dias ou mais`,
    bar: "bg-orange-500",
    progress: "bg-orange-500",
    chip: "border-orange-500/30 bg-orange-500/15 text-orange-600 dark:text-orange-400",
  },
  quiet: {
    label: "Sem capítulo novo",
    hint: `você leu tudo e a obra não lança há ${SILENT_RELEASE_DAYS} dias ou mais`,
    bar: "bg-violet-500",
    progress: "bg-violet-500",
    chip: "border-violet-500/30 bg-violet-500/15 text-violet-600 dark:text-violet-400",
  },
  behind: {
    label: "Atrasado",
    hint: `faltam mais de ${NEAR_CHAPTERS} e você não lê há ${STALE_DAYS} dias ou mais`,
    bar: "bg-rose-500",
    progress: "bg-rose-500",
    chip: "border-rose-500/30 bg-rose-500/15 text-rose-600 dark:text-rose-400",
  },
}

/**
 * Traduz o par (obra, resultado da checagem em voo) para a régua de `pace-bands`. A checagem pode
 * ter trazido um total e uma data de lançamento mais novos que os gravados.
 */
function paceInputOf(w: ReadingWork, result: ReadingUpdateResult | undefined): PaceInput {
  return {
    chaptersRead: w.chaptersRead,
    totalChapters: latestOf(w, result),
    pending: pendingOf(w, result, w.chaptersRead ?? 0),
    lastReadAt: w.lastReadAt,
    lastTouchedAt: w.lastTouchedAt,
    lastReleasedAt: result?.releasedAt ?? w.lastChapterReleasedAt,
    publicationHiatus: false,
  }
}

/** Grupo da seção "Em andamento". Obra em hiato de publicação mora em "Outras", por motivo. */
function classifyReadingState(w: ReadingWork, result: ReadingUpdateResult | undefined): ReadingState {
  return classifyOngoing(paceInputOf(w, result))
}

// ─────────────────────────────────────────────────────────────────────────────
// TAXONOMIA B — Concluídas. A pergunta é "vou terminar?", e a distância também é em capítulos.
// ─────────────────────────────────────────────────────────────────────────────

type TriageState = CompletedBand

const TRIAGE_STATE_ORDER: readonly TriageState[] = ["finish", "near", "continuar", "definir", "parado"]

const TRIAGE_STATE_CONFIG: Record<TriageState, BandConfig> = {
  finish: {
    label: "Lidas até o fim",
    hint: "você leu tudo — falta só marcar como terminada",
    bar: "bg-emerald-500",
    progress: "bg-emerald-500",
    chip: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  },
  near: {
    label: "Quase no fim",
    hint: `faltam até ${NEAR_CHAPTERS} capítulos`,
    bar: "bg-lime-500",
    progress: "bg-lime-500",
    chip: "border-lime-500/30 bg-lime-500/15 text-lime-600 dark:text-lime-400",
  },
  continuar: {
    label: "Continuar",
    hint: `faltam mais de ${NEAR_CHAPTERS}, mais de ${CONTINUE_PCT * 100}% lido, leu há menos de ${STALLED_DAYS} dias`,
    bar: "bg-sky-500",
    progress: "bg-sky-500",
    chip: "border-sky-500/30 bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
  definir: {
    label: "Definir",
    hint: `faltam mais de ${NEAR_CHAPTERS}, até ${CONTINUE_PCT * 100}% lido, leu há menos de ${STALLED_DAYS} dias`,
    bar: "bg-indigo-500",
    progress: "bg-indigo-500",
    chip: "border-indigo-500/30 bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
  },
  parado: {
    label: "Parado",
    hint: `faltam mais de ${NEAR_CHAPTERS} e você não lê há ${STALLED_DAYS} dias ou mais`,
    bar: "bg-slate-500",
    progress: "bg-slate-500",
    chip: "border-slate-500/30 bg-slate-500/15 text-slate-600 dark:text-slate-400",
  },
}

function classifyTriageState(w: ReadingWork, result: ReadingUpdateResult | undefined): TriageState {
  return classifyCompleted(paceInputOf(w, result))
}

// ─────────────────────────────────────────────────────────────────────────────
// TAXONOMIA C — MOTIVO (seção "Outras": hiato, cancelada, sem status).
// Aqui a pergunta não é "vou terminar?" e sim "o que houve com a publicação?". Pela triagem as 8
// obras de hoje cairiam todas em "Parado", que não separa nada; o tipo do hiato (migration 183) separa.
// ─────────────────────────────────────────────────────────────────────────────

type PauseState = "season_break" | "hiatus" | "interrupted" | "cancelled" | "unknown"

const PAUSE_STATE_ORDER: readonly PauseState[] = ["season_break", "hiatus", "interrupted", "cancelled", "unknown"]

/**
 * Azul para a espera previsível, ardósia para a parada sem previsão: a segunda perde saturação
 * de propósito, porque é a única em que não há nada acontecendo.
 */
const PAUSE_STATE_CONFIG: Record<PauseState, BandConfig> = {
  season_break: {
    label: "Entre temporadas",
    hint: "a próxima temporada já foi anunciada",
    bar: "bg-sky-500",
    progress: "bg-sky-500",
    chip: "border-sky-500/30 bg-sky-500/15 text-sky-600 dark:text-sky-400",
  },
  hiatus: {
    label: "Em hiato",
    hint: "a fonte não diz se ou quando volta",
    bar: "bg-violet-500",
    progress: "bg-violet-500",
    chip: "border-violet-500/30 bg-violet-500/15 text-violet-600 dark:text-violet-400",
  },
  interrupted: {
    label: "Publicação interrompida",
    hint: "parou no meio da temporada, sem previsão de volta",
    bar: "bg-slate-500",
    progress: "bg-slate-500",
    chip: "border-slate-500/30 bg-slate-500/15 text-slate-600 dark:text-slate-400",
  },
  cancelled: {
    label: "Cancelada",
    hint: "a publicação foi encerrada",
    bar: "bg-rose-500",
    progress: "bg-rose-500",
    chip: "border-rose-500/30 bg-rose-500/15 text-rose-600 dark:text-rose-400",
  },
  unknown: {
    label: "Sem status",
    hint: "a fonte não informa a publicação",
    bar: "bg-slate-400",
    progress: "bg-slate-400",
    chip: "border-slate-500/30 bg-slate-500/15 text-slate-600 dark:text-slate-400",
  },
}

function classifyPauseState(w: ReadingWork): PauseState {
  if (isCancelledPublicationStatus(w.publicationStatusId)) return "cancelled"
  if (!isHiatusPublicationStatus(w.publicationStatusId)) return "unknown"
  return hiatusBand(w.hiatusKind)
}

/** "Recém-começou": pouco lido (< 40%) mas aberto nos últimos 30 dias — tag de textura no card. */
function isRecentlyStarted(w: ReadingWork, result: ReadingUpdateResult | undefined): boolean {
  const pct = progressOf(w, result)
  return pct != null && pct < BEHIND_PCT && daysSince(w.lastReadAt) < STALE_DAYS
}

/** Agrupa as obras nas bandas de uma taxonomia, na ordem dela (bandas vazias caem fora). */
function groupBands<S extends string>(
  works: ReadingWork[],
  results: Record<string, ReadingUpdateResult>,
  classify: (w: ReadingWork, r: ReadingUpdateResult | undefined) => S,
  order: readonly S[],
): Array<{ state: S; works: ReadingWork[] }> {
  const buckets = new Map<S, ReadingWork[]>()
  for (const s of order) buckets.set(s, [])
  for (const w of works) buckets.get(classify(w, results[w.id]))!.push(w)
  return order.map((state) => ({ state, works: buckets.get(state)! })).filter((b) => b.works.length > 0)
}

/** Conta as obras por banda de uma taxonomia (pra faixa-resumo). */
function tallyBands<S extends string>(
  works: ReadingWork[],
  results: Record<string, ReadingUpdateResult>,
  classify: (w: ReadingWork, r: ReadingUpdateResult | undefined) => S,
  order: readonly S[],
): Record<S, number> {
  const counts = Object.fromEntries(order.map((s) => [s, 0])) as Record<S, number>
  for (const w of works) counts[classify(w, results[w.id])]++
  return counts
}

function matchesReadFilter(
  w: ReadingWork,
  result: ReadingUpdateResult | undefined,
  filter: string,
): boolean {
  if (filter === "all") return true
  const p = pendingOf(w, result, w.chaptersRead ?? 0)
  if (p == null) return false
  return filter === "pending" ? p > 0 : p === 0
}

/** Publicação em andamento. */
function isOngoing(w: ReadingWork): boolean {
  const id = w.publicationStatusId
  return id != null && PUBLICATION_STATUSES_BY_ID[id]?.status === "Ongoing"
}

/** A seção sai só do status de publicação. Status ausente ou desconhecido cai em "Outras". */
function sectionOf(w: ReadingWork): SectionKey {
  if (isOngoing(w)) return "ongoing"
  return isConcludedPublicationStatus(w.publicationStatusId) ? "completed" : "others"
}

/** A banda da obra na taxonomia da seção dela. */
function bandOf(w: ReadingWork, result: ReadingUpdateResult | undefined): string {
  const section = sectionOf(w)
  if (section === "ongoing") return classifyReadingState(w, result)
  return section === "completed" ? classifyTriageState(w, result) : classifyPauseState(w)
}

const bandKey = (section: SectionKey, band: string) => `${section}:${band}`

/** Comparator por data com nulos sempre por último (independente da direção). */
function byDate(get: (w: ReadingWork) => string | null, dir: "asc" | "desc") {
  return (a: ReadingWork, b: ReadingWork) => {
    const av = get(a)
    const bv = get(b)
    if (!av && !bv) return 0
    if (!av) return 1
    if (!bv) return -1
    const cmp = new Date(av).getTime() - new Date(bv).getTime()
    return dir === "asc" ? cmp : -cmp
  }
}

const DATE_SORTERS: Record<Exclude<SortKey, "progress">, (a: ReadingWork, b: ReadingWork) => number> = {
  last_read: byDate((w) => w.lastReadAt, "desc"),
  released: byDate((w) => w.lastChapterReleasedAt, "desc"),
  predicted: byDate((w) => w.nextChapterPredictedAt, "asc"),
}

/** URL canônica da obra no comix (o hid sozinho já resolve). Espelha comixWorkUrl do server. */
function comixUrlFor(hid: string): string {
  return `https://comix.to/title/${hid}`
}

/** Localiza pra PT a string relativa da comix (ex.: "8mos ago" → "8 meses atrás"). Fallback: cru. */
function formatComixAge(label: string | null | undefined): string | null {
  if (!label) return null
  const s = label.trim()
  if (/^(just now|now)$/i.test(s)) return "agora"
  const m = s.match(/^(\d+)\s*(y|mos|mo|w|d|h|min|m)\s*ago$/i)
  if (!m) return s
  const n = Number(m[1])
  const unit = m[2].toLowerCase()
  const plural = n !== 1
  const word =
    unit === "y" ? (plural ? "anos" : "ano")
    : unit === "mo" || unit === "mos" ? (plural ? "meses" : "mês")
    : unit === "w" ? (plural ? "semanas" : "semana")
    : unit === "d" ? (plural ? "dias" : "dia")
    : unit === "h" ? "h"
    : "min"
  return `${n} ${word} atrás`
}

export function ReadingList({
  works,
  defaultView = "list",
  nowIso,
  initialFilterQuery = "",
  defaultCollapsedBands = [],
}: {
  works: ReadingWork[]
  /** Vista inicial lida do cookie no servidor (evita divergência de hidratação). */
  defaultView?: ReadingView
  /** "agora" do servidor (ISO) — base do mês/hoje do calendário, igual nos dois lados. */
  nowIso: string
  /** A query string do pedido: os filtros começam dela, nos dois lados. */
  initialFilterQuery?: string
  /** Grupos recolhidos, lidos do cookie no servidor (evita divergência de hidratação). */
  defaultCollapsedBands?: readonly string[]
}) {
  const refresh = useRefresh()
  const [results, setResults] = useState<Record<string, ReadingUpdateResult>>({})
  const tasks = useAppTasks()
  const checking = tasks.some((t) => t.id === CHECK_TASK_ID && t.status === "running")
  const [readFilter, setReadFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<SortKey>("last_read")
  // Filtros do painel: a query string É o estado. `replaceState` e não navegação, porque filtrar
  // aqui não consulta nada; e na URL, porque é o que devolve o recorte ao voltar de uma obra.
  const [filterQuery, setFilterQuery] = useState(initialFilterQuery)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterParams = useMemo(() => new URLSearchParams(filterQuery), [filterQuery])
  const filters = useMemo(() => parseReadingFilters(filterParams), [filterParams])
  const activeFilterCount = activeReadingFilterCount(filters)
  const updateFilterParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(filterParams)
    for (const [key, value] of Object.entries(updates)) {
      if (value == null) next.delete(key)
      else next.set(key, value)
    }
    const query = next.toString()
    setFilterQuery(query)
    window.history.replaceState(null, "", query ? `${window.location.pathname}?${query}` : window.location.pathname)
  }
  const clearFilters = () => updateFilterParams(clearedReadingFilterParams())
  // Otimista: marca "agora" assim que a checagem termina (antes do refresh trazer o persistido).
  const [justCheckedAt, setJustCheckedAt] = useState<string | null>(null)
  // Vermelho no "Última verificação" quando a última checagem DESTA sessão deu erro (obra
  // sem retorno ou falha total). A falha não é persistida no banco, então um reload limpa
  // o sinal — ele reflete só a checagem que o usuário acabou de disparar.
  const [lastCheckFailed, setLastCheckFailed] = useState(false)

  // Vista (lista × calendário) — persistida em cookie pra o servidor renderizar a
  // vista final e a hidratação não divergir. Mês do calendário ancorado no "agora" do
  // servidor (nowIso), idêntico nos dois lados.
  const [view, setView] = useState<ReadingView>(defaultView)
  const [monthAnchor, setMonthAnchor] = useState(() => startOfMonth(new Date(nowIso)))
  const changeView = (next: ReadingView) => {
    setView(next)
    writeReadingViewCookie(next)
  }

  // Estado das seções (accordion). `null` = ainda não interagiu → cai no default (só
  // "Em andamento" aberta, ou "outras" se não houver nenhuma em andamento). Depois do
  // primeiro clique, passa a valer o Set explícito.
  const [openKeys, setOpenKeys] = useState<Set<SectionKey> | null>(null)
  // Grupos recolhidos, por `seção:banda`. Lembrados em cookie, como a vista.
  const [collapsedBands, setCollapsedBands] = useState<ReadonlySet<string>>(() => new Set(defaultCollapsedBands))
  const saveCollapsedBands = (next: ReadonlySet<string>) => {
    setCollapsedBands(next)
    writeCollapsedBandsCookie(next)
  }
  // O elemento para onde rolar depois que a seção ou o grupo abrir.
  const pendingScroll = useRef<string | null>(null)

  // Última verificação = a mais recente entre as obras (cada uma grava chapters_checked_at).
  const lastChecked = useMemo(() => {
    const times = works.map((w) => w.chaptersCheckedAt).filter((t): t is string => t != null)
    const latest = times.sort().at(-1) ?? null
    return justCheckedAt && (!latest || justCheckedAt > latest) ? justCheckedAt : latest
  }, [works, justCheckedAt])

  // O painel vale nas duas vistas; "Leitura" só existe na lista, então só corta a lista.
  const filteredWorks = useMemo(
    () => (activeFilterCount > 0 ? works.filter((w) => matchesReadingFilters(w, filters)) : works),
    [works, filters, activeFilterCount],
  )

  const displayed = useMemo(() => {
    let list = filteredWorks
    if (readFilter !== "all") {
      list = list.filter((w) => matchesReadFilter(w, results[w.id], readFilter))
    }
    const arr = [...list]
    if (sortBy === "progress") {
      arr.sort((a, b) => {
        const pa = progressOf(a, results[a.id])
        const pb = progressOf(b, results[b.id])
        if (pa == null && pb == null) return 0
        if (pa == null) return 1
        if (pb == null) return -1
        return pb - pa // mais perto do fim primeiro
      })
    } else {
      arr.sort(DATE_SORTERS[sortBy])
    }
    return arr
  }, [filteredWorks, readFilter, sortBy, results])

  const worksBySection = useMemo(() => {
    const out: Record<SectionKey, ReadingWork[]> = { ongoing: [], completed: [], others: [] }
    for (const w of displayed) out[sectionOf(w)].push(w)
    return out
  }, [displayed])

  // Default de abertura quando o usuário ainda não interagiu: a primeira seção com obra.
  const defaultOpen = SECTION_ORDER.find((key) => worksBySection[key].length > 0) ?? "ongoing"
  const effectiveOpen = openKeys ?? new Set<SectionKey>([defaultOpen])
  const isOpen = (key: SectionKey) => effectiveOpen.has(key)

  // Rola até o alvo depois que a seção ou o grupo expande — efeito só faz scroll, nada de setState.
  useEffect(() => {
    const target = pendingScroll.current
    if (!target) return
    pendingScroll.current = null
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [openKeys, collapsedBands])

  const scrollTo = (elementId: string) =>
    document.getElementById(elementId)?.scrollIntoView({ behavior: "smooth", block: "start" })

  // Clique na aba: abre só aquela, fecha as outras e rola até ela.
  const selectSection = (key: SectionKey) => {
    pendingScroll.current = `section-${key}`
    setOpenKeys(new Set([key]))
  }

  const toggleBand = (key: string) => {
    const next = new Set(collapsedBands)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    saveCollapsedBands(next)
  }

  /** Rola até algo dentro de um grupo, abrindo antes o que estiver fechado no caminho. */
  const revealInBand = (section: SectionKey, band: string, elementId: string) => {
    const key = bandKey(section, band)
    const closed = collapsedBands.has(key)
    const sectionOpen = effectiveOpen.has(section)
    if (sectionOpen && !closed) {
      scrollTo(elementId)
      return
    }
    pendingScroll.current = elementId
    if (closed) {
      const next = new Set(collapsedBands)
      next.delete(key)
      saveCollapsedBands(next)
    }
    if (!sectionOpen) setOpenKeys(new Set([...effectiveOpen, section]))
  }

  // Chip do resumo: leva ao grupo, mesmo recolhido.
  const jumpToBand = (section: SectionKey, band: string) => revealInBand(section, band, `band-${section}-${band}`)

  // Chip da faixa de novidades: abre o que precisar e rola até o card.
  const jumpToWork = (work: ReadingWork) =>
    revealInBand(sectionOf(work), bandOf(work, results[work.id]), `work-${work.id}`)

  // Obras com capítulo novo nesta sessão (pós "Verificar atualizações"), pra faixa do topo. Só as
  // que estão na tela: o clique da faixa rola até o card, e obra filtrada não tem card. O toast da
  // verificação continua nomeando todas.
  const newReleases = useMemo(
    () =>
      displayed
        .filter((w) => results[w.id]?.hasNew)
        .map((w) => ({ work: w, result: results[w.id] })),
    [displayed, results],
  )

  // Limpa "hasNew" quando o usuário se atualiza (marcar até o último ou stepper alcança
  // o lançado) — senão a faixa e o anel do card ficam "novo" mesmo já lido.
  const clearHasNew = (workId: string) => {
    setResults((prev) => {
      const cur = prev[workId]
      if (!cur?.hasNew) return prev
      return { ...prev, [workId]: { ...cur, hasNew: false } }
    })
  }

  // Clique no cabeçalho: alterna aquela seção livremente (pode deixar várias abertas).
  const toggleSection = (key: SectionKey) => {
    setOpenKeys((prev) => {
      const base = prev ?? new Set<SectionKey>([defaultOpen])
      const next = new Set(base)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleCheckAll = () => {
    const ids = works.map((w) => w.id)
    const total = ids.length
    const chunks: string[][] = []
    for (let i = 0; i < ids.length; i += CHECK_CHUNK) chunks.push(ids.slice(i, i + CHECK_CHUNK))

    // Nomeia as OBRAS nos toasts (novidade e falha): até 3 títulos + "e mais N". O toast
    // é global; sem os nomes ele só dava a contagem — "2 obras com capítulo novo" sem
    // dizer quais — e "N não verificadas" parecia uma fonte externa fora do ar (a falha
    // é por OBRA: nenhuma fonte de capítulo respondeu por ela).
    const titleById = new Map(works.map((w) => [w.id, w.title]))
    const formatNames = (rows: ReadingUpdateResult[]): string => {
      const names = rows.map((r) => titleById.get(r.workId)).filter((t): t is string => !!t)
      if (names.length === 0) return ""
      const shown = names.slice(0, 3).join(", ")
      return names.length > 3 ? `${shown} e mais ${names.length - 3}` : shown
    }

    runTask({
      id: CHECK_TASK_ID,
      kind: "reading-check",
      label: `Verificando capítulos: ${total} obra${total !== 1 ? "s" : ""}`,
      run: async () => {
        setResults({})
        setTaskProgress(CHECK_TASK_ID, 0, total)
        const all: ReadingUpdateResult[] = []
        for (const [i, chunk] of chunks.entries()) {
          const res = await checkReadingUpdates(chunk)
          // 🔴 A action devolve `[]` sem lançar quando o gate de admin recusa. Sem este
          // throw, o indicador anunciaria "pronto" pra uma checagem que não aconteceu —
          // plausível, errado e sem log.
          if (res.length === 0) {
            throw new Error("nenhuma obra foi verificada (sem permissão ou sessão expirada)")
          }
          all.push(...res)
          // Mescla por fatia: os cards acendem enquanto o resto ainda roda, em vez de a
          // lista ficar 40s parada e mudar tudo de uma vez no fim.
          setResults((prev) => {
            const next = { ...prev }
            for (const r of res) next[r.workId] = r
            return next
          })
          setTaskProgress(CHECK_TASK_ID, Math.min((i + 1) * CHECK_CHUNK, total), total)
        }
        return all
      },
      onDone: (res) => {
        setJustCheckedAt(new Date().toISOString())
        const failedWorks = res.filter((r) => r.failed)
        setLastCheckFailed(failedWorks.length > 0)

        const newWorks = res.filter((r) => r.hasNew)
        const news = newWorks.length
        const statusChanges = res.filter((r) => r.statusApplied).length

        const descParts: string[] = []
        const newNames = formatNames(newWorks)
        if (newNames) descParts.push(newNames)
        if (statusChanges > 0) descParts.push(`${statusChanges} mudança(s) de status`)
        if (failedWorks.length > 0) {
          const plural = failedWorks.length !== 1
          const failedNames = formatNames(failedWorks)
          descParts.push(
            `${failedWorks.length} obra${plural ? "s" : ""} não verificada${plural ? "s" : ""}` +
              (failedNames ? `: ${failedNames}` : ""),
          )
        }

        // Verde só quando houve novidade; cai em aviso quando o único destaque é falha.
        const notify = news === 0 && failedWorks.length > 0 ? toast.warning : toast.success
        notify(
          news > 0
            ? `${news} obra${news !== 1 ? "s" : ""} com capítulo novo`
            : "Nenhuma novidade encontrada",
          descParts.length > 0 ? { description: descParts.join(" · ") } : undefined,
        )
        refresh() // traz hids recém-persistidos pra próxima carga
      },
      onError: () => {
        // Falha no meio: marca "agora" como a última tentativa e pinta de vermelho — foi
        // uma verificação, e ela deu erro. As fatias que passaram já estão persistidas.
        setJustCheckedAt(new Date().toISOString())
        setLastCheckFailed(true)
        refresh()
      },
      // ⚠️ O desfecho tem TRÊS tons (novidade / nada / parcial com falhas) e o toast padrão
      // do store é sempre `success` — ele achataria "29 não verificadas" em verde. Quem
      // emite é o `onDone` acima, que roda antes desta linha.
      successToast: () => null,
    })
  }

  if (works.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Nenhuma obra em acompanhamento no momento.
        </CardContent>
      </Card>
    )
  }

  const filtering = readFilter !== "all" || activeFilterCount > 0
  // O que as três seções recebem igual.
  const sectionProps = {
    results,
    filters,
    collapsedBands,
    onToggleSection: toggleSection,
    onToggleBand: toggleBand,
    onJumpBand: jumpToBand,
    onCaughtUp: clearHasNew,
  }
  const filtersButton = (
    <ReadingFiltersButton
      open={filtersOpen}
      onToggle={() => setFiltersOpen((open) => !open)}
      activeCount={activeFilterCount}
    />
  )
  // No calendário a contagem é a do painel: "Leitura" não existe naquela vista.
  const shownCount = view === "calendar" ? filteredWorks.length : displayed.length
  // Fecha o grupo da esquerda: o total é a soma do que está ali, não um controle.
  const countLabel = (
    <>
      <span className="mx-1.5 hidden h-5 w-px bg-border sm:block" aria-hidden />
      <span className="text-xs tabular-nums text-muted-foreground">
        {shownCount !== works.length || filtering ? (
          <>
            <b className="font-semibold text-foreground">{shownCount}</b> de {works.length}
          </>
        ) : (
          <>
            <b className="font-semibold text-foreground">{works.length}</b> obra{works.length !== 1 ? "s" : ""}
          </>
        )}
      </span>
    </>
  )

  return (
    <div className="space-y-4">
      {/* Barra de controles em painel. Linha 1 (modo + ação) = nível superior, em destaque;
          Linha 2 (navegar/filtrar) = prateleira rebaixada e discreta. Hierarquia por FORMA
          (segmented preenchido + botão em gradiente na L1 × chips planos na prateleira). */}
      <div className="overflow-hidden rounded-xl border border-border bg-card/40">
        {/* Linha 1 — modo (esq) ⟷ ação (dir) */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="inline-flex h-10 items-center rounded-xl bg-muted p-1 text-muted-foreground">
            <ViewToggleButton active={view === "list"} onClick={() => changeView("list")} icon={<List className="size-4" />} label="Lista" />
            <ViewToggleButton active={view === "calendar"} onClick={() => changeView("calendar")} icon={<CalendarDays className="size-4" />} label="Calendário" />
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button onClick={handleCheckAll} disabled={checking}>
              {checking ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-2 size-4" />
              )}
              Verificar atualizações
            </Button>
            {lastChecked && (
              <span
                className={cn(
                  "flex items-center gap-1 text-[11px]",
                  lastCheckFailed ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground",
                )}
              >
                {lastCheckFailed && <AlertCircle className="size-3 shrink-0" />}
                Última verificação: {formatRelativeDateTime(lastChecked)}
              </span>
            )}
          </div>
        </div>

        {/* Linha 2 — prateleira rebaixada: navegar (esq) ⟷ filtrar/legenda (dir) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-4 py-2.5">
          {view === "calendar" ? (
            <>
              <div className="inline-flex items-center gap-1">
                <Button variant="outline" size="icon" className="size-8" onClick={() => setMonthAnchor((m) => addMonths(m, -1))} aria-label="Mês anterior">
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-32 text-center text-sm font-semibold capitalize tabular-nums">
                  {format(monthAnchor, "MMMM yyyy", { locale: ptBR })}
                </span>
                <Button variant="outline" size="icon" className="size-8" onClick={() => setMonthAnchor((m) => addMonths(m, 1))} aria-label="Próximo mês">
                  <ChevronRight className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setMonthAnchor(startOfMonth(new Date(nowIso)))}>
                  Hoje
                </Button>
                {countLabel}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <CalendarLegend />
                {filtersButton}
              </div>
            </>
          ) : (
            <>
              {/* Navegação de seção (pills discretas — split de publicação, rola até a seção). */}
              <div className="flex flex-wrap items-center gap-1.5">
                {SECTION_ORDER.map((key) => {
                  const count = worksBySection[key].length
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectSection(key)}
                      disabled={count === 0}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
                        "text-foreground hover:bg-background disabled:pointer-events-none disabled:opacity-40",
                        isOpen(key) && "bg-background ring-1 ring-inset ring-primary/40",
                      )}
                    >
                      <span className={cn("size-1.5 rounded-full", SECTIONS[key].dotClass)} />
                      {SECTIONS[key].label}
                      <span className="tabular-nums text-muted-foreground">{count}</span>
                    </button>
                  )
                })}
                {countLabel}
              </div>
              {/* À direita, só o que muda a vista: filtros e ordenação. */}
              <div className="flex flex-wrap items-center gap-2">
                {filtersButton}
                <Select value={readFilter} onValueChange={setReadFilter}>
                  <SelectTrigger size="sm" className="w-auto min-w-28 gap-1.5 text-xs">
                    <BookOpenCheck className="size-3.5 text-muted-foreground" />
                    <SelectValue>
                      {selectedOptionLabel(
                        READ_FILTER_OPTIONS.map(([value, label]) => ({ value, label })),
                        readFilter,
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {READ_FILTER_OPTIONS.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                  <SelectTrigger size="sm" className="w-auto min-w-36 gap-1.5 text-xs">
                    <ArrowDownUp className="size-3.5 text-muted-foreground" />
                    <SelectValue>
                      {selectedOptionLabel(
                        (Object.keys(SORT_LABELS) as SortKey[]).map((value) => ({
                          value,
                          label: SORT_LABELS[value],
                        })),
                        sortBy,
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {SORT_LABELS[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>

        <ReadingActiveFilters filters={filters} updateParams={updateFilterParams} onClear={clearFilters} />
        {filtersOpen && (
          <ReadingFiltersPanel
            works={works}
            filters={filters}
            params={filterParams}
            updateParams={updateFilterParams}
          />
        )}

        {/* Faixa de novidades — só na lista, e só quando a checagem achou algo pendente.
            Mini-CARD, não chip: a versão anterior era uma pílula com capa de 18×24px e o
            título truncado numa linha — não identificava obra nenhuma, que é a única coisa
            que a faixa precisa fazer. Capa de 44×64 + título em 2 linhas + "+N novo · cap. X". */}
        {view === "list" && newReleases.length > 0 && (
          <div className="border-t border-border bg-emerald-500/[0.06] px-4 py-3">
            <span className="flex flex-wrap items-center gap-x-1.5 text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">
              <Sparkles className="size-4 shrink-0" />
              {newReleases.length} obra{newReleases.length !== 1 ? "s" : ""} com capítulo novo
              <span className="font-medium text-muted-foreground">· clique pra ir até ela</span>
            </span>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {newReleases.map(({ work, result }) => {
                const novos = newChapterCount(result)
                return (
                  <button
                    key={work.id}
                    type="button"
                    onClick={() => jumpToWork(work)}
                    className="flex w-68 max-w-full items-stretch gap-2.5 rounded-lg border border-emerald-500/35 bg-card p-2 text-left transition-colors hover:border-emerald-500/60 hover:bg-emerald-500/10"
                  >
                    <CoverImage
                      urls={work.coverUrls}
                      alt=""
                      className="h-16 w-11 shrink-0 rounded object-cover"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="line-clamp-2 text-[13px] font-semibold leading-snug">
                        {work.title}
                      </span>
                      <span className="mt-auto flex items-center gap-1.5 text-[11px]">
                        <span className="rounded-full bg-emerald-500 px-1.5 py-px font-bold text-emerald-950">
                          +{novos} novo{novos !== 1 ? "s" : ""}
                        </span>
                        {latestOf(work, result) != null && (
                          <span className="tabular-nums text-muted-foreground">
                            cap. {latestOf(work, result)}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Conteúdo da vista ativa */}
      {view === "calendar" ? (
        <ReadingCalendar works={filteredWorks} results={results} monthAnchor={monthAnchor} nowIso={nowIso} />
      ) : displayed.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center text-sm text-muted-foreground">
            Nenhuma obra com esse filtro.
            {activeFilterCount > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                Limpar filtros
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <BandedSection
            sectionKey="ongoing"
            works={worksBySection.ongoing}
            classify={classifyReadingState}
            order={READING_STATE_ORDER}
            config={READING_STATE_CONFIG}
            label={`Seu ritmo nas ${worksBySection.ongoing.length} em andamento`}
            open={isOpen("ongoing")}
            {...sectionProps}
          />
          <BandedSection
            sectionKey="completed"
            works={worksBySection.completed}
            classify={classifyTriageState}
            order={TRIAGE_STATE_ORDER}
            config={TRIAGE_STATE_CONFIG}
            label={`Sua triagem nas ${worksBySection.completed.length} concluídas`}
            showActions={(_, state) => state === "parado"}
            open={isOpen("completed")}
            {...sectionProps}
          />
          <BandedSection
            sectionKey="others"
            works={worksBySection.others}
            classify={classifyPauseState}
            order={PAUSE_STATE_ORDER}
            config={PAUSE_STATE_CONFIG}
            label={`O que houve com as ${worksBySection.others.length} outras`}
            showActions={(w) => daysSince(recencyDate(w)) >= STALLED_DAYS}
            open={isOpen("others")}
            {...sectionProps}
          />
        </div>
      )}
    </div>
  )
}

/** Botão de alternância de vista (Lista × Calendário) no segmented control do topo. */
function ViewToggleButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex h-full items-center gap-2 rounded-lg border border-transparent px-4 text-sm font-semibold whitespace-nowrap transition-all",
        "text-foreground/60 hover:text-foreground",
        active &&
          "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30 dark:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** Seção colapsável (cabeçalho com contagem + faixa-resumo + grade de cards). */
function ReadingSection({
  sectionKey,
  count,
  open,
  onToggle,
  children,
}: {
  sectionKey: SectionKey
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const cfg = SECTIONS[sectionKey]
  return (
    <section id={`section-${sectionKey}`} className="scroll-mt-4 space-y-3">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 border-b border-border pb-2 text-left"
      >
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !open && "-rotate-90")}
        />
        <span className={cn("size-2 shrink-0 rounded-full", cfg.dotClass)} />
        <h2 className="text-sm font-semibold">{cfg.label}</h2>
        <span className="rounded-full border border-border px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
          {count}
        </span>
        <span className="ml-auto hidden truncate pl-3 text-[11px] text-muted-foreground/70 sm:inline">
          {cfg.hint}
        </span>
      </button>
      {open && <div className="space-y-4">{children}</div>}
    </section>
  )
}

/** Uma seção inteira: cabeçalho, faixa-resumo e grupos. Sem obra, ela não aparece. */
function BandedSection<S extends string>({
  sectionKey,
  works,
  results,
  classify,
  order,
  config,
  label,
  showActions,
  filters,
  collapsedBands,
  open,
  onToggleSection,
  onToggleBand,
  onJumpBand,
  onCaughtUp,
}: {
  sectionKey: SectionKey
  works: ReadingWork[]
  results: Record<string, ReadingUpdateResult>
  classify: (w: ReadingWork, r: ReadingUpdateResult | undefined) => S
  order: readonly S[]
  config: Record<S, BandConfig>
  label: string
  /** Quais cards ganham as ações On-hold / Arquivar. */
  showActions?: (w: ReadingWork, state: S) => boolean
  filters: ReadingFilters
  collapsedBands: ReadonlySet<string>
  open: boolean
  onToggleSection: (key: SectionKey) => void
  onToggleBand: (key: string) => void
  onJumpBand: (section: SectionKey, band: string) => void
  onCaughtUp: (workId: string) => void
}) {
  if (works.length === 0) return null
  return (
    <ReadingSection sectionKey={sectionKey} count={works.length} open={open} onToggle={() => onToggleSection(sectionKey)}>
      <SectionSummary
        works={works}
        results={results}
        classify={classify}
        order={order}
        config={config}
        label={label}
        onJump={(band) => onJumpBand(sectionKey, band)}
      />
      <BandedGrid
        works={works}
        results={results}
        sectionKey={sectionKey}
        classify={classify}
        order={order}
        config={config}
        showActions={showActions}
        filters={filters}
        collapsedBands={collapsedBands}
        onToggleBand={onToggleBand}
        onCaughtUp={onCaughtUp}
      />
    </ReadingSection>
  )
}

/**
 * Faixa-resumo de UMA seção: barra segmentada + chips por banda. Vive DENTRO da seção
 * (não é mais fixa no topo). Clicar (segmento ou chip) rola até a banda pelo id
 * `band-${sectionKey}-${state}` — como cada seção tem taxonomia própria, o id nunca colide.
 */
function SectionSummary<S extends string>({
  works,
  results,
  classify,
  order,
  config,
  label,
  onJump,
}: {
  works: ReadingWork[]
  results: Record<string, ReadingUpdateResult>
  classify: (w: ReadingWork, r: ReadingUpdateResult | undefined) => S
  order: readonly S[]
  config: Record<S, BandConfig>
  label: string
  /** Leva ao grupo, abrindo-o se estiver recolhido. */
  onJump: (state: S) => void
}) {
  const counts = useMemo(
    () => tallyBands(works, results, classify, order),
    [works, results, classify, order],
  )
  const present = order.filter((s) => counts[s] > 0)
  if (works.length === 0 || present.length === 0) return null

  return (
    <div className="rounded-xl border border-border bg-muted/30 px-3.5 py-2.5">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
        <span className="ml-1.5 lowercase tracking-normal text-muted-foreground/60">· clique pra pular</span>
      </p>
      <div className="mb-2.5 flex h-2 gap-0.5 overflow-hidden rounded-full">
        {present.map((s) => (
          <button
            key={s}
            type="button"
            aria-label={`Ir para ${config[s].label} (${counts[s]})`}
            onClick={() => onJump(s)}
            className={cn("h-full cursor-pointer transition-[filter] hover:brightness-125", config[s].bar)}
            style={{ flexGrow: counts[s] }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {order.map((s) => {
          const cfg = config[s]
          const disabled = counts[s] === 0
          return (
            <button
              key={s}
              type="button"
              disabled={disabled}
              onClick={() => onJump(s)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors",
                "hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
              )}
            >
              <span className={cn("size-2 rounded-[3px]", cfg.bar)} />
              <span className="font-medium">{cfg.label}</span>
              <span className="tabular-nums">{counts[s]}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Grade agrupada por banda — sub-cabeçalho colorido + cards de cada banda. */
function BandedGrid<S extends string>({
  works,
  results,
  sectionKey,
  classify,
  order,
  config,
  showActions,
  filters,
  collapsedBands,
  onToggleBand,
  onCaughtUp,
}: {
  works: ReadingWork[]
  results: Record<string, ReadingUpdateResult>
  sectionKey: SectionKey
  classify: (w: ReadingWork, r: ReadingUpdateResult | undefined) => S
  order: readonly S[]
  config: Record<S, BandConfig>
  /** Quais cards ganham as ações On-hold / Arquivar. */
  showActions?: (w: ReadingWork, state: S) => boolean
  /** Os filtros ligados: cada card mostra o próprio valor neles. */
  filters: ReadingFilters
  collapsedBands: ReadonlySet<string>
  onToggleBand: (key: string) => void
  /** Chamado quando o card alcança o lançado (marcar até o X / stepper) — limpa o "hasNew". */
  onCaughtUp: (workId: string) => void
}) {
  const bands = useMemo(
    () => groupBands(works, results, classify, order),
    [works, results, classify, order],
  )
  return (
    <div className="space-y-6">
      {bands.map(({ state, works: items }) => {
        const cfg = config[state]
        const key = bandKey(sectionKey, state)
        const closed = collapsedBands.has(key)
        return (
          <div key={state} id={`band-${sectionKey}-${state}`} className="scroll-mt-4 space-y-2.5">
            <button
              type="button"
              onClick={() => onToggleBand(key)}
              aria-expanded={!closed}
              className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/40"
            >
              <ChevronDown
                className={cn("size-4 shrink-0 text-muted-foreground transition-transform", closed && "-rotate-90")}
              />
              <span className={cn("h-3.5 w-1 shrink-0 rounded-full", cfg.bar)} />
              <h3 className="text-sm font-semibold">{cfg.label}</h3>
              <span className="rounded-full border border-border px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                {items.length}
              </span>
              <span className="hidden truncate pl-1 text-[11px] text-muted-foreground/70 sm:inline">
                {cfg.hint}
              </span>
            </button>
            {/* Altura idêntica em TODA a banda, e ela sai do conteúdo — não de um número
                mágico. `auto-rows-fr` iguala as linhas da grade pela mais alta; sem
                `items-start` cada card estica até a linha. Só isso não bastava: com
                `items-start` (versão anterior) título de 1 vs 2 linhas e uma data a mais
                davam a cada card uma altura própria — medido no catálogo: 304 e 318px na
                mesma banda. O `min-h` do card é o piso que alinha uma banda com a outra.
                ⚠️ Recolher ESCONDE, não desmonta: o card segura o save do stepper num debounce de
                500ms, e desmontá-lo cancelaria o último clique. */}
            <div className={cn("grid auto-rows-fr grid-cols-1 gap-3 lg:grid-cols-2", closed && "hidden")}>
              {items.map((work) => (
                <ReadingCard
                  key={work.id}
                  work={work}
                  result={results[work.id]}
                  cfg={cfg}
                  showActions={showActions?.(work, state)}
                  filters={filters}
                  onCaughtUp={onCaughtUp}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Card de uma obra, com edição in-loco do progresso (stepper + "marcar até o último"). */
function ReadingCard({
  work,
  result,
  cfg,
  showActions,
  filters,
  onCaughtUp,
}: {
  work: ReadingWork
  result: ReadingUpdateResult | undefined
  cfg: BandConfig
  showActions?: boolean
  filters: ReadingFilters
  onCaughtUp: (workId: string) => void
}) {
  const refresh = useRefresh()
  // Progresso local otimista. `read` é a fonte da verdade da UI do card; o servidor é
  // atualizado com debounce. Ressincroniza se o valor persistido mudar (ex.: pós-refresh)
  // pelo padrão "adjust during render": roda na render, só quando o prop de fato muda —
  // sem effect (que dispararia render em cascata).
  const [read, setRead] = useState(work.chaptersRead ?? 0)
  const [syncedFrom, setSyncedFrom] = useState(work.chaptersRead)
  const [saving, startSave] = useTransition()
  const [acting, startAct] = useTransition()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (work.chaptersRead !== syncedFrom) {
    setSyncedFrom(work.chaptersRead)
    setRead(work.chaptersRead ?? 0)
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const lancado = latestOf(work, result)

  const persist = (value: number, immediate = false) => {
    if (timer.current) clearTimeout(timer.current)
    const run = () =>
      startSave(async () => {
        // Sem o teto de `total_chapters`: aqui o limite é o ÚLTIMO LANÇADO (`lancado`, que vem
        // da checagem externa), e ele passa do total do catálogo justamente quando o catálogo
        // está velho. Deixar o servidor limitar faria "Marcar até o 132" gravar 120 calado.
        const res = await setChaptersRead(work.id, value, { clampToTotal: false })
        if (res && "error" in res && res.error) {
          toast.error("Não salvou os capítulos", { description: res.error })
          setRead(work.chaptersRead ?? 0) // reverte pro persistido
        }
      })
    if (immediate) run()
    else timer.current = setTimeout(run, 500)
  }

  const bump = (delta: number) => {
    const next = Math.max(0, read + delta)
    if (next === read) return
    setRead(next)
    persist(next)
    if (lancado != null && next >= lancado) onCaughtUp(work.id)
  }

  const markLatest = () => {
    if (lancado == null) return
    const next = wholeChapters(lancado)
    setRead(next)
    persist(next, true)
    onCaughtUp(work.id)
    toast.success(`Marcado como lido até o ${next}`)
  }

  // Ações do "Parado": tira a obra do ritmo ativo (On-hold sai de /reading) ou arquiva.
  const moveToOnHold = () => {
    startAct(async () => {
      const res = await setReadingStatusForWorks([work.id], personalStatusNameBySlugOrThrow("on-hold"))
      if (res && "error" in res && res.error) {
        toast.error("Não mudou o status", { description: res.error })
        return
      }
      toast.success(`"${work.title}" movida para On-hold`)
      refresh()
    })
  }
  const archive = () => {
    startAct(async () => {
      const res = await archiveWork(work.id)
      if (res && "error" in res && res.error) {
        toast.error("Não arquivou", { description: res.error })
        return
      }
      toast.success(`"${work.title}" arquivada`)
      refresh()
    })
  }

  const pending = pendingOf(work, result, read)
  const fraction = lancado != null && lancado > 0 ? Math.min(1, Math.max(0, read / lancado)) : null
  const canMarkLatest = lancado != null && read < lancado

  // "Continuar lendo" → fonte com o cap mais recente (pós-check); senão comix por hid (load).
  const readUrl = result?.latestUrl ?? (work.comixHid ? comixUrlFor(work.comixHid) : null)
  // Data do último cap: absoluta da fonte (mangago) ou relativa da comix pós-check;
  // senão a cacheada no DB (load).
  const releasedAge = result?.releasedAt
    ? formatRelativeDate(result.releasedAt)
    : result?.releasedLabel
      ? formatComixAge(result.releasedLabel)
      : work.lastChapterReleasedAt
        ? formatRelativeDate(work.lastChapterReleasedAt)
        : null
  // Próxima previsão + realce quando já venceu (item 3): a data já exibida vira "· já passou".
  const predictedIso = result?.nextPredictedAt ?? work.nextChapterPredictedAt
  const predictedOverdue =
    predictedIso != null && differenceInCalendarDays(new Date(), new Date(predictedIso)) > 0
  const predicted = formatPredictedDate(predictedIso)
  const predictedShort = predictedIso
    ? new Date(predictedIso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    : null

  return (
    <Card
      id={`work-${work.id}`}
      className={cn(
        // `h-full` faz o card ocupar a linha inteira do `auto-rows-fr`; o `min-h-80` é o
        // piso que mantém bandas diferentes com a mesma altura (320px = pior caso medido
        // no catálogo: título de 2 linhas + 3 linhas de data). Nada é reservado DENTRO do
        // card: o conteúdo fica colado no topo e a sobra vai toda pro rodapé, onde os
        // botões estão ancorados por `mt-auto`.
        "relative h-full min-h-80 scroll-mt-4 overflow-hidden",
        result?.hasNew &&
          "ring-2 ring-emerald-500/70 shadow-md shadow-emerald-500/15 dark:ring-emerald-400/70",
      )}
    >
      {/* Quem tem capítulo novo é pra DESTACAR, não só diferenciar: o anel de 1px a 60% +
          fundo a 5% sumia no meio da grade. Degradê no topo + anel de 2px + o selo sobre a
          capa. Some sozinho quando `hasNew` é limpo (marcar até o X / stepper). */}
      {result?.hasNew && (
        <span
          className="absolute inset-0 bg-gradient-to-b from-emerald-500/12 via-emerald-500/[0.03] to-transparent"
          aria-hidden
        />
      )}
      {/* Faixa de estado: `bg-*` porque `border-<cor>` é morto neste projeto
          (regra `* { border-color }` fora de @layer sobrepõe as utilities do Tailwind). */}
      <span className={cn("absolute inset-y-0 left-0 w-1", cfg.bar)} aria-hidden />
      <CardContent className="flex h-full gap-4 p-3 pl-3.5">
        <div className="relative shrink-0 self-stretch">
          <CoverImage
            urls={work.coverUrls}
            alt={work.title}
            className="h-full min-h-48 w-32 rounded-lg object-cover ring-1 ring-border/60"
          />
          {/* Selo sobre a capa: é o que se vê de longe na grade. Ele também SUBSTITUI o
              badge "+N novo" que ficava ao lado do "Último lançado" — com o número já em
              verde ali, eram três vezes a mesma informação no mesmo card. */}
          {result?.hasNew && (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[11px] font-bold tracking-wide text-emerald-950 shadow-md shadow-black/40">
              <Sparkles className="size-3 shrink-0" />
              +{newChapterCount(result)} NOVO{newChapterCount(result) !== 1 ? "S" : ""}
            </span>
          )}
        </div>
        <div className="@container flex min-w-0 flex-1 flex-col gap-2.5">
          {/* Coluna estreita: os selos sobem para uma linha própria. Lado a lado eles não encolhem, e o
              título ficava com largura zero no celular (só sobrava um "·") e com ~120px no tablet em duas
              colunas. Quem decide é a largura da COLUNA (container query), não a da tela. O DOM segue
              título primeiro, então leitor de tela e Tab não mudam de ordem. */}
          <div className="flex flex-col-reverse items-start gap-1.5 @sm:flex-row @sm:justify-between @sm:gap-2">
            <WorkTitleLink
              title={work.title}
              workId={work.id}
              className="line-clamp-2 min-w-0 text-lg font-semibold leading-snug hover:underline"
            />
            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
              <WorkContentChip isAdult={work.isAdult} isMixed={work.isMixed} className="px-1.5 py-0" />
              <ReadingStatusBadge pending={pending} cfg={cfg} />
              <PublicationStatusBadge
                statusId={work.publicationStatusId}
                iconOnly
                hiatusKind={work.hiatusKind}
                hiatusKindConfidence={work.hiatusKindConfidence}
                publicationStatusNote={work.publicationStatusNote}
              />
            </div>
          </div>

          {fraction != null && (
            <div className="flex items-center gap-2.5">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full", cfg.progress)}
                  style={{ width: `${Math.round(fraction * 100)}%` }}
                />
              </div>
              <span className="min-w-10 text-right text-sm tabular-nums text-muted-foreground">
                {Math.round(fraction * 100)}%
              </span>
            </div>
          )}

          {/* No celular a coluna de texto tem ~190px e o par stepper → "Último lançado" não cabe: a seta sai
              e o lançado desce de linha se precisar, em vez de ser cortado pelo `overflow-hidden` do card. */}
          <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Último lido
              </span>
              <div className="flex h-9 items-center rounded-lg border border-border/80">
                <button
                  type="button"
                  onClick={() => bump(-1)}
                  disabled={read <= 0}
                  aria-label="Diminuir capítulos lidos"
                  className="grid h-9 w-8 place-items-center rounded-l-lg text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                >
                  <Minus className="size-4" />
                </button>
                <span className="min-w-10 px-1 text-center text-2xl font-bold tabular-nums leading-none">
                  {read}
                </span>
                <button
                  type="button"
                  onClick={() => bump(1)}
                  aria-label="Aumentar capítulos lidos"
                  className="grid h-9 w-8 place-items-center rounded-r-lg text-foreground transition-colors hover:bg-muted"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
            <span className="hidden h-9 items-center text-muted-foreground/50 sm:flex">→</span>
            <Stat label="Último lançado" value={lancado ?? "—"} highlight={result?.hasNew} />
            {saving && (
              <span className="flex h-9 items-center">
                <Loader2 className="size-4 animate-spin text-muted-foreground/60" />
              </span>
            )}
          </div>

          <div className="min-h-[1.25rem] space-y-0.5 text-sm text-muted-foreground">
            {!work.lastReadAt && work.lastTouchedAt && (
              <span className="flex items-center gap-1.5 text-muted-foreground/70">
                <BookOpenCheck className="size-4 shrink-0" /> Sem data de leitura · última alteração:{" "}
                {formatRelativeDate(work.lastTouchedAt)}
              </span>
            )}
            {work.lastReadAt && (
              <span className="flex items-center gap-1.5 text-muted-foreground/70">
                <BookOpenCheck className="size-4 shrink-0" /> Última leitura:{" "}
                {formatRelativeDate(work.lastReadAt)}
                {isRecentlyStarted(work, result) && (
                  <span className="font-medium text-rose-600 dark:text-rose-400">
                    · recém-começou
                  </span>
                )}
              </span>
            )}
            {result?.failed ? (
              <span className="flex items-center gap-1.5">
                <AlertCircle className="size-4" /> não verificado
              </span>
            ) : (
              <>
                {result?.statusApplied && (
                  <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                    <RotateCw className="size-4 shrink-0" /> Status atualizado →{" "}
                    {APPLIED_STATUS_LABEL[result.statusApplied] ?? result.statusApplied}
                  </span>
                )}
                {(releasedAge || predictedIso) && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
                    {releasedAge && (
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-4 shrink-0" /> Último cap lançado {releasedAge}
                      </span>
                    )}
                    {predictedIso &&
                      (predictedOverdue ? (
                        <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                          <CalendarClock className="size-4 shrink-0 text-amber-500" /> Próximo previsto:{" "}
                          {predictedShort} <span className="font-semibold">· já passou</span>
                        </span>
                      ) : (
                        predicted && (
                          <span className="flex items-center gap-1.5 text-foreground/80">
                            <CalendarClock className="size-4 shrink-0 text-sky-500" /> Próximo cap previsto:{" "}
                            {predicted}
                          </span>
                        )
                      ))}
                  </div>
                )}
              </>
            )}
          </div>

          <ReadingFilterEcho work={work} filters={filters} />

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
            {readUrl ? (
              <Button asChild size="sm" variant="outline">
                <a href={readUrl} target="_blank" rel="noopener noreferrer">
                  <BookOpen className="mr-1.5 size-3.5" />
                  Continuar lendo
                  <ExternalLink className="ml-1.5 size-3" />
                </a>
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground/70">
                Sem link (verifique atualizações)
              </span>
            )}

            {canMarkLatest && (
              <Button
                size="sm"
                onClick={markLatest}
                title={`Marcar como lido até o capítulo ${wholeChapters(lancado)}`}
                className="bg-none bg-emerald-600 text-white shadow-sm shadow-emerald-500/25 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-600"
              >
                <CheckCheck className="mr-1.5 size-3.5" />
                Marcar até o {wholeChapters(lancado)}
              </Button>
            )}

            {showActions && (
              <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={moveToOnHold}
                  disabled={acting}
                  className="text-muted-foreground"
                  title="Mover para On-hold (sai da lista de leitura)"
                >
                  {acting ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <PauseCircle className="mr-1.5 size-3.5" />
                  )}
                  On-hold
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={archive}
                  disabled={acting}
                  className="text-muted-foreground"
                  title="Arquivar obra"
                >
                  <Archive className="mr-1.5 size-3.5" />
                  Arquivar
                </Button>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** Selo "Em dia" (leu tudo) vs "{N} pra ler" (capítulos lançados não lidos), na cor da banda. */
function ReadingStatusBadge({ pending, cfg }: { pending: number | null; cfg: BandConfig }) {
  if (pending == null) return null
  if (pending > 0) {
    return (
      <Badge className={cn("gap-1", cfg.chip)}>
        <BookOpen className="size-3" />
        {pending} pra ler
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className={cn("gap-1", cfg.chip)}>
      <Check className="size-3" />
      Em dia
    </Badge>
  )
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string
  value: number | string
  highlight?: boolean
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex h-9 items-center">
        <span
          className={cn(
            "text-2xl font-bold tabular-nums leading-none",
            highlight ? "text-emerald-500" : "text-foreground",
          )}
        >
          {value}
        </span>
      </div>
    </div>
  )
}

"use client"

import { useState, useMemo, useTransition, useEffect, useRef } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { toast } from "sonner"
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
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { CoverImage } from "@/components/ui/cover-image"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { PublicationStatusBadge } from "@/components/ui/status-badge"
import { AdultBadge } from "@/components/ui/adult-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import { formatRelativeDate, formatPredictedDate, formatRelativeDateTime } from "@/lib/date-utils"
import { checkReadingUpdates, type ReadingUpdateResult } from "@/server/actions/reading"
import { setChaptersRead } from "@/server/actions/works"
import type { ReadingWork } from "@/server/queries/reading"

type SortKey = "last_read" | "released" | "predicted" | "progress"
type SectionKey = "ongoing" | "others"

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
  others: {
    label: "Concluída & outras",
    dotClass: "bg-emerald-500",
    hint: "completa · hiato · cancelada — dá pra maratonar até o fim",
  },
}

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

/**
 * Quantos capítulos lançados ainda não foram lidos. Preferência: contagem EXATA da
 * lista real (coffeemanga, pós-check), mas só enquanto `read` for o valor salvo — depois
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

/** Publicação em andamento (dita a divisão em seções). Status ausente cai em "outras". */
function isOngoing(w: ReadingWork): boolean {
  const id = w.publicationStatusId
  return id != null && PUBLICATION_STATUSES_BY_ID[id]?.status === "Ongoing"
}

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

export function ReadingList({ works }: { works: ReadingWork[] }) {
  const refresh = useRefresh()
  const [results, setResults] = useState<Record<string, ReadingUpdateResult>>({})
  const [checking, startCheck] = useTransition()
  const [readFilter, setReadFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<SortKey>("last_read")
  // Otimista: marca "agora" assim que a checagem termina (antes do refresh trazer o persistido).
  const [justCheckedAt, setJustCheckedAt] = useState<string | null>(null)

  // Estado das seções (accordion). `null` = ainda não interagiu → cai no default (só
  // "Em andamento" aberta, ou "outras" se não houver nenhuma em andamento). Depois do
  // primeiro clique, passa a valer o Set explícito.
  const [openKeys, setOpenKeys] = useState<Set<SectionKey> | null>(null)
  const ongoingRef = useRef<HTMLElement>(null)
  const othersRef = useRef<HTMLElement>(null)
  const pendingScroll = useRef<SectionKey | null>(null)

  // Última verificação = a mais recente entre as obras (cada uma grava chapters_checked_at).
  const lastChecked = useMemo(() => {
    const times = works.map((w) => w.chaptersCheckedAt).filter((t): t is string => t != null)
    const latest = times.sort().at(-1) ?? null
    return justCheckedAt && (!latest || justCheckedAt > latest) ? justCheckedAt : latest
  }, [works, justCheckedAt])

  const displayed = useMemo(() => {
    let list = works
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
  }, [works, readFilter, sortBy, results])

  const ongoing = useMemo(() => displayed.filter(isOngoing), [displayed])
  const others = useMemo(() => displayed.filter((w) => !isOngoing(w)), [displayed])

  // Default de abertura quando o usuário ainda não interagiu.
  const defaultOpen: SectionKey = ongoing.length > 0 ? "ongoing" : "others"
  const effectiveOpen = openKeys ?? new Set<SectionKey>([defaultOpen])
  const isOpen = (key: SectionKey) => effectiveOpen.has(key)

  // Rola até a seção depois que ela expande (efeito só faz scroll — nada de setState).
  useEffect(() => {
    const key = pendingScroll.current
    if (!key) return
    pendingScroll.current = null
    const ref = key === "ongoing" ? ongoingRef : othersRef
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [openKeys])

  // Clique na aba: abre só aquela, fecha a outra e rola até ela.
  const selectSection = (key: SectionKey) => {
    pendingScroll.current = key
    setOpenKeys(new Set([key]))
  }

  // Clique no cabeçalho: alterna aquela seção livremente (pode deixar as duas abertas).
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
    startCheck(async () => {
      try {
        const res = await checkReadingUpdates(works.map((w) => w.id))
        const map: Record<string, ReadingUpdateResult> = {}
        for (const r of res) map[r.workId] = r
        setResults(map)
        setJustCheckedAt(new Date().toISOString())
        const news = res.filter((r) => r.hasNew).length
        const failedWorks = res.filter((r) => r.failed)
        const statusChanges = res.filter((r) => r.statusApplied).length

        const descParts: string[] = []
        if (statusChanges > 0) descParts.push(`${statusChanges} mudança(s) de status`)
        if (failedWorks.length > 0) {
          // Nomeia AS OBRAS que ficaram sem retorno — o toast é global e antes só dizia
          // "N fonte(s) não responderam", o que dava a entender que uma fonte externa caiu.
          // A falha é por OBRA (nenhuma fonte de capítulo respondeu por ela), então mostra
          // quais foram (até 3 nomes + "e mais N").
          const titleById = new Map(works.map((w) => [w.id, w.title]))
          const names = failedWorks
            .map((r) => titleById.get(r.workId))
            .filter((t): t is string => !!t)
          const shown = names.slice(0, 3).join(", ")
          const extra = names.length > 3 ? ` e mais ${names.length - 3}` : ""
          const plural = failedWorks.length !== 1
          descParts.push(
            `${failedWorks.length} obra${plural ? "s" : ""} não verificada${plural ? "s" : ""}` +
              (names.length > 0 ? `: ${shown}${extra}` : ""),
          )
        }

        // Verde só quando houve novidade; caiu em aviso quando o único destaque é falha.
        const notify =
          news === 0 && failedWorks.length > 0 ? toast.warning : toast.success
        notify(
          news > 0
            ? `${news} obra${news !== 1 ? "s" : ""} com capítulo novo`
            : "Nenhuma novidade encontrada",
          descParts.length > 0 ? { description: descParts.join(" · ") } : undefined,
        )
        refresh() // traz hids recém-persistidos pra próxima carga
      } catch (err) {
        toast.error("Falha ao verificar atualizações", {
          description: err instanceof Error ? err.message : undefined,
        })
      }
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

  const filtering = readFilter !== "all"

  return (
    <div className="space-y-4">
      {/* Abas de topo = split de publicação; controlam qual seção abre + rolam até ela. */}
      <div className="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground">
        {(Object.keys(SECTIONS) as SectionKey[]).map((key) => {
          const count = key === "ongoing" ? ongoing.length : others.length
          return (
            <button
              key={key}
              type="button"
              onClick={() => selectSection(key)}
              disabled={count === 0}
              className={cn(
                "inline-flex h-full items-center gap-2 rounded-md border border-transparent px-3.5 text-sm font-medium whitespace-nowrap transition-all",
                "text-foreground/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
                isOpen(key) &&
                  "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30 dark:text-foreground",
              )}
            >
              <span className={cn("size-1.5 rounded-full", SECTIONS[key].dotClass)} />
              {SECTIONS[key].label}
              <span className="tabular-nums text-muted-foreground">{count}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {filtering
              ? `${displayed.length} de ${works.length}`
              : `${works.length} obra${works.length !== 1 ? "s" : ""} acompanhada${works.length !== 1 ? "s" : ""}`}
          </p>

          <Select value={readFilter} onValueChange={setReadFilter}>
            <SelectTrigger size="sm" className="w-auto min-w-28 gap-1.5 text-xs">
              <BookOpenCheck className="size-3.5 text-muted-foreground" />
              <SelectValue />
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
              <SelectValue />
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

        <div className="flex flex-col items-end gap-1">
          <Button size="sm" onClick={handleCheckAll} disabled={checking}>
            {checking ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Verificar atualizações
          </Button>
          {lastChecked && (
            <span className="text-[11px] text-muted-foreground">
              Última verificação: {formatRelativeDateTime(lastChecked)}
            </span>
          )}
        </div>
      </div>

      {displayed.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nenhuma obra com esse filtro.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {ongoing.length > 0 && (
            <ReadingSection
              ref={ongoingRef}
              sectionKey="ongoing"
              count={ongoing.length}
              open={isOpen("ongoing")}
              onToggle={() => toggleSection("ongoing")}
            >
              {ongoing.map((work) => (
                <ReadingCard key={work.id} work={work} result={results[work.id]} />
              ))}
            </ReadingSection>
          )}
          {others.length > 0 && (
            <ReadingSection
              ref={othersRef}
              sectionKey="others"
              count={others.length}
              open={isOpen("others")}
              onToggle={() => toggleSection("others")}
            >
              {others.map((work) => (
                <ReadingCard key={work.id} work={work} result={results[work.id]} />
              ))}
            </ReadingSection>
          )}
        </div>
      )}
    </div>
  )
}

/** Seção colapsável (cabeçalho com contagem + grade de cards). */
function ReadingSection({
  ref,
  sectionKey,
  count,
  open,
  onToggle,
  children,
}: {
  ref: React.Ref<HTMLElement>
  sectionKey: SectionKey
  count: number
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const cfg = SECTIONS[sectionKey]
  return (
    <section ref={ref} className="scroll-mt-4 space-y-3">
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
      {open && <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{children}</div>}
    </section>
  )
}

/** Card de uma obra, com edição in-loco do progresso (stepper + "marcar até o último"). */
function ReadingCard({
  work,
  result,
}: {
  work: ReadingWork
  result: ReadingUpdateResult | undefined
}) {
  // Progresso local otimista. `read` é a fonte da verdade da UI do card; o servidor é
  // atualizado com debounce. Ressincroniza se o valor persistido mudar (ex.: pós-refresh)
  // pelo padrão "adjust during render": roda na render, só quando o prop de fato muda —
  // sem effect (que dispararia render em cascata).
  const [read, setRead] = useState(work.chaptersRead ?? 0)
  const [syncedFrom, setSyncedFrom] = useState(work.chaptersRead)
  const [saving, startSave] = useTransition()
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
        const res = await setChaptersRead(work.id, value)
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
  }

  const markLatest = () => {
    if (lancado == null) return
    const next = wholeChapters(lancado)
    setRead(next)
    persist(next, true)
    toast.success(`Marcado como lido até o ${next}`)
  }

  const pending = pendingOf(work, result, read)
  const fraction = lancado != null && lancado > 0 ? Math.min(1, Math.max(0, read / lancado)) : null
  const canMarkLatest = lancado != null && read < lancado

  const accent =
    pending == null
      ? "border-l-transparent"
      : pending > 0
        ? "border-l-amber-500/70"
        : "border-l-emerald-500/40"

  // "Continuar lendo" → fonte com o cap mais recente (pós-check); senão comix por hid (load).
  const readUrl = result?.latestUrl ?? (work.comixHid ? comixUrlFor(work.comixHid) : null)
  // Data do último cap: absoluta da fonte (coffeemanga) ou relativa da comix pós-check;
  // senão a cacheada no DB (load).
  const releasedAge = result?.releasedAt
    ? formatRelativeDate(result.releasedAt)
    : result?.releasedLabel
      ? formatComixAge(result.releasedLabel)
      : work.lastChapterReleasedAt
        ? formatRelativeDate(work.lastChapterReleasedAt)
        : null
  const predicted = formatPredictedDate(result?.nextPredictedAt ?? work.nextChapterPredictedAt)

  return (
    <Card className={cn("overflow-hidden border-l-4", accent)}>
      <CardContent className="flex gap-4 p-3">
        <CoverImage
          url={work.coverUrl}
          alt={work.title}
          className="h-36 w-24 shrink-0 rounded-lg object-cover ring-1 ring-border/60"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <div className="flex items-start justify-between gap-2">
            <WorkTitleLink
              title={work.title}
              workId={work.id}
              className="line-clamp-2 text-base font-semibold leading-snug hover:underline"
            />
            <div className="flex shrink-0 items-center gap-1.5">
              {work.isAdult && <AdultBadge className="px-1.5 py-0" />}
              <ReadingStatusBadge pending={pending} />
              <PublicationStatusBadge statusId={work.publicationStatusId} iconOnly />
            </div>
          </div>

          {fraction != null && (
            <div className="flex items-center gap-2.5">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    pending === 0 ? "bg-emerald-500" : "bg-amber-500",
                  )}
                  style={{ width: `${Math.round(fraction * 100)}%` }}
                />
              </div>
              <span className="min-w-9 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(fraction * 100)}%
              </span>
            </div>
          )}

          <div className="flex items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Último lido
              </span>
              <div className="flex items-center rounded-lg border border-border/80">
                <button
                  type="button"
                  onClick={() => bump(-1)}
                  disabled={read <= 0}
                  aria-label="Diminuir capítulos lidos"
                  className="grid h-8 w-7 place-items-center rounded-l-lg text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                >
                  <Minus className="size-3.5" />
                </button>
                <span className="min-w-9 px-1 text-center text-lg font-bold tabular-nums leading-none">
                  {read}
                </span>
                <button
                  type="button"
                  onClick={() => bump(1)}
                  aria-label="Aumentar capítulos lidos"
                  className="grid h-8 w-7 place-items-center rounded-r-lg text-foreground transition-colors hover:bg-muted"
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
            </div>
            <span className="mb-1.5 text-muted-foreground/50">→</span>
            <Stat label="Último lançado" value={lancado ?? "—"} highlight={result?.hasNew} />
            {result?.hasNew && (
              <Badge className="mb-1 gap-1 border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                +{result.delta != null ? Math.max(1, wholeChapters(result.delta)) : ""} novo
                {result.delta != null && Math.max(1, wholeChapters(result.delta)) !== 1 ? "s" : ""}
              </Badge>
            )}
            {saving && <Loader2 className="mb-1.5 size-3.5 animate-spin text-muted-foreground/60" />}

            {/* Botão discreto de "marcar até o último", à direita da linha dos capítulos. */}
            {canMarkLatest && (
              <button
                type="button"
                onClick={markLatest}
                title={`Marcar como lido até o capítulo ${wholeChapters(lancado)}`}
                className="mb-0.5 ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-medium text-muted-foreground transition-colors hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400"
              >
                <CheckCheck className="size-3.5" />
                Marcar até o {wholeChapters(lancado)}
              </button>
            )}
          </div>

          <div className="min-h-[1.25rem] space-y-0.5 text-[13px] text-muted-foreground">
            {result?.failed ? (
              <span className="flex items-center gap-1.5">
                <AlertCircle className="size-3.5" /> não verificado
              </span>
            ) : result?.skipped ? (
              <span className="flex items-center gap-1.5">
                <Check className="size-3.5 shrink-0 text-emerald-500" /> Concluída — sem capítulos novos
              </span>
            ) : (
              <>
                {result?.statusApplied && (
                  <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
                    <RotateCw className="size-3.5 shrink-0" /> Status atualizado →{" "}
                    {APPLIED_STATUS_LABEL[result.statusApplied] ?? result.statusApplied}
                  </span>
                )}
                {releasedAge && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="size-3.5 shrink-0" /> Último cap lançado {releasedAge}
                  </span>
                )}
                {predicted && (
                  <span className="flex items-center gap-1.5 text-foreground/80">
                    <CalendarClock className="size-3.5 shrink-0 text-sky-500" /> Próximo cap previsto: {predicted}
                  </span>
                )}
              </>
            )}
          </div>

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
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/** Selo "Em dia" (leu tudo) vs "{N} pra ler" (capítulos lançados não lidos). */
function ReadingStatusBadge({ pending }: { pending: number | null }) {
  if (pending == null) return null
  if (pending > 0) {
    return (
      <Badge className="gap-1 border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <BookOpen className="size-3" />
        {pending} pra ler
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
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
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-xl font-bold tabular-nums leading-none",
          highlight ? "text-emerald-500" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  )
}

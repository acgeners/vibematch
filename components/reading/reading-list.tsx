"use client"

import { useState, useMemo, useTransition } from "react"
import { useRefresh } from "@/lib/use-refresh"
import { toast } from "sonner"
import { RefreshCw, Loader2, BookOpen, Clock, CalendarClock, ExternalLink, AlertCircle, Filter, ArrowDownUp, Check, BookOpenCheck, Hourglass, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { CoverImage } from "@/components/ui/cover-image"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { PublicationStatusBadge } from "@/components/ui/status-badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import { formatRelativeDate, formatPredictedDate, formatRelativeDateTime } from "@/lib/date-utils"
import { checkReadingUpdates, type ReadingUpdateResult } from "@/server/actions/reading"
import type { ReadingWork } from "@/server/queries/reading"

type SortKey = "last_read" | "released" | "predicted"
type Variant = "reading" | "hiatus"

// Uma obra "voltou a publicar" se o último cap saiu dentro dessa janela (ou se a
// checagem achou um cap novo além do que tínhamos registrado).
const RESUMED_WINDOW_DAYS = 35

// Rótulo PT curto pros status que a checagem pode APLICAR (transições de fim/hiato).
const APPLIED_STATUS_LABEL: Record<string, string> = {
  Completed: "Completo",
  Hiatus: "Hiato",
  Cancelled: "Cancelado",
}

const VARIANT: Record<
  Variant,
  {
    countNoun: string
    filterIcon: typeof BookOpenCheck
    filterOptions: Array<[value: string, label: string]>
    defaultSort: SortKey
    empty: string
  }
> = {
  reading: {
    countNoun: "em leitura",
    filterIcon: BookOpenCheck,
    filterOptions: [
      ["all", "Leitura: todas"],
      ["pending", "Com cap. pra ler"],
      ["uptodate", "Em dia"],
    ],
    defaultSort: "last_read",
    empty: "Nenhuma obra com status “Reading” no momento.",
  },
  hiatus: {
    countNoun: "em hiatus",
    filterIcon: Hourglass,
    filterOptions: [
      ["all", "Status: todos"],
      ["resumed", "Voltou"],
      ["paused", "Parada"],
    ],
    defaultSort: "released",
    empty: "Nenhuma obra em hiatus no momento.",
  },
}

const SORT_LABELS: Record<SortKey, string> = {
  last_read: "Última leitura",
  released: "Último lançamento",
  predicted: "Próximo previsto",
}

/**
 * Conta capítulos como inteiros: cada decimal (ex.: 129.7) é 1 capítulo inteiro,
 * então arredonda pra cima. O `toFixed(3)` mata o ruído de ponto flutuante
 * (129.7 − 121 = 8.699999999999989 → 9).
 */
function wholeChapters(n: number): number {
  return Math.max(0, Math.ceil(Number(n.toFixed(3))))
}

/**
 * Quantos capítulos lançados ainda não foram lidos. Preferência: contagem EXATA da
 * lista real (coffeemanga, pós-check). Senão estima pelo último cap externo / o
 * `total_chapters` salvo. `null` quando não dá pra saber.
 */
function pendingOf(w: ReadingWork, results: Record<string, ReadingUpdateResult>): number | null {
  const r = results[w.id]
  if (r?.unreadCount != null) return r.unreadCount
  const lancado = r?.latestExternal ?? w.totalChapters
  if (lancado == null) return null
  return wholeChapters(lancado - (w.chaptersRead ?? 0))
}

/** Dias desde o último capítulo (pós-check ou cacheado). `null` quando desconhecido. */
function daysSinceRelease(w: ReadingWork, results: Record<string, ReadingUpdateResult>): number | null {
  const iso = results[w.id]?.releasedAt ?? w.lastChapterReleasedAt ?? null
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.floor((Date.now() - t) / 86_400_000)
}

/** Obra em hiatus que voltou a publicar: cap recente ou capítulo novo achado na checagem. */
function isResumed(w: ReadingWork, results: Record<string, ReadingUpdateResult>): boolean {
  if (results[w.id]?.hasNew) return true
  const d = daysSinceRelease(w, results)
  return d != null && d <= RESUMED_WINDOW_DAYS
}

function matchesReadFilter(
  variant: Variant,
  w: ReadingWork,
  results: Record<string, ReadingUpdateResult>,
  filter: string,
): boolean {
  if (filter === "all") return true
  if (variant === "reading") {
    const p = pendingOf(w, results)
    if (p == null) return false
    return filter === "pending" ? p > 0 : p === 0
  }
  const resumed = isResumed(w, results)
  return filter === "resumed" ? resumed : !resumed
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

const SORTERS: Record<SortKey, (a: ReadingWork, b: ReadingWork) => number> = {
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
  variant = "reading",
}: {
  works: ReadingWork[]
  variant?: Variant
}) {
  const refresh = useRefresh()
  const cfg = VARIANT[variant]
  const [results, setResults] = useState<Record<string, ReadingUpdateResult>>({})
  const [checking, startCheck] = useTransition()
  const [pubFilter, setPubFilter] = useState<string>("all")
  const [readFilter, setReadFilter] = useState<string>("all")
  const [sortBy, setSortBy] = useState<SortKey>(cfg.defaultSort)
  // Otimista: marca "agora" assim que a checagem termina (antes do refresh trazer o persistido).
  const [justCheckedAt, setJustCheckedAt] = useState<string | null>(null)

  // Última verificação = a mais recente entre as obras (cada uma grava chapters_checked_at).
  const lastChecked = useMemo(() => {
    const times = works.map((w) => w.chaptersCheckedAt).filter((t): t is string => t != null)
    const latest = times.sort().at(-1) ?? null
    return justCheckedAt && (!latest || justCheckedAt > latest) ? justCheckedAt : latest
  }, [works, justCheckedAt])

  // Status de publicação presentes nas obras (pro mini-filtro).
  const pubOptions = useMemo(() => {
    const ids = Array.from(
      new Set(works.map((w) => w.publicationStatusId).filter((id): id is number => id != null)),
    )
    return ids
      .map((id) => ({ id, info: PUBLICATION_STATUSES_BY_ID[id] }))
      .filter((o) => o.info)
      .sort((a, b) => a.id - b.id)
  }, [works])

  const displayed = useMemo(() => {
    let list =
      pubFilter === "all" ? works : works.filter((w) => String(w.publicationStatusId) === pubFilter)
    if (readFilter !== "all") {
      list = list.filter((w) => matchesReadFilter(variant, w, results, readFilter))
    }
    return [...list].sort(SORTERS[sortBy])
  }, [works, variant, pubFilter, readFilter, sortBy, results])

  const handleCheckAll = () => {
    startCheck(async () => {
      try {
        const res = await checkReadingUpdates(works.map((w) => w.id))
        const map: Record<string, ReadingUpdateResult> = {}
        for (const r of res) map[r.workId] = r
        setResults(map)
        setJustCheckedAt(new Date().toISOString())
        const news = res.filter((r) => r.hasNew).length
        const failed = res.filter((r) => r.failed).length
        const statusChanges = res.filter((r) => r.statusApplied).length
        const descParts = [
          statusChanges > 0
            ? `${statusChanges} mudança(s) de status`
            : null,
          failed > 0 ? `${failed} fonte(s) não responderam` : null,
        ].filter(Boolean)
        toast.success(
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
          {cfg.empty}
        </CardContent>
      </Card>
    )
  }

  const filtering = pubFilter !== "all" || readFilter !== "all"

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted-foreground">
            {filtering
              ? `${displayed.length} de ${works.length}`
              : `${works.length} obra${works.length !== 1 ? "s" : ""} ${cfg.countNoun}`}
          </p>

          {pubOptions.length > 1 && (
            <Select value={pubFilter} onValueChange={setPubFilter}>
              <SelectTrigger size="sm" className="w-auto min-w-32 gap-1.5 text-xs">
                <Filter className="size-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                {pubOptions.map(({ id, info }) => (
                  <SelectItem key={id} value={String(id)}>
                    {info.symbol} {info.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={readFilter} onValueChange={setReadFilter}>
            <SelectTrigger size="sm" className="w-auto min-w-28 gap-1.5 text-xs">
              <cfg.filterIcon className="size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {cfg.filterOptions.map(([value, label]) => (
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
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {displayed.map((work) => {
          const result = results[work.id]
          // "Continuar lendo" → fonte com o cap mais recente (pós-check); senão comix por hid (load).
          const readUrl =
            result?.latestUrl ?? (work.comixHid ? comixUrlFor(work.comixHid) : null)
          // "Último lançado": último cap externo após verificar, senão o último total conhecido.
          const lancado = result?.latestExternal ?? work.totalChapters
          // Diferenciação por variante: leitura → "em dia"/"pra ler"; hiatus → "voltou"/"parada".
          const pending = pendingOf(work, results)
          const resumed = isResumed(work, results)
          const statusBadge =
            variant === "reading" ? (
              <ReadingStatusBadge pending={pending} />
            ) : (
              <HiatusStatusBadge resumed={resumed} />
            )
          const accent =
            variant === "reading"
              ? pending == null
                ? "border-l-transparent"
                : pending > 0
                  ? "border-l-amber-500/70"
                  : "border-l-emerald-500/40"
              : resumed
                ? "border-l-emerald-500/70"
                : "border-l-transparent"
          // Data do último cap: absoluta da fonte (coffeemanga) ou relativa da comix
          // pós-check; senão a cacheada no DB (load).
          const releasedAge = result?.releasedAt
            ? formatRelativeDate(result.releasedAt)
            : result?.releasedLabel
              ? formatComixAge(result.releasedLabel)
              : work.lastChapterReleasedAt
                ? formatRelativeDate(work.lastChapterReleasedAt)
                : null
          const predicted = formatPredictedDate(result?.nextPredictedAt ?? work.nextChapterPredictedAt)

          return (
            <Card key={work.id} className={cn("overflow-hidden border-l-4", accent)}>
              <CardContent className="flex gap-4 p-3">
                <CoverImage
                  url={work.coverUrl}
                  alt={work.title}
                  className="h-36 w-24 shrink-0 rounded-lg object-cover ring-1 ring-border/60"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <WorkTitleLink
                      title={work.title}
                      workId={work.id}
                      className="line-clamp-2 text-sm font-semibold leading-snug hover:underline"
                    />
                    <div className="flex shrink-0 items-center gap-1.5">
                      {statusBadge}
                      <PublicationStatusBadge statusId={work.publicationStatusId} iconOnly />
                    </div>
                  </div>

                  <div className="flex items-end gap-3">
                    <Stat label="Último lido" value={work.chaptersRead ?? "—"} />
                    <span className="mb-1.5 text-muted-foreground/50">→</span>
                    <Stat
                      label="Último lançado"
                      value={lancado ?? "—"}
                      highlight={result?.hasNew}
                    />
                    {result?.hasNew && (
                      <Badge className="mb-1 gap-1 border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                        +{result.delta != null ? Math.max(1, wholeChapters(result.delta)) : ""} novo
                        {result.delta != null && Math.max(1, wholeChapters(result.delta)) !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>

                  <div className="min-h-[1.25rem] space-y-0.5 text-[11px] text-muted-foreground">
                    {result?.failed ? (
                      <span className="flex items-center gap-1">
                        <AlertCircle className="size-3" /> não verificado
                      </span>
                    ) : result?.skipped ? (
                      <span className="flex items-center gap-1">
                        <Check className="size-3 shrink-0 text-emerald-500" /> Concluída — sem capítulos novos
                      </span>
                    ) : (
                      <>
                        {result?.statusApplied && (
                          <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                            <RotateCw className="size-3 shrink-0" /> Status atualizado →{" "}
                            {APPLIED_STATUS_LABEL[result.statusApplied] ?? result.statusApplied}
                          </span>
                        )}
                        {releasedAge && (
                          <span className="flex items-center gap-1">
                            <Clock className="size-3 shrink-0" /> Último cap lançado {releasedAge}
                          </span>
                        )}
                        {predicted && (
                          <span className="flex items-center gap-1 text-foreground/75">
                            <CalendarClock className="size-3 shrink-0 text-sky-500" /> Próximo cap previsto: {predicted}
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
        })}
      </div>
      )}
    </div>
  )
}

/** Selo de hiatus: "Voltou" (publicando de novo) vs "Parada". */
function HiatusStatusBadge({ resumed }: { resumed: boolean }) {
  if (resumed) {
    return (
      <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <RotateCw className="size-3" />
        Voltou
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <Hourglass className="size-3" />
      Parada
    </Badge>
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

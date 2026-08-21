"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { isSameMonth } from "date-fns"
import { AlertTriangle } from "lucide-react"
import { CoverImage } from "@/components/ui/cover-image"
import { WorkTitleLink } from "@/components/titles/work-title-link"
import { AdultBadge } from "@/components/ui/adult-badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"
import { cn } from "@/lib/utils"
import {
  buildMarkers,
  buildMonthGrid,
  dateKey,
  groupMarkersByDay,
  summarizeMarkers,
} from "@/lib/reading-calendar"
import type { CalendarMarker, MarkerKind, MarkerOverride } from "@/lib/reading-calendar"
import type { ReadingWork } from "@/server/queries/reading"
import type { ReadingUpdateResult } from "@/server/actions/reading"

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"]

// Geometria das miniaturas (capa 2:3). `ring`/`ring-offset` porque `border-<cor>` é morto
// aqui (regra global `* { border-color }` — ver CLAUDE.md / memória border-color).
const COVER_H = 88
const COVER_W = 59
const GAP = 6
const MORE_W = 32
const MIN_STRIP = 24 // faixa mínima visível de uma capa no leque
const MAX_VISIBLE = 4 // teto DURO de capas por dia; o resto vira "+N"
const CELL_PAD = 14 // padding lateral da célula (px)
const DEFAULT_CELL_W = 140 // estimativa até o ResizeObserver medir (evita flash e casa SSR/cliente)

// Cor do estado no anel da capa.
const RING: Record<MarkerKind, string> = {
  released: "ring-slate-400/70 dark:ring-slate-500/60",
  predicted: "ring-sky-500",
  overdue: "ring-rose-500",
}

function isOngoing(publicationStatusId: number | null): boolean {
  return (
    publicationStatusId != null &&
    PUBLICATION_STATUSES_BY_ID[publicationStatusId]?.status === "Ongoing"
  )
}

export function ReadingCalendar({
  works,
  results,
  monthAnchor,
  nowIso,
}: {
  works: ReadingWork[]
  results: Record<string, ReadingUpdateResult>
  monthAnchor: Date
  nowIso: string
}) {
  // `now` vem do servidor (prop) → SSR e cliente concordam no "hoje" e no mês (sem
  // divergência de fuso na hidratação).
  const now = useMemo(() => new Date(nowIso), [nowIso])

  // Uma checagem recém-disparada tem precedência sobre o valor cacheado na obra.
  const overrides = useMemo<Record<string, MarkerOverride>>(() => {
    const o: Record<string, MarkerOverride> = {}
    for (const [id, r] of Object.entries(results)) {
      o[id] = { releasedAt: r.releasedAt, nextPredictedAt: r.nextPredictedAt }
    }
    return o
  }, [results])

  const markers = useMemo(() => buildMarkers(works, overrides, now), [works, overrides, now])
  const byDay = useMemo(() => groupMarkersByDay(markers), [markers])
  const days = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor])
  const summary = useMemo(() => summarizeMarkers(markers, monthAnchor), [markers, monthAnchor])

  const noPrediction = useMemo(() => {
    const withPred = new Set(markers.filter((m) => m.kind !== "released").map((m) => m.workId))
    return works.filter((w) => isOngoing(w.publicationStatusId) && !withPred.has(w.id)).length
  }, [markers, works])

  // Largura real de uma célula (todas iguais no grid 1fr) — alimenta o leque/"+N".
  // Medida no cliente; começa no default (igual nos dois lados → hidratação estável).
  const gridRef = useRef<HTMLDivElement>(null)
  const [cellW, setCellW] = useState(0)
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = () => {
      const cell = el.firstElementChild as HTMLElement | null
      if (cell) setCellW(cell.clientWidth)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const todayKey = dateKey(now)
  const monthEmpty = summary.released + summary.predicted + summary.overdueInMonth === 0

  return (
    <div className="space-y-3">
      {summary.overdueTotal > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-rose-500/[0.07] px-3 py-2 text-[12.5px] text-rose-600 ring-1 ring-inset ring-rose-500/25 dark:text-rose-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>
            <b className="font-semibold">{summary.overdueTotal} atrasado{summary.overdueTotal !== 1 ? "s" : ""}</b>
            <span className="text-muted-foreground"> — capítulo esperado que ainda não saiu. Marcados em vermelho no dia previsto; use “Verificar atualizações” para refazer a previsão.</span>
          </span>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card/40">
        <div className="grid grid-cols-7 border-b border-border bg-muted/40">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {d}
            </div>
          ))}
        </div>

        <div ref={gridRef} className="grid grid-cols-7">
          {days.map((day) => {
            const key = dateKey(day)
            const dayMarkers = byDay.get(key) ?? []
            const out = !isSameMonth(day, monthAnchor)
            const isToday = key === todayKey
            const isPast = key < todayKey
            return (
              <div
                key={key}
                className={cn(
                  "flex min-h-[7.75rem] min-w-0 flex-col gap-1.5 border-b border-r border-border/60 p-1.5 last:border-r-0 [&:nth-child(7n)]:border-r-0",
                  out ? "bg-muted/20" : isPast ? "bg-foreground/[0.02]" : undefined,
                  isToday && "bg-primary/[0.06]",
                )}
              >
                <div className="flex">
                  <span
                    className={cn(
                      "flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11.5px] font-semibold tabular-nums",
                      isToday
                        ? "bg-primary text-primary-foreground"
                        : out
                          ? "text-muted-foreground/50"
                          : "text-foreground",
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
                {dayMarkers.length > 0 && (
                  <DayCovers markers={dayMarkers} cellW={cellW} dimmed={out} />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {monthEmpty && (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12.5px] text-muted-foreground">
          Nenhum lançamento neste mês. As previsões vêm da última “Verificar atualizações”.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border bg-card/40 px-3.5 py-2.5 text-[12.5px] text-muted-foreground">
        <FootPill dotClass="bg-muted-foreground/50" n={summary.released} label="lançados no mês" />
        <FootPill dotClass="bg-rose-500" n={summary.overdueTotal} label="atrasados" />
        <FootPill dotClass="bg-sky-500" n={summary.predicted} label="previstos no mês" />
        <FootPill dotClass="bg-muted-foreground/30" n={noPrediction} label="em andamento sem previsão" />
      </div>
    </div>
  )
}

/** Quantas capas mostrar e com que sobreposição, dada a largura da célula. */
function computeFan(n: number, cellW: number) {
  const avail = (cellW > 0 ? cellW : DEFAULT_CELL_W) - CELL_PAD
  const capFull = Math.max(1, Math.floor((avail - COVER_W) / MIN_STRIP) + 1)
  const overflow = n > Math.min(MAX_VISIBLE, capFull)
  let vis: number
  let availC: number
  if (!overflow) {
    vis = n
    availC = avail
  } else {
    // reserva o slot do "+N"
    const capMore = Math.max(1, Math.floor((avail - MORE_W - GAP - COVER_W) / MIN_STRIP) + 1)
    vis = Math.min(MAX_VISIBLE, capMore)
    availC = avail - (MORE_W + GAP)
  }
  // passo entre bordas esquerdas: lado a lado se couber, senão sobrepõe (leque) até encaixar
  let step = COVER_W + GAP
  if (vis > 1) step = Math.min(step, Math.max(MIN_STRIP, (availC - COVER_W) / (vis - 1)))
  return { vis, overflow, step, hiddenCount: n - vis }
}

/** Linha única de capas altas de um dia (leque quando lotado) + "+N". */
function DayCovers({
  markers,
  cellW,
  dimmed,
}: {
  markers: CalendarMarker[]
  cellW: number
  dimmed?: boolean
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const n = markers.length
  const { vis, overflow, step, hiddenCount } = computeFan(n, cellW)
  const overlap = step - COVER_W // GAP (positivo) quando lado a lado; negativo no leque

  return (
    <div className={cn("flex min-w-0 items-start", dimmed && "opacity-60")}>
      {markers.slice(0, vis).map((m, i) => (
        <div
          key={`${m.workId}-${m.kind}-${i}`}
          className="relative shrink-0 transition-transform duration-100 hover:-translate-y-1"
          // primeiros por cima (nunca escondem os atrasados/previstos); o hover sobe pra frente.
          style={{ marginLeft: i === 0 ? 0 : overlap, zIndex: hovered === i ? 50 : n - i }}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
        >
          <WorkTitleLink workId={m.workId} title={m.title} className="block">
            <CoverImage
              urls={m.coverUrls}
              alt={m.title}
              className={cn(
                "h-[88px] w-[59px] rounded-md object-cover shadow-sm ring-2 ring-offset-2 ring-offset-background",
                RING[m.kind],
              )}
            />
          </WorkTitleLink>
          {m.kind === "overdue" && (
            <span
              className="pointer-events-none absolute -right-1.5 -top-1.5 grid size-[18px] place-items-center rounded-full bg-rose-500 text-white ring-2 ring-background"
              aria-hidden
            >
              <AlertTriangle className="size-2.5" />
            </span>
          )}
        </div>
      ))}
      {overflow && (
        <MoreTile markers={markers} hiddenCount={hiddenCount} />
      )}
    </div>
  )
}

/** Tile "+N" — abre um popover com a lista completa das obras do dia. */
function MoreTile({ markers, hiddenCount }: { markers: CalendarMarker[]; hiddenCount: number }) {
  return (
    <div className="relative z-[60] shrink-0" style={{ marginLeft: GAP }}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Mais ${hiddenCount} obra${hiddenCount !== 1 ? "s" : ""} neste dia`}
            className="grid w-8 place-items-center rounded-md bg-muted text-xs font-semibold text-muted-foreground shadow-sm ring-1 ring-inset ring-border transition-colors hover:bg-muted/70 hover:text-foreground"
            style={{ height: COVER_H }}
          >
            +{hiddenCount}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-2">
          <p className="px-1.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Lançamentos do dia
          </p>
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {markers.map((m, i) => (
              <WorkTitleLink
                key={`${m.workId}-${m.kind}-${i}`}
                workId={m.workId}
                title={m.title}
                className="flex items-center gap-2.5 rounded-md px-1.5 py-1 transition-colors hover:bg-muted"
              >
                <CoverImage
                  urls={m.coverUrls}
                  alt=""
                  className={cn("h-9 w-6 shrink-0 rounded-sm object-cover ring-1", RING[m.kind])}
                />
                <span className="min-w-0 flex-1 truncate text-[12.5px] leading-tight">{m.title}</span>
                {/* Único lugar do calendário onde a obra aparece por NOME — as células
                    do dia são só capa, e lá o 18+ chega pela prévia de hover. */}
                {m.isAdult && <AdultBadge className="shrink-0 px-1.5 py-0 text-[9.5px] leading-tight" />}
                <span className={cn("size-2 shrink-0 rounded-full", DOT[m.kind])} aria-hidden />
              </WorkTitleLink>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

const DOT: Record<MarkerKind, string> = {
  released: "bg-slate-400",
  predicted: "bg-sky-500",
  overdue: "bg-rose-500",
}

/** Legenda dos estados do calendário. Vive na barra de controles (Linha 2), não dentro da grade. */
export function CalendarLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
      <LegendItem className="ring-slate-400/70" label="Já lançado" />
      <LegendItem className="ring-rose-500" label="Atrasado" />
      <LegendItem className="ring-sky-500" label="Previsto" />
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-full ring-2 ring-inset ring-primary" />
        Hoje
      </span>
    </div>
  )
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3.5 w-2.5 rounded-[3px] bg-muted ring-2 ring-inset", className)} />
      {label}
    </span>
  )
}

function FootPill({ dotClass, n, label }: { dotClass: string; n: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5">
      <span className={cn("size-1.5 rounded-full", dotClass)} />
      <b className="font-semibold tabular-nums text-foreground">{n}</b>
      {label}
    </span>
  )
}

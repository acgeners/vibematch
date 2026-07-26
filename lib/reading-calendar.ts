import {
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import type { ReadingWork } from "@/server/queries/reading"

/**
 * Estado de um marcador no calendário de lançamentos. Cada obra rende no MÁXIMO
 * dois marcadores: o último capítulo lançado (real) e o próximo esperado — que é
 * `predicted` se ainda no futuro, `overdue` se a data já passou e o cap não saiu.
 * Não há projeção pra frente: a cadência é definida direto na fonte a cada checagem.
 */
export type MarkerKind = "released" | "predicted" | "overdue"

export interface CalendarMarker {
  workId: string
  title: string
  coverUrl: string | null
  kind: MarkerKind
  /** Dia do marcador (ISO). */
  dateIso: string
  publicationStatusId: number | null
  personalStatusId: number | null
  chaptersRead: number | null
  totalChapters: number | null
  isAdult: boolean
  expectedScore: number | null
}

/** Sobrescritas vindas de uma checagem recente (in-session), pra o marcador refletir já. */
export type MarkerOverride = { releasedAt?: string | null; nextPredictedAt?: string | null }

/** Chave de dia local (yyyy-MM-dd) — usada pra agrupar marcadores por célula. */
export function dateKey(d: Date | string): string {
  return format(typeof d === "string" ? new Date(d) : d, "yyyy-MM-dd")
}

function isValidDate(iso: string | null | undefined): iso is string {
  if (!iso) return false
  return Number.isFinite(new Date(iso).getTime())
}

/**
 * Constrói os marcadores de todas as obras. `overrides[workId]` (de uma checagem
 * recém-disparada) tem precedência sobre o valor cacheado na obra.
 */
export function buildMarkers(
  works: ReadingWork[],
  overrides: Record<string, MarkerOverride>,
  now: Date,
): CalendarMarker[] {
  const markers: CalendarMarker[] = []
  for (const w of works) {
    const releasedIso = overrides[w.id]?.releasedAt ?? w.lastChapterReleasedAt
    const predictedIso = overrides[w.id]?.nextPredictedAt ?? w.nextChapterPredictedAt

    const base = {
      workId: w.id,
      title: w.title,
      coverUrl: w.coverUrl,
      publicationStatusId: w.publicationStatusId,
      personalStatusId: w.personalStatusId,
      chaptersRead: w.chaptersRead,
      totalChapters: w.totalChapters,
      isAdult: w.isAdult,
      expectedScore: w.expectedScore,
    }

    if (isValidDate(releasedIso)) {
      markers.push({ ...base, kind: "released", dateIso: releasedIso })
    }
    if (isValidDate(predictedIso)) {
      const overdue = differenceInCalendarDays(new Date(predictedIso), now) < 0
      markers.push({ ...base, kind: overdue ? "overdue" : "predicted", dateIso: predictedIso })
    }
  }
  return markers
}

/** Agrupa marcadores por dia (chave `dateKey`). */
export function groupMarkersByDay(markers: CalendarMarker[]): Map<string, CalendarMarker[]> {
  // Ordem = prioridade no leque: atrasado > previsto > lançado. Os primeiros ficam por cima
  // e nunca são truncados no "+N" (que corta os últimos = os já lançados).
  const order: Record<MarkerKind, number> = { overdue: 0, predicted: 1, released: 2 }
  const map = new Map<string, CalendarMarker[]>()
  for (const m of markers) {
    const key = dateKey(m.dateIso)
    const list = map.get(key)
    if (list) list.push(m)
    else map.set(key, [m])
  }
  for (const list of map.values()) list.sort((a, b) => order[a.kind] - order[b.kind])
  return map
}

/**
 * Dias da grade do mês, semana começando na segunda. Preenche até fechar as
 * semanas (últimos dias do mês anterior + primeiros do seguinte), pra a grade
 * sempre ter linhas completas de 7.
 */
export function buildMonthGrid(anchor: Date): Date[] {
  const first = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 })
  const last = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 })
  return eachDayOfInterval({ start: first, end: last })
}

/** Contagem por estado para o mês visível + total de atrasados (independe do mês). */
export function summarizeMarkers(
  markers: CalendarMarker[],
  anchor: Date,
): { released: number; predicted: number; overdueInMonth: number; overdueTotal: number } {
  const y = anchor.getFullYear()
  const m = anchor.getMonth()
  const inMonth = (iso: string) => {
    const d = new Date(iso)
    return d.getFullYear() === y && d.getMonth() === m
  }
  let released = 0
  let predicted = 0
  let overdueInMonth = 0
  let overdueTotal = 0
  for (const mk of markers) {
    if (mk.kind === "overdue") {
      overdueTotal++
      if (inMonth(mk.dateIso)) overdueInMonth++
    } else if (inMonth(mk.dateIso)) {
      if (mk.kind === "released") released++
      else predicted++
    }
  }
  return { released, predicted, overdueInMonth, overdueTotal }
}

import { differenceInCalendarDays, format, isSameYear } from "date-fns"
import { ptBR } from "date-fns/locale"

type DateInput = Date | string | number | null | undefined

function toDate(input: DateInput): Date | null {
  if (input == null) return null
  const d = input instanceof Date ? input : new Date(input)
  return Number.isNaN(d.getTime()) ? null : d
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function formatRelativeDate(input: DateInput): string {
  const d = toDate(input)
  if (!d) return "—"
  const now = new Date()
  const diff = differenceInCalendarDays(now, d)
  if (diff <= 0) return "Hoje"
  if (diff === 1) return "Ontem"
  if (diff <= 6) {
    const weekday = format(d, "EEEE", { locale: ptBR }).replace(/-feira$/, "")
    return capitalize(weekday)
  }
  if (isSameYear(d, now)) return format(d, "dd/MM")
  return format(d, "dd/MM/yy")
}

export function formatRelativeDateTime(input: DateInput): string {
  const d = toDate(input)
  if (!d) return "—"
  return `${formatRelativeDate(d)} ${format(d, "HH:mm")}`
}

export function formatFullDateTime(input: DateInput): string {
  const d = toDate(input)
  if (!d) return "—"
  return d.toLocaleString("pt-BR")
}

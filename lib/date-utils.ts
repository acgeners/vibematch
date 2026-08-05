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

/**
 * Formata uma data FUTURA prevista: "07/06 (em 3 dias)" / "(hoje)" / "(amanhã)" /
 * "(atrasado)". `null` quando a entrada é inválida. Usado pra previsão de próximo cap.
 */
export function formatPredictedDate(input: DateInput): string | null {
  const d = toDate(input)
  if (!d) return null
  const days = differenceInCalendarDays(d, new Date())
  const rel =
    days < 0 ? "atrasado" : days === 0 ? "hoje" : days === 1 ? "amanhã" : `em ${days} dias`
  return `${format(d, "dd/MM")} (${rel})`
}

/**
 * Há quanto tempo, em prosa e minúsculo, pra encaixar no meio de uma frase:
 * "Enviado ontem.", "Enviado há 3 dias.".
 *
 * Irmão de `formatRelativeDate`, não substituto: aquele é um RÓTULO de coluna ("Ontem",
 * "Quarta", "12/03") e por isso vem capitalizado e vira dia da semana na semana corrente —
 * "Enviado quarta" seria ambíguo (que quarta?) onde "há 3 dias" não é.
 *
 * Acima de 30 dias vira data: "há 412 dias" é preciso e inútil.
 */
export function formatTimeAgo(input: DateInput): string {
  const d = toDate(input)
  if (!d) return "—"
  const days = differenceInCalendarDays(new Date(), d)
  if (days <= 0) return "hoje"
  if (days === 1) return "ontem"
  if (days <= 30) return `há ${days} dias`
  return `em ${format(d, isSameYear(d, new Date()) ? "dd/MM" : "dd/MM/yy")}`
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

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

/* ------------------------------------------------------------------ */
/* Data de proveniência (tooltips de IA)                               */
/* ------------------------------------------------------------------ */

/**
 * 🔴 Fuso FIXO, e não o de quem renderiza.
 *
 * Os selos ✨ renderizam nos dois lados: no server component da página da obra e
 * dentro de cards `"use client"` (reviews, Interesse, estrutura de abertura). O
 * servidor em produção roda em UTC e o navegador em UTC−3 — com o fuso do runtime,
 * o HTML do SSR sairia "Hoje às 21:40" e a hidratação recalcularia "Hoje às 18:40",
 * que é a mesma classe de quebra da sidebar em `localStorage`. Ancorar em
 * São Paulo dá o MESMO texto nos dois lados e é o fuso de quem lê.
 */
const PROVENANCE_TZ = "America/Sao_Paulo"

const PROVENANCE_PARTS = new Intl.DateTimeFormat("pt-BR", {
  timeZone: PROVENANCE_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "long",
})

function zonedParts(d: Date) {
  const p = Object.fromEntries(PROVENANCE_PARTS.formatToParts(d).map((x) => [x.type, x.value]))
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: p.hour ?? "00",
    minute: p.minute ?? "00",
    weekday: p.weekday ?? "",
    ymd: p.day && p.month && p.year ? `${p.day}/${p.month}/${p.year}` : null,
  }
}

/**
 * Quando um artefato de IA foi gerado, na régua dos selos ✨:
 * `Hoje às 09:14` · `Ontem às 22:40` · `Terça às 14:30` · `10/08/2026`.
 *
 * A pergunta que se faz olhando um selo é "isso ainda vale?", e a distância em dias
 * responde melhor que o número — mas só enquanto ela IDENTIFICA o dia. O corte fica
 * em 6 dias (e não nos 7 do pedido) porque na volta da semana o nome do dia repete o
 * de hoje: numa quarta, "Quarta" seria hoje ou sete dias atrás, sem como distinguir.
 *
 * Irmão de `formatRelativeDateTime`, não substituto: aquele usa o fuso do runtime e
 * vive em telas 100% client (lista de leitura, histórico de runs), onde não há SSR
 * pra divergir.
 */
export function formatProvenanceWhen(input: DateInput): string | null {
  const d = toDate(input)
  if (!d) return null
  const at = zonedParts(d)
  const now = zonedParts(new Date())
  const days =
    (Date.UTC(now.year, now.month - 1, now.day) - Date.UTC(at.year, at.month - 1, at.day)) / 86_400_000

  const time = `${at.hour}:${at.minute}`
  if (days === 0) return `Hoje às ${time}`
  if (days === 1) return `Ontem às ${time}`
  if (days >= 2 && days <= 6) {
    return `${capitalize(at.weekday.replace(/-feira$/, ""))} às ${time}`
  }
  // ≥7 dias — e também data no FUTURO, que só existe por relógio torto: nos dois
  // casos o número é o que informa.
  return at.ymd
}

/**
 * Regras dos lotes de `/curation/settings?g=fontes` ("Capítulos e status", "Reviews do catálogo").
 * Os dois recebem os alvos JÁ ordenados da checagem mais antiga para a mais recente (nunca
 * checadas primeiro), então "as N primeiras" são as N que mais precisam.
 */

/** A checagem mais recente entre os alvos — é a "última execução" do lote. `null` = nunca rodou. */
export function latestCheck(targets: ReadonlyArray<{ checkedAt: string | null }>): string | null {
  let max: string | null = null
  for (const t of targets) if (t.checkedAt && (max == null || t.checkedAt > max)) max = t.checkedAt
  return max
}

/** As `n` primeiras. Sem número, zero, negativo ou maior que o total: todas. */
export function firstN<T>(targets: readonly T[], n: number | null | undefined): T[] {
  if (n == null || !Number.isFinite(n) || n <= 0 || n >= targets.length) return [...targets]
  return targets.slice(0, Math.floor(n))
}

/** "16/11/2026 às 02:37", no fuso de São Paulo (fixo: o servidor do Fly roda em UTC). */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d)
  const p = (type: string) => parts.find((x) => x.type === type)?.value ?? ""
  return `${p("day")}/${p("month")}/${p("year")} às ${p("hour")}:${p("minute")}`
}

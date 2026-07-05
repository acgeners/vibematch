/**
 * Formatadores compartilhados do painel /ai-usage. Centralizados aqui pra não
 * duplicar entre a página (server) e os componentes interativos (client).
 */

export function formatUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0.00"
  if (value < 0.005) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

/** Custo com 3 casas — p/ custo-por-item pequeno (custo/sucesso, por chamada). */
export function formatUsdPrecise(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—"
  if (value === 0) return "$0.000"
  return `$${value.toFixed(3)}`
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return value.toLocaleString("pt-BR")
}

export function formatPct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

export function formatLatency(ms: number | null): string {
  if (ms == null) return "—"
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

/**
 * Tempo relativo (ex.: "3min atrás"). Depende do relógio, então em client
 * component SSR-ado o valor difere entre servidor e cliente — quem usa deve
 * marcar o elemento com `suppressHydrationWarning` (padrão do React p/ tempo).
 */
export function formatRelative(iso: string): string {
  const dt = new Date(iso)
  const diffMs = Date.now() - dt.getTime()
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec}s atrás`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}min atrás`
  const h = Math.floor(min / 60)
  if (h < 48) return `${h}h atrás`
  const d = Math.floor(h / 24)
  return `${d}d atrás`
}

export function formatRatio(v: number | null): string {
  return v != null && Number.isFinite(v) ? v.toFixed(2) : "—"
}

/** Maior entrada de um mapa de contagens, no formato "chave (n)". */
export function topEntry(counts: Record<string, number>): string {
  const entries = Object.entries(counts)
  if (entries.length === 0) return "—"
  const [key, n] = entries.sort((a, b) => b[1] - a[1])[0]!
  return `${key} (${n})`
}

/** Chave dominante de um mapa de contagens (sem a contagem). */
export function topKey(counts: Record<string, number>): string | null {
  const entries = Object.entries(counts)
  if (entries.length === 0) return null
  return entries.sort((a, b) => b[1] - a[1])[0]![0]
}

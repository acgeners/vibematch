/**
 * Formatadores compartilhados do painel /ai-usage. Centralizados aqui pra não
 * duplicar entre a página (server) e os componentes interativos (client).
 *
 * ⚠️ **Dinheiro NÃO mora aqui** — mora em `lib/format/money.ts`, e o app inteiro
 * (popups de custo, badge dev, toasts, mensagens de servidor) importa de lá. Este
 * arquivo já foi o dono do `formatUsd` e virou origem de três cópias literais.
 * `formatUsdPrecise` deixou de existir junto: a régua de casas decimais que ele
 * resolvia agora é a escala (¢ abaixo de 10¢, $ acima).
 */

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

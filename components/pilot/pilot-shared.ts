import type { TasteCriterion, TasteScoreKey } from "@/server/queries/pilot-taste"

/** Estado editável de UMA obra: as 7 notas de gosto + flag N/A do Final. */
export interface WorkState {
  scores: Record<TasteScoreKey, number | null>
  endingNa: boolean
}

export type SaveState = "idle" | "saving" | "saved"

/** Qual visão do piloto está ativa. Persistida em localStorage. */
export type ViewMode = "work" | "criterion"
export const VIEW_STORAGE_KEY = "pilot_taste_view_v1"
const VIEW_EVENT = "pilot-taste-view-change"

/**
 * Preferência de visão via `useSyncExternalStore` (mesmo padrão do /ranking):
 * snapshot de servidor = "work" (sem mismatch de hidratação), cliente lê do
 * localStorage, e a escrita dispara um evento pros assinantes re-lerem.
 */
export function readViewMode(): ViewMode {
  if (typeof window === "undefined") return "work"
  return window.localStorage.getItem(VIEW_STORAGE_KEY) === "criterion" ? "criterion" : "work"
}
export function subscribeViewMode(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener(VIEW_EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(VIEW_EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}
export function writeViewMode(mode: ViewMode): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(VIEW_STORAGE_KEY, mode)
  window.dispatchEvent(new CustomEvent(VIEW_EVENT))
}

/** Quantas obras por lote na visão "por critério". */
export const CRITERION_BATCH = 12

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
export function fmtLastRead(d: string | null): string {
  if (!d) return "Lida"
  const [y, m] = d.split("-")
  const mi = Number(m) - 1
  return `Lida ${MESES[mi] ?? "?"}/${y}`
}

/**
 * Uma obra "respondeu" o critério quando tem nota; no Final, marcar N/A também
 * conta como respondido. Base pra contadores por critério e filtro "Só faltando".
 */
export function isAnswered(ws: WorkState, crit: TasteCriterion): boolean {
  if (ws.scores[crit.key] != null) return true
  return crit.allowsNa && ws.endingNa
}

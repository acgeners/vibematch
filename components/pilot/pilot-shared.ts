import { PERSONAL_STATUSES_BY_ID } from "@/lib/constants/criteria"
import type { PilotWork, TasteCriterion, TasteScoreKey } from "@/server/queries/pilot-taste"

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
 * Uma obra "respondeu" o critério quando tem nota. O eixo "Final" (allowsNa) só se
 * aplica a obra terminada: numa obra não terminada ele está travado — logo, não há o
 * que responder e conta como respondido. Base pra contadores e filtro "Só faltando".
 */
export function isAnswered(ws: WorkState, crit: TasteCriterion, isFullyRead = true): boolean {
  if (ws.scores[crit.key] != null) return true
  return crit.allowsNa && !isFullyRead
}

/** Valor do filtro por status de leitura: um id, "todos", ou "sem status". */
export type StatusFilter = number | "all" | "none"

/** Uma opção do filtro de status, já com contagem de obras. */
export interface StatusFacet {
  /** id do personal_status ou "none" para obras sem status. */
  key: number | "none"
  label: string
  symbol: string
  /** hex do DB; null para "sem status" (usa tom neutro). */
  color: string | null
  count: number
}

/**
 * Agrupa as obras do piloto por status de leitura, na ordem canônica de
 * `PERSONAL_STATUSES_BY_ID` (ciclo de leitura), mantendo só os status presentes.
 * Obras sem status viram uma faceta "Sem status" no fim.
 */
export function buildStatusFacets(works: PilotWork[]): StatusFacet[] {
  const counts = new Map<number | "none", number>()
  for (const w of works) {
    const k: number | "none" = w.personalStatusId ?? "none"
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  const facets: StatusFacet[] = []
  for (const info of Object.values(PERSONAL_STATUSES_BY_ID)) {
    const c = counts.get(info.id)
    if (c) facets.push({ key: info.id, label: info.status, symbol: info.symbol, color: info.color, count: c })
  }
  const none = counts.get("none")
  if (none) facets.push({ key: "none", label: "Sem status", symbol: "•", color: null, count: none })
  return facets
}

/** Uma obra passa no filtro de status ativo? */
export function matchesStatus(work: PilotWork, filter: StatusFilter): boolean {
  if (filter === "all") return true
  if (filter === "none") return work.personalStatusId == null
  return work.personalStatusId === filter
}

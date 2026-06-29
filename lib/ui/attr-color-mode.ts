import type { AttrColorMode } from "@/components/ui/score-badge"

/**
 * Preferência GLOBAL (client-only) de como colorir as notas de atributo:
 * - "catalog": percentil no catálogo (default histórico).
 * - "range": distância à faixa ideal do perfil do usuário.
 *
 * Persistida em localStorage e propagada via CustomEvent + `storage`, no mesmo
 * padrão do view-mode da tabela. Lida por `useSyncExternalStore` em cada
 * superfície colorida (heatmap, lista) — assim o toggle vale pro app inteiro.
 */
const STORAGE_KEY = "attr_color_mode_v1"
const EVENT = "attr-color-mode-change"

export function readAttrColorMode(): AttrColorMode {
  if (typeof window === "undefined") return "catalog"
  return window.localStorage.getItem(STORAGE_KEY) === "range" ? "range" : "catalog"
}

export function subscribeAttrColorMode(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener(EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

export function writeAttrColorMode(mode: AttrColorMode): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(STORAGE_KEY, mode)
  window.dispatchEvent(new CustomEvent(EVENT))
}

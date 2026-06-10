/**
 * Evento global que pede à sidebar pra re-buscar os badges de pendência
 * (Avaliação IA / Configurações).
 *
 * O `useEffect([pathname])` da sidebar só re-busca os contadores quando a rota
 * muda. Fluxos que esvaziam uma fila SEM trocar de página (ex.: avaliar/pular
 * obras, re-rankear, prever sinopse dentro de /ai-evaluation) deixam o badge
 * defasado. Esses fluxos chamam `refreshSidebarBadges()` junto do `router.refresh()`
 * pra forçar a sidebar a recontar.
 */
export const SIDEBAR_BADGES_REFRESH_EVENT = "sidebar-badges:refresh"

/** Dispara o re-fetch dos badges da sidebar. No-op fora do browser. */
export function refreshSidebarBadges() {
  if (typeof window === "undefined") return
  window.dispatchEvent(new Event(SIDEBAR_BADGES_REFRESH_EVENT))
}

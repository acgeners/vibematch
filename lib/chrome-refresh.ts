/**
 * Barramento global de "refresh do chrome": pede aos elementos persistentes do
 * layout (badges da sidebar, saldo Anthropic, chip de conta) que re-busquem seus
 * dados sem reload da página.
 *
 * Esses chips são client components que buscam os próprios dados num `useEffect`
 * keyado em `pathname`. `router.refresh()` (chamado pelas mutações) e
 * `revalidatePath()` (nos server actions) só re-renderizam os Server Components
 * da rota atual — NÃO re-rodam esses fetches client. Então o chrome congela no
 * que carregou na última navegação até você navegar de novo ou recarregar.
 *
 * Solução: toda mutação que chama `router.refresh()` dispara também este evento
 * (via `useRefresh()` em `@/lib/use-refresh`), e os três chips o escutam.
 */
export const CHROME_REFRESH_EVENT = "app:chrome-refresh"

// Janela de debounce do dispatch: colapsa rajadas (cliques rápidos, loops que
// chamam refresh() N vezes num tick) num único evento, em vez de fazer cada chip
// disparar um fetch por chamada. 100ms é imperceptível depois de uma mutação.
const REFRESH_DEBOUNCE_MS = 100
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Dispara o re-fetch do chrome (badges + saldo + conta), com debounce de borda
 * de saída. No-op fora do browser.
 */
export function refreshChrome() {
  if (typeof window === "undefined") return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    window.dispatchEvent(new Event(CHROME_REFRESH_EVENT))
  }, REFRESH_DEBOUNCE_MS)
}

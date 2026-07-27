/**
 * Ponte de refresh ENTRE ABAS (mesma origem). Todo o refresh do app hoje é
 * por-aba: `router.refresh()` só re-renderiza os Server Components da aba atual
 * e `refreshChrome()` (chrome-refresh.ts) usa `window.dispatchEvent`, que NÃO
 * cruza janelas. Então uma mutação numa aba nunca chega às outras abas abertas.
 *
 * Aqui a `BroadcastChannel` fecha esse buraco: a aba que agiu chama
 * `broadcastRefresh()`; as DEMAIS abas recebem e re-buscam a verdade do servidor
 * (via o ouvinte em `useCrossTabRefreshListener` em `@/lib/use-refresh`).
 *
 * Duas propriedades importantes:
 *   - **Sem eco na própria aba.** Usamos UM único objeto de canal (singleton):
 *     a `BroadcastChannel` não entrega a mensagem ao MESMO objeto que a postou,
 *     então quem transmite não se ouve. Sem isso (dois objetos na mesma aba) o
 *     transmissor receberia o próprio post e entraria em loop.
 *   - **Só o sinal, nunca o `ChromePatch`.** Deltas otimistas (saldo/badge) valem
 *     pra dar snap na aba que agiu; a outra aba pode estar em rota diferente e
 *     aplicar um delta ali arriscaria dupla-contagem. A ponte manda apenas
 *     "algo mudou" e o receptor re-busca — mais simples e correto.
 */
export const CROSS_TAB_REFRESH_CHANNEL = "app:cross-tab-refresh"

// Payload é irrelevante — a mensagem é um ping "re-busque". Constante só pra
// evitar alocar a cada post.
const REFRESH_PING = 1

// Debounce de borda de saída: colapsa rajadas (loops que chamam refresh() N
// vezes num tick) num único post cross-tab, senão cada aba receptora dispararia
// N re-fetches. Espelha a janela do chrome-refresh (100ms, imperceptível).
const BROADCAST_DEBOUNCE_MS = 100
let debounceTimer: ReturnType<typeof setTimeout> | null = null

let channel: BroadcastChannel | null = null

/** Canal singleton. `null` no servidor ou onde `BroadcastChannel` não existe. */
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null
  if (!channel) channel = new BroadcastChannel(CROSS_TAB_REFRESH_CHANNEL)
  return channel
}

/**
 * Avisa as OUTRAS abas que houve uma mutação e elas devem re-buscar. No-op fora
 * do browser ou sem suporte a `BroadcastChannel`. Chamado por `useRefresh()`
 * junto do refresh local; NÃO deve ser chamado pelo receptor (senão vira loop).
 */
export function broadcastRefresh(): void {
  const ch = getChannel()
  if (!ch) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    ch.postMessage(REFRESH_PING)
  }, BROADCAST_DEBOUNCE_MS)
}

/**
 * Inscreve `handler` pra rodar quando OUTRA aba transmitir um refresh. Retorna a
 * função de cancelamento. No-op (retorna cleanup vazio) sem suporte ao canal.
 */
export function subscribeCrossTabRefresh(handler: () => void): () => void {
  const ch = getChannel()
  if (!ch) return () => {}
  const listener = () => handler()
  ch.addEventListener("message", listener)
  return () => ch.removeEventListener("message", listener)
}

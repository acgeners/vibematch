// Indicador client-side de "tem uma conversa de chat em andamento", lido por
// qualquer página pra mostrar o FAB de retomar (canto inferior direito). Mesmo
// padrão de sync do view-mode em ranked-works-view (evento custom + storage),
// mas com cache do snapshot pra ser seguro com useSyncExternalStore (que exige
// referência estável enquanto o valor não muda).

export interface ActiveChatInfo {
  slug: string
  updatedAt: string
  /** Título curto pra preview no FAB (derivado da 1ª mensagem do usuário). */
  title?: string
}

const KEY = "vibematch_active_chat_v1"
const EVENT = "vibematch-active-chat-change"

let cachedRaw: string | null = null
let cachedValue: ActiveChatInfo | null = null

export function readActiveChat(): ActiveChatInfo | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(KEY)
  if (raw === cachedRaw) return cachedValue
  cachedRaw = raw
  try {
    const parsed = raw ? (JSON.parse(raw) as ActiveChatInfo) : null
    cachedValue = parsed?.slug ? parsed : null
  } catch {
    cachedValue = null
  }
  return cachedValue
}

export function setActiveChat(info: ActiveChatInfo) {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KEY, JSON.stringify(info))
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function clearActiveChat() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(KEY)
  window.dispatchEvent(new CustomEvent(EVENT))
}

export function subscribeActiveChat(onChange: () => void) {
  if (typeof window === "undefined") return () => {}
  window.addEventListener(EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

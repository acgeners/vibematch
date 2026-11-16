"use client"

import { useCallback, useMemo, useSyncExternalStore } from "react"

/**
 * Quando um teste de conexão (Comix, fontes atrás do Cloudflare) rodou pela última vez, e com que
 * resultado — guardado no NAVEGADOR (pedido de 16/11/2026). Os testes só rodam no Mac (sem o
 * contorno do Cloudflare ficam desabilitados), então "o último teste neste navegador" é o último
 * teste. Conveniência por pessoa: sem `localStorage` (aba anônima, dado limpo) o painel funciona
 * igual, só sem a data.
 *
 * `useSyncExternalStore` com instantâneo de servidor `null`: o SSR não vê `localStorage`, e ler no
 * primeiro render quebraria a hidratação (ver "Preferência de UI que o servidor renderiza" no CLAUDE.md).
 */
const EVENT = "satoria:last-test"

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(EVENT, onChange)
  }
}

export interface LastTest {
  checkedAt: string
  ok: boolean
}

export function useLastTest(storageKey: string) {
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return window.localStorage.getItem(storageKey)
      } catch {
        return null
      }
    },
    () => null,
  )
  const last = useMemo<LastTest | null>(() => {
    if (!raw) return null
    try {
      const p = JSON.parse(raw) as Partial<LastTest>
      return typeof p.checkedAt === "string" ? { checkedAt: p.checkedAt, ok: p.ok === true } : null
    } catch {
      return null
    }
  }, [raw])
  const remember = useCallback(
    (checkedAt: string, ok: boolean) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ checkedAt, ok }))
        window.dispatchEvent(new Event(EVENT))
      } catch {
        // Sem armazenamento, sem a data — o teste em si já rodou.
      }
    },
    [storageKey],
  )
  return { last, remember }
}

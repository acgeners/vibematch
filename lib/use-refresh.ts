"use client"

import { useCallback, useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import { CHROME_REFRESH_EVENT, refreshChrome } from "@/lib/chrome-refresh"

/**
 * `router.refresh()` + refresh do chrome (saldo/badges/conta) num só lugar.
 *
 * Use no lugar de `router.refresh()` após qualquer mutação. `router.refresh()`
 * re-renderiza os Server Components da rota, mas NÃO re-roda os fetches client
 * dos chips persistentes do layout — `refreshChrome()` cuida desses. Centralizar
 * aqui garante que toda mutação mantenha o chrome em dia sem fiação caso-a-caso.
 */
export function useRefresh(): () => void {
  const router = useRouter()
  return useCallback(() => {
    router.refresh()
    refreshChrome()
  }, [router])
}

/**
 * Inscreve um callback no evento de refresh do chrome. Passe um callback estável
 * (useCallback) pra não re-inscrever a cada render. Primitivo de baixo nível —
 * prefira `useChromeData` quando o que você quer é buscar dados do chrome.
 */
export function useChromeRefresh(onRefresh: () => void): void {
  useEffect(() => {
    window.addEventListener(CHROME_REFRESH_EVENT, onRefresh)
    return () => window.removeEventListener(CHROME_REFRESH_EVENT, onRefresh)
  }, [onRefresh])
}

/**
 * Busca dados de "chrome" e os mantém vivos sem reload: re-busca a cada navegação
 * e quando uma mutação dispara o refresh do chrome.
 *
 * - Coalesce fetches concorrentes (um único em voo por vez).
 * - Se um refresh for pedido DURANTE um fetch em voo, re-roda uma vez ao terminar
 *   — senão a atualização que chegou tarde demais pro guard de in-flight seria
 *   perdida (o fetch em voo pode ter snapshotado o estado pré-mutação).
 *
 * @param fetcher  busca os dados (pode ser inline; é "refado" a cada render).
 * @param onData   recebe o resultado, ex.: setState (pode ser inline).
 * @param ttlMs    janela mínima entre re-fetches por NAVEGAÇÃO; o evento de chrome
 *                 sempre força (ignora o TTL). Default 0 = sem TTL.
 */
export function useChromeData<T>(
  fetcher: () => Promise<T>,
  onData: (data: T) => void,
  ttlMs = 0,
): void {
  const pathname = usePathname()
  // "Refamos" fetcher/onData/run pra que callbacks inline não re-rodem os effects
  // e pra re-rodar dentro do próprio .finally() sem auto-referência lexical. Os
  // refs são sincronizados num effect (a regra react-hooks/refs proíbe mexer em
  // .current durante o render).
  const fetcherRef = useRef(fetcher)
  const onDataRef = useRef(onData)
  const runRef = useRef<(force: boolean) => void>(() => {})
  const inFlight = useRef(false)
  const pendingForce = useRef(false)
  const lastFetch = useRef(0)

  const run = useCallback(
    (force: boolean) => {
      if (!force && ttlMs > 0 && Date.now() - lastFetch.current < ttlMs) return
      if (inFlight.current) {
        // Re-roda (forçado) ao terminar pra não perder uma atualização pós-mutação.
        pendingForce.current = true
        return
      }
      inFlight.current = true
      lastFetch.current = Date.now()
      Promise.resolve(fetcherRef.current())
        .then((data) => onDataRef.current(data))
        .catch(() => {
          // Libera o TTL pra permitir retry antes da janela em caso de falha.
          lastFetch.current = 0
        })
        .finally(() => {
          inFlight.current = false
          if (pendingForce.current) {
            pendingForce.current = false
            runRef.current(true)
          }
        })
    },
    [ttlMs],
  )

  useEffect(() => {
    fetcherRef.current = fetcher
    onDataRef.current = onData
    runRef.current = run
  })

  // Re-busca a cada navegação (respeitando o TTL).
  useEffect(() => {
    run(false)
  }, [pathname, run])

  // Re-busca (forçado) quando uma mutação dispara o refresh do chrome.
  useChromeRefresh(useCallback(() => run(true), [run]))
}

"use client"

import { useCallback, useEffect, useRef } from "react"
import { usePathname, useRouter } from "next/navigation"
import { CHROME_REFRESH_EVENT, refreshChrome } from "@/lib/chrome-refresh"
import type { ChromePatch } from "@/lib/chrome-refresh"
import { broadcastRefresh, subscribeCrossTabRefresh } from "@/lib/cross-tab-refresh"

/**
 * `router.refresh()` + refresh do chrome (saldo/badges/conta) num só lugar.
 *
 * Use no lugar de `router.refresh()` após qualquer mutação. `router.refresh()`
 * re-renderiza os Server Components da rota, mas NÃO re-roda os fetches client
 * dos chips persistentes do layout — `refreshChrome()` cuida desses. Centralizar
 * aqui garante que toda mutação mantenha o chrome em dia sem fiação caso-a-caso.
 *
 * Passe um `patch` quando souber o que mudou (ex.: avaliação IA gastou tokens e
 * tirou 1 da fila) pra atualizar o chrome otimisticamente, sem re-buscar do DB.
 * Sem patch = re-busca tudo (comportamento original).
 *
 * Além do refresh local, avisa as OUTRAS abas abertas (`broadcastRefresh`) pra
 * elas re-buscarem — quem escuta é `useCrossTabRefreshListener` no shell. O
 * `patch` é local só: a ponte cross-tab manda apenas o sinal (ver
 * `lib/cross-tab-refresh.ts`).
 */
export function useRefresh(): (patch?: ChromePatch) => void {
  const router = useRouter()
  return useCallback(
    (patch?: ChromePatch) => {
      router.refresh()
      refreshChrome(patch)
      broadcastRefresh()
    },
    [router],
  )
}

/**
 * Ouvinte cross-tab: quando OUTRA aba faz uma mutação, re-busca a verdade do
 * servidor nesta aba (`router.refresh()` + `refreshChrome()` sem patch). Monte
 * UMA vez no shell do app.
 *
 * Não re-transmite (só `useRefresh` transmite; `refreshChrome` sem patch dispara
 * evento LOCAL) → sem loop A→B→A.
 *
 * Gating por visibilidade: aba escondida não re-busca na hora (evita N abas de
 * fundo batendo no DB a cada mutação); marca "sujo" e re-busca ao voltar a ficar
 * visível.
 */
export function useCrossTabRefreshListener(): void {
  const router = useRouter()
  const dirty = useRef(false)

  useEffect(() => {
    const refreshNow = () => {
      dirty.current = false
      router.refresh()
      refreshChrome()
    }
    const onMessage = () => {
      if (document.visibilityState === "visible") refreshNow()
      else dirty.current = true
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && dirty.current) refreshNow()
    }
    const unsubscribe = subscribeCrossTabRefresh(onMessage)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      unsubscribe()
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [router])
}

/**
 * Inscreve um callback no evento de refresh do chrome. Recebe o `ChromePatch`
 * (delta otimista) ou `null` (re-fetch). Passe um callback estável (useCallback)
 * pra não re-inscrever a cada render. Primitivo de baixo nível — prefira
 * `useChromeData` quando o que você quer é buscar/atualizar dados do chrome.
 */
export function useChromeRefresh(onRefresh: (patch: ChromePatch | null) => void): void {
  useEffect(() => {
    const handler = (e: Event) => onRefresh((e as CustomEvent<ChromePatch | null>).detail)
    window.addEventListener(CHROME_REFRESH_EVENT, handler)
    return () => window.removeEventListener(CHROME_REFRESH_EVENT, handler)
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
 * @param ttlMs    janela mínima entre re-fetches por NAVEGAÇÃO; um evento de
 *                 RE-FETCH sempre força (ignora o TTL). Default 0 = sem TTL.
 * @param onPatch  aplica um delta otimista LOCALMENTE (sem fetch) quando o evento
 *                 traz um `ChromePatch`. Se omitido, patches direcionados são
 *                 ignorados (o chip não re-busca por algo que não lhe diz respeito).
 */
export function useChromeData<T>(
  fetcher: () => Promise<T>,
  onData: (data: T) => void,
  ttlMs = 0,
  onPatch?: (patch: ChromePatch) => void,
): void {
  const pathname = usePathname()
  // "Refamos" fetcher/onData/run pra que callbacks inline não re-rodem os effects
  // e pra re-rodar dentro do próprio .finally() sem auto-referência lexical. Os
  // refs são sincronizados num effect (a regra react-hooks/refs proíbe mexer em
  // .current durante o render).
  const fetcherRef = useRef(fetcher)
  const onDataRef = useRef(onData)
  const onPatchRef = useRef(onPatch)
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
    onPatchRef.current = onPatch
    runRef.current = run
  })

  // Re-busca a cada navegação (respeitando o TTL).
  useEffect(() => {
    run(false)
  }, [pathname, run])

  // Reage a uma mutação: patch direcionado → aplica delta local (sem fetch);
  // re-fetch (detail null) → re-busca forçado. Patch sem handler → ignora.
  useChromeRefresh(
    useCallback(
      (patch) => {
        if (patch) {
          onPatchRef.current?.(patch)
        } else {
          run(true)
        }
      },
      [run],
    ),
  )
}

"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { getSidebarBadgeCounts } from "@/server/actions/badges"
import type { SidebarBadgeCounts } from "@/server/actions/badges"
import { useChromeData } from "@/lib/use-refresh"
import type { ChromePatch } from "@/lib/chrome-refresh"

/**
 * Os contadores do chrome, buscados UMA VEZ e compartilhados.
 *
 * Nasceu da console `/curadoria`: a barra superior e a sidebar da console mostram
 * os mesmos números, e cada uma com o seu `useChromeData` faria DUAS chamadas por
 * navegação — o coalescing do hook é por instância, não global. Não seria só
 * desperdício: `getSidebarBadgeCounts` lê `getSettingsItemPending`, que puxa linhas
 * (não `count: exact`), e ainda dispara `maybeTriggerStaleRecalc()`. Duplicar a
 * chamada duplicaria a leitura mais cara do chrome e o gatilho do auto-recalc.
 *
 * Fica ACIMA de ambas (no layout raiz) para que sidebar e barra nunca discordem
 * sobre o mesmo número, que é o que aconteceria com dois fetches em janelas
 * diferentes de TTL.
 */

const TTL_MS = 30_000

const ZERO: SidebarBadgeCounts = {
  curadoria: 0,
  recQueue: 0,
  settings: 0,
  settingsByGroup: {},
  recalcPending: false,
  comixHealth: "unknown",
}

interface BadgesContextValue extends SidebarBadgeCounts {
  /** Some com o controle de recálculo assim que a rodada termina, sem esperar o TTL. */
  clearRecalcPending: () => void
}

const BadgesContext = createContext<BadgesContextValue>({
  ...ZERO,
  clearRecalcPending: () => {},
})

/** Contadores do chrome. Zerados até a primeira resposta — badge some no 0. */
export function useChromeBadges(): BadgesContextValue {
  return useContext(BadgesContext)
}

export function ChromeBadgesProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<SidebarBadgeCounts>(ZERO)

  const clearRecalcPending = useCallback(
    () => setCounts((prev) => ({ ...prev, recalcPending: false })),
    [],
  )

  // Delta otimista de uma mutação (ex.: "marcar como lido") — aplica local, sem
  // refetch. `settingsByGroup` não recebe delta: nenhuma mutação hoje sabe de que
  // tópico é a pendência que resolveu, e chutar deixaria pai e filho discordando.
  const onPatch = useCallback((patch: ChromePatch) => {
    setCounts((prev) => {
      let next = prev
      if (patch.badgeDelta) {
        const { curadoria = 0, recQueue = 0 } = patch.badgeDelta
        next = {
          ...next,
          curadoria: Math.max(0, next.curadoria + curadoria),
          recQueue: Math.max(0, next.recQueue + recQueue),
        }
      }
      if (patch.recalcPending != null) next = { ...next, recalcPending: patch.recalcPending }
      return next
    })
  }, [])

  useChromeData(getSidebarBadgeCounts, setCounts, TTL_MS, onPatch)

  const value = useMemo(() => ({ ...counts, clearRecalcPending }), [counts, clearRecalcPending])
  return <BadgesContext.Provider value={value}>{children}</BadgesContext.Provider>
}

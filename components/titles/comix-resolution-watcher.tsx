"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { getComixResolutionStatus } from "@/server/actions/comix-resolver"
import { useRefresh } from "@/lib/use-refresh"

// Só observa obras recém-criadas (a resolução do Comix roda em background ~60s na
// criação). Fora dessa janela, não há o que esperar — não faz polling.
const RECENT_MS = 3 * 60_000
const POLL_MS = 5_000
const MAX_POLLS = 12 // ~60s de espera

/**
 * Observa a resolução de background do hid do Comix e atualiza a página sozinha
 * quando ela termina (sem reload manual). Mostra um aviso discreto enquanto
 * espera; some quando resolve ou quando a janela esgota.
 */
export function ComixResolutionWatcher({ workId, createdAt }: { workId: string; createdAt: string }) {
  const refresh = useRefresh()
  const [done, setDone] = useState(false)
  // Lazy init lê o relógio uma vez no mount (impureza permitida em initializer).
  const [isRecent] = useState(() => {
    const age = Date.now() - new Date(createdAt).getTime()
    return age >= 0 && age < RECENT_MS
  })

  useEffect(() => {
    if (!isRecent) return
    let cancelled = false
    let polls = 0
    let baseline: boolean | null = null
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (cancelled) return
      polls += 1
      try {
        const { resolved } = await getComixResolutionStatus(workId)
        if (cancelled) return
        if (baseline === null) baseline = resolved
        if (resolved) {
          setDone(true)
          // Só atualiza se virou resolvido DEPOIS do render (baseline false) — aí a
          // página está desatualizada e vale o router.refresh + refreshChrome.
          if (baseline === false) refresh()
          return
        }
      } catch {
        /* transitório — tenta de novo no próximo tick */
      }
      if (polls >= MAX_POLLS) {
        setDone(true)
        return
      }
      timer = setTimeout(tick, POLL_MS)
    }

    timer = setTimeout(tick, POLL_MS)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [workId, isRecent, refresh])

  if (!isRecent || done) return null
  return (
    <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      Resolvendo dados do Comix… a página atualiza sozinha quando terminar.
    </div>
  )
}

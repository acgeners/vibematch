"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Loader2 } from "lucide-react"
import { getWorkUpdateStatus } from "@/server/actions/update-status"
import { useRefresh } from "@/lib/use-refresh"

const POLL_MS = 5_000
const MAX_POLLS = 24 // ~120s — cobre o Mangago (timeout de reviews 60s) com folga
const DONE_VISIBLE_MS = 6_000
const FLAG_FRESH_MS = 3 * 60_000 // ignora flag "updating" velha (ex.: aba reaberta)
const DONE_FRESH_MS = 15_000 // janela do flag "done" pra sobreviver ao refresh

// Evento que o diálogo "Atualizar dados" dispara no save — acorda o watcher na
// MESMA página (o refresh() de lá é router.refresh, que não re-monta este client
// component, então o useEffect não re-rodaria sozinho).
export const WORK_UPDATED_EVENT = "vibematch:work-updated"

// Flags de sessão. `updating` escopa o watcher a um update REAL (sem ele, pollaria em
// toda visita). `done` é setado pelo watcher ao concluir, ANTES do refresh(), pra o
// banner de "terminou" sobreviver a um eventual re-mount (ex.: navegação pro slug novo).
const updatingKey = (id: string) => `vibematch:updating:${id}`
const doneKey = (id: string) => `vibematch:update-done:${id}`

/**
 * Observa a aquisição de reviews (+ enrich do Comix) que roda em background após
 * "Atualizar dados" e avisa quando terminou — a página se atualiza sozinha. Só faz
 * polling quando há um update recente (flag + evento do diálogo); fora disso, nada.
 */
export function UpdateProgressWatcher({ workId }: { workId: string }) {
  const refresh = useRefresh()
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle")
  const [reviewsAdded, setReviewsAdded] = useState<number | undefined>(undefined)

  useEffect(() => {
    if (typeof window === "undefined") return
    const ss = window.sessionStorage
    let cancelled = false
    let watching = false
    let polls = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      if (cancelled) return
      polls += 1
      try {
        const { state, reviewsAdded: added } = await getWorkUpdateStatus(workId)
        if (cancelled) return
        if (state === "done") {
          ss.removeItem(updatingKey(workId))
          ss.setItem(doneKey(workId), JSON.stringify({ reviewsAdded: added, ts: Date.now() }))
          setReviewsAdded(added)
          setPhase("done")
          refresh() // traz as reviews novas; o flag "done" cobre um eventual re-mount
          timer = setTimeout(() => {
            if (cancelled) return
            setPhase("idle")
            ss.removeItem(doneKey(workId))
          }, DONE_VISIBLE_MS)
          return
        }
        if (state === "running") setPhase("running")
        // "idle": o after() pode ainda não ter marcado o job — segue tentando.
      } catch {
        /* transitório — tenta no próximo tick */
      }
      if (polls >= MAX_POLLS) {
        ss.removeItem(updatingKey(workId))
        setPhase("idle")
        return
      }
      timer = setTimeout(tick, POLL_MS)
    }

    const begin = () => {
      if (cancelled || watching) return
      const raw = ss.getItem(updatingKey(workId))
      if (!raw) return
      const startedTs = Number(raw)
      if (!Number.isFinite(startedTs) || Date.now() - startedTs > FLAG_FRESH_MS) {
        ss.removeItem(updatingKey(workId))
        return
      }
      watching = true
      polls = 0
      setPhase("running")
      void tick()
    }

    // 1) Acabou de terminar num instante anterior (flag setado antes do refresh que
    // pode ter re-montado este componente) → mostra "terminou" e para.
    const doneRaw = ss.getItem(doneKey(workId))
    if (doneRaw) {
      ss.removeItem(doneKey(workId))
      let parsed: { reviewsAdded?: number; ts?: number } = {}
      try {
        parsed = JSON.parse(doneRaw)
      } catch {
        /* corrompido — ignora */
      }
      if (parsed.ts && Date.now() - parsed.ts < DONE_FRESH_MS) {
        setReviewsAdded(parsed.reviewsAdded)
        setPhase("done")
        timer = setTimeout(() => setPhase("idle"), DONE_VISIBLE_MS)
        return () => {
          cancelled = true
          if (timer) clearTimeout(timer)
        }
      }
    }

    // 2) Update já em andamento no mount (ex.: navegou pro slug novo → re-mount).
    begin()

    // 3) Update disparado AGORA na mesma página (refresh() não re-monta) → evento.
    const onUpdated = (e: Event) => {
      if ((e as CustomEvent).detail?.workId === workId) begin()
    }
    window.addEventListener(WORK_UPDATED_EVENT, onUpdated)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      window.removeEventListener(WORK_UPDATED_EVENT, onUpdated)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workId])

  if (phase === "idle") return null
  if (phase === "running") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Buscando reviews e dados em segundo plano… a página atualiza sozinha quando terminar.
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
      <CheckCircle2 className="h-3.5 w-3.5" />
      {reviewsAdded && reviewsAdded > 0
        ? `Dados atualizados — ${reviewsAdded} nova${reviewsAdded > 1 ? "s" : ""} review${reviewsAdded > 1 ? "s" : ""}.`
        : "Dados atualizados."}
    </div>
  )
}

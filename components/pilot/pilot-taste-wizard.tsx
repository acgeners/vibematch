"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"
import { savePilotTaste } from "@/server/actions/pilot-taste"
import { starsToPostReadingScore } from "@/lib/constants/post-reading-criteria"
import { ByWorkView } from "@/components/pilot/by-work-view"
import { ByCriterionView } from "@/components/pilot/by-criterion-view"
import { readViewMode, subscribeViewMode, writeViewMode } from "@/components/pilot/pilot-shared"
import type { SaveState, ViewMode, WorkState } from "@/components/pilot/pilot-shared"
import type { PilotWork, TasteCriterion } from "@/server/queries/pilot-taste"

interface Props {
  criteria: TasteCriterion[]
  works: PilotWork[]
}

/**
 * Casca do piloto de notas de gosto: segura o estado das notas + o autosave e
 * alterna entre duas lentes sobre o mesmo dado — "por obra" (uma obra, 7 notas) e
 * "por critério" (um eixo, várias obras). Toda a edição flui pelos callbacks
 * `rate`/`markNa`, e o autosave é debounced POR OBRA (chave = índice) pra não
 * perder nota ao pontuar obras diferentes em sequência.
 */
export function PilotTasteWizard({ criteria, works }: Props) {
  const [state, setState] = useState<WorkState[]>(() =>
    works.map((w) => ({ scores: { ...w.scores }, endingNa: w.endingNa })),
  )
  const [save, setSave] = useState<SaveState>("idle")
  const view = useSyncExternalStore(subscribeViewMode, readViewMode, () => "work" as const)

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // um timer por obra (índice) — saves de obras distintas não se cancelam
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const doSave = (i: number) => {
    const w = works[i]
    const s = stateRef.current[i]
    setSave("saving")
    savePilotTaste(w.id, s.scores, s.endingNa)
      .then((r) => setSave(r.ok ? "saved" : "idle"))
      .catch(() => setSave("idle"))
  }
  const scheduleSave = (i: number) => {
    setSave("saving")
    const prev = timers.current.get(i)
    if (prev) clearTimeout(prev)
    timers.current.set(
      i,
      setTimeout(() => {
        timers.current.delete(i)
        doSave(i)
      }, 550),
    )
  }
  const flushAll = () => {
    const pending = [...timers.current.keys()]
    timers.current.forEach((t) => clearTimeout(t))
    timers.current.clear()
    pending.forEach((i) => doSave(i))
  }
  // salva pendências ao desmontar (flushAll usa só refs — a captura de mount basta)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flushAll(), [])

  const patch = (i: number, mut: (ws: WorkState) => WorkState) =>
    setState((prev) => prev.map((ws, j) => (j === i ? mut(ws) : ws)))

  const rate = (i: number, crit: TasteCriterion, stars: number) => {
    const value = starsToPostReadingScore(stars)
    patch(i, (ws) => ({
      scores: { ...ws.scores, [crit.key]: value },
      endingNa: crit.allowsNa ? false : ws.endingNa,
    }))
    scheduleSave(i)
  }
  const markNa = (i: number, crit: TasteCriterion) => {
    patch(i, (ws) => ({ scores: { ...ws.scores, [crit.key]: null }, endingNa: true }))
    scheduleSave(i)
  }

  const changeView = (v: ViewMode) => {
    if (v === view) return
    flushAll()
    writeViewMode(v)
  }

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24">
      {/* topbar: título · alternância de visão · status de save */}
      <div className="sticky top-0 z-20 -mx-5 mb-6 flex items-center gap-4 border-b border-border bg-background/85 px-5 py-3 backdrop-blur">
        <div className="flex min-w-0 flex-col">
          <b className="text-[15px] font-bold tracking-tight">Notas de gosto</b>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Piloto · calibra o modelo
          </span>
        </div>

        <div className="ml-auto inline-flex rounded-xl border border-border bg-card p-0.5">
          {(
            [
              { v: "work", label: "Por obra" },
              { v: "criterion", label: "Por critério" },
            ] as const
          ).map(({ v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => changeView(v)}
              className={cn(
                "rounded-[9px] px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                view === v
                  ? "bg-gradient-to-r from-violet-500 to-rose-500 text-white"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <span className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              save === "saving" ? "bg-muted-foreground" : "bg-emerald-500",
            )}
          />
          {save === "saving" ? "Salvando…" : "Salvo"}
        </span>
      </div>

      {view === "work" ? (
        <ByWorkView
          works={works}
          criteria={criteria}
          state={state}
          onRate={rate}
          onNa={markNa}
          onFlush={flushAll}
        />
      ) : (
        <ByCriterionView
          works={works}
          criteria={criteria}
          state={state}
          onRate={rate}
          onNa={markNa}
        />
      )}
    </div>
  )
}

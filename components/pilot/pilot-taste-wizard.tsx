"use client"

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"
import { savePilotTaste } from "@/server/actions/pilot-taste"
import { starsToPostReadingScore } from "@/lib/constants/post-reading-criteria"
import { ByWorkView } from "@/components/pilot/by-work-view"
import { ByCriterionView } from "@/components/pilot/by-criterion-view"
import { isFullyReadPersonalStatus } from "@/lib/constants/status-lookups"
import {
  buildStatusFacets,
  matchesStatus,
  readViewMode,
  subscribeViewMode,
  writeViewMode,
} from "@/components/pilot/pilot-shared"
import type { SaveState, StatusFilter, ViewMode, WorkState } from "@/components/pilot/pilot-shared"
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
  // Chave do eixo "Final" (o único com allowsNa). Sua aplicabilidade deriva do status
  // da obra: só obras terminadas (isFullyRead) recebem nota; nas demais é gravado vazio.
  const endingKey = useMemo(() => criteria.find((c) => c.allowsNa)?.key, [criteria])
  const [save, setSave] = useState<SaveState>("idle")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const view = useSyncExternalStore(subscribeViewMode, readViewMode, () => "work" as const)

  // Facetas de status (só as presentes) e os índices visíveis sob o filtro ativo.
  // Índice = posição original em `works`/`state`, pra manter o autosave por-obra.
  const statusFacets = useMemo(() => buildStatusFacets(works), [works])
  const visibleIndices = useMemo(
    () => works.map((_, i) => i).filter((i) => matchesStatus(works[i], statusFilter)),
    [works, statusFilter],
  )

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // um timer por obra (índice) — saves de obras distintas não se cancelam
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const doSave = (i: number) => {
    const w = works[i]
    const s = stateRef.current[i]
    // O "Final" só se aplica a obra terminada. Fora disso: grava vazio + ending_na,
    // independente do que estiver no estado (a regra é autoritativa no save).
    const endingApplicable = isFullyReadPersonalStatus(w.personalStatusId)
    const scores = endingApplicable || !endingKey ? s.scores : { ...s.scores, [endingKey]: null }
    setSave("saving")
    savePilotTaste(w.id, scores, !endingApplicable)
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
    patch(i, (ws) => ({ ...ws, scores: { ...ws.scores, [crit.key]: value } }))
    scheduleSave(i)
  }

  const changeView = (v: ViewMode) => {
    if (v === view) return
    flushAll()
    writeViewMode(v)
  }

  return (
    <div className="mx-auto max-w-[1120px] px-5 pb-24">
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

      {/* filtro por status de leitura (só aparece quando há mais de um status) */}
      {statusFacets.length > 1 && (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Status
          </span>
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-colors",
              statusFilter === "all"
                ? "border-violet-500/55 bg-violet-500/12 text-foreground"
                : "border-border text-muted-foreground hover:border-muted-foreground",
            )}
          >
            Todos
            <span className="tabular-nums opacity-70">{works.length}</span>
          </button>
          {statusFacets.map((f) => {
            const on = statusFilter === f.key
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold transition-colors",
                  on
                    ? "border-current"
                    : "border-border text-muted-foreground hover:border-muted-foreground",
                )}
                style={
                  f.color
                    ? on
                      ? { color: f.color, backgroundColor: `${f.color}1f` }
                      : { color: f.color }
                    : undefined
                }
              >
                <span aria-hidden>{f.symbol}</span>
                {f.label}
                <span className="tabular-nums opacity-70">{f.count}</span>
              </button>
            )
          })}
        </div>
      )}

      {view === "work" ? (
        <ByWorkView
          works={works}
          criteria={criteria}
          state={state}
          visibleIndices={visibleIndices}
          onRate={rate}
          onFlush={flushAll}
        />
      ) : (
        <ByCriterionView
          works={works}
          criteria={criteria}
          state={state}
          visibleIndices={visibleIndices}
          onRate={rate}
        />
      )}
    </div>
  )
}

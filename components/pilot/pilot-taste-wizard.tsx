"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { savePilotTaste } from "@/server/actions/pilot-taste"
import {
  starsToPostReadingScore,
  scoreToPostReadingStars,
} from "@/lib/constants/post-reading-criteria"
import type { PilotWork, TasteCriterion, TasteScoreKey } from "@/server/queries/pilot-taste"

interface Props {
  criteria: TasteCriterion[]
  works: PilotWork[]
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]
function fmtLastRead(d: string | null): string {
  if (!d) return "Lida"
  const [y, m] = d.split("-")
  const mi = Number(m) - 1
  return `Lida ${MESES[mi] ?? "?"}/${y}`
}

interface WorkState {
  scores: Record<TasteScoreKey, number | null>
  endingNa: boolean
}

type SaveState = "idle" | "saving" | "saved"

export function PilotTasteWizard({ criteria, works }: Props) {
  const aspects = useMemo(() => criteria.filter((c) => !c.isOverall), [criteria])
  const overall = useMemo(() => criteria.find((c) => c.isOverall) ?? null, [criteria])

  const [state, setState] = useState<WorkState[]>(() =>
    works.map((w) => ({ scores: { ...w.scores }, endingNa: w.endingNa })),
  )
  const [idx, setIdx] = useState(0)
  const [active, setActive] = useState<string | null>(null)
  const [hint, setHint] = useState<{ stars: number; text: string } | null>(null)
  const [save, setSave] = useState<SaveState>("idle")

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => doSave(i), 550)
  }
  const flush = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
      doSave(idx)
    }
  }

  const patch = (i: number, mut: (ws: WorkState) => WorkState) =>
    setState((prev) => prev.map((ws, j) => (j === i ? mut(ws) : ws)))

  const setStar = (crit: TasteCriterion, stars: number) => {
    const value = starsToPostReadingScore(stars)
    patch(idx, (ws) => ({
      scores: { ...ws.scores, [crit.key]: value },
      endingNa: crit.allowsNa ? false : ws.endingNa,
    }))
    setActive(crit.slug)
    scheduleSave(idx)
  }
  const setNa = (crit: TasteCriterion) => {
    patch(idx, (ws) => ({ scores: { ...ws.scores, [crit.key]: null }, endingNa: true }))
    setActive(crit.slug)
    scheduleSave(idx)
  }

  const go = (d: number) => {
    const n = idx + d
    if (n < 0 || n >= works.length) return
    flush()
    setIdx(n)
    setActive(null)
    setHint(null)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") return go(1)
      if (e.key === "ArrowLeft") return go(-1)
      if (!active) return
      const crit = criteria.find((c) => c.slug === active)
      if (!crit) return
      if (e.key >= "1" && e.key <= "5") setStar(crit, Number(e.key))
      else if (e.key.toLowerCase() === "n" && crit.allowsNa) setNa(crit)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, idx, criteria])

  const w = works[idx]
  const ws = state[idx]
  const overallKey = overall?.key
  const done = overallKey ? state.filter((s) => s.scores[overallKey] != null).length : 0
  const pct = Math.round((done / works.length) * 100)

  const rowFor = (crit: TasteCriterion, goal: boolean) => {
    const val = ws.scores[crit.key]
    const na = crit.allowsNa && ws.endingNa && val == null
    const filled = na ? 0 : scoreToPostReadingStars(val) ?? 0
    return (
      <div
        key={crit.slug}
        onClick={() => setActive(crit.slug)}
        className={cn(
          "flex items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 transition-colors cursor-pointer hover:bg-muted/50",
          active === crit.slug && "border-violet-500/50 bg-muted/50",
          goal && "bg-gradient-to-r from-violet-500/10 to-transparent border-violet-500/25",
        )}
      >
        <span className="w-6 shrink-0 text-center text-lg" aria-hidden>
          {crit.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold tracking-tight">{crit.name}</div>
          {goal && (
            <div className="mt-0.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              o alvo — dado direto
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <button
              key={i}
              type="button"
              aria-label={`${i} de 5`}
              onClick={(e) => {
                e.stopPropagation()
                setStar(crit, i)
              }}
              onMouseEnter={() => {
                setActive(crit.slug)
                setHint({ stars: i, text: crit.hints[i - 1] ?? "" })
              }}
              className="rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <Star
                className={cn(
                  "h-[22px] w-[22px] transition-transform hover:scale-110",
                  i <= filled
                    ? "fill-rose-500 text-rose-500"
                    : "fill-transparent text-rose-300/60 dark:text-rose-100/15",
                )}
              />
            </button>
          ))}
          {crit.allowsNa && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setNa(crit)
              }}
              className={cn(
                "ml-2 rounded-full border px-2.5 py-1 text-[11px] tracking-wide transition-colors",
                na
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:border-muted-foreground",
              )}
            >
              N/A
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24" onMouseLeave={() => setHint(null)}>
      {/* topbar */}
      <div className="sticky top-0 z-20 -mx-5 mb-6 flex items-center gap-4 border-b border-border bg-background/85 px-5 py-3 backdrop-blur">
        <div className="flex min-w-0 flex-col">
          <b className="text-[15px] font-bold tracking-tight">Notas de gosto</b>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Piloto · calibra o modelo
          </span>
        </div>
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Obras avaliadas</span>
            <b className="text-[13px] tabular-nums text-foreground">
              {done} / {works.length}
            </b>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-rose-500 transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="flex min-w-[64px] items-center justify-end gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              save === "saving" ? "bg-muted-foreground" : "bg-emerald-500",
            )}
          />
          {save === "saving" ? "Salvando…" : "Salvo"}
        </div>
      </div>

      {/* work card */}
      <div className="mb-2 flex items-start gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        {w.cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={w.cover}
            alt=""
            className="h-[124px] w-[88px] shrink-0 rounded-lg object-cover ring-1 ring-black/10"
          />
        ) : (
          <div className="flex h-[124px] w-[88px] shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-rose-500 text-3xl font-extrabold text-white">
            {w.title.charAt(0)}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="text-[11px] uppercase tracking-wider tabular-nums text-muted-foreground">
            Obra {idx + 1} de {works.length}
          </div>
          <h1 className="text-xl font-bold leading-tight tracking-tight text-balance">{w.title}</h1>
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-[11px] text-muted-foreground">
              Tua nota <b className="tabular-nums text-foreground">{w.userScore.toFixed(1)}</b>
            </span>
            <span className="rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-[11px] text-muted-foreground">
              {fmtLastRead(w.lastReadAt)}
            </span>
          </div>
          {w.synopsis && (
            <p className="whitespace-pre-line text-[13px] leading-relaxed text-muted-foreground">
              {w.synopsis}
            </p>
          )}
          {w.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {w.tags.map((t) => (
                <span
                  key={t}
                  className="rounded-md bg-muted/60 px-2 py-0.5 text-[10.5px] text-muted-foreground"
                >
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* hint */}
      <div className="mb-3.5 mt-3 flex min-h-[20px] items-start gap-2 px-0.5 text-[12.5px]">
        {hint ? (
          <>
            <span className="shrink-0 font-bold tracking-wider text-rose-500">
              {"★".repeat(hint.stars)}
            </span>
            <span className="text-muted-foreground">{hint.text}</span>
          </>
        ) : (
          <span className="italic text-muted-foreground/60">
            Passe o mouse nas estrelas pra ver o que cada nota significa.
          </span>
        )}
      </div>

      {/* list */}
      <div className="flex flex-col gap-0.5 rounded-2xl border border-border bg-card p-1.5 shadow-sm">
        {aspects.map((c) => rowFor(c, false))}
        {overall && (
          <>
            <div className="my-1.5 flex items-center gap-2.5 px-1">
              <span className="text-[11px] font-bold uppercase tracking-widest text-violet-500">
                Veredito de gosto
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {rowFor(overall, true)}
          </>
        )}
      </div>

      {/* nav */}
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={idx === 0}
          className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:border-muted-foreground disabled:opacity-40"
        >
          ← Anterior
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={idx === works.length - 1}
          className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:border-muted-foreground disabled:opacity-40"
        >
          Pular
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={idx === works.length - 1}
          className="ml-auto rounded-xl border border-foreground bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Próxima →
        </button>
      </div>

      <div className="mt-4 flex flex-wrap gap-3.5 px-0.5 text-[11.5px] text-muted-foreground/80">
        <span className="font-semibold text-muted-foreground">Atalhos</span>
        <span>
          <kbd className="rounded border border-border bg-muted px-1.5 text-[10px]">1</kbd>–
          <kbd className="rounded border border-border bg-muted px-1.5 text-[10px]">5</kbd> nota na
          linha ativa
        </span>
        <span>
          <kbd className="rounded border border-border bg-muted px-1.5 text-[10px]">N</kbd> não se
          aplica
        </span>
        <span>
          <kbd className="rounded border border-border bg-muted px-1.5 text-[10px]">←</kbd>{" "}
          <kbd className="rounded border border-border bg-muted px-1.5 text-[10px]">→</kbd> navegar
        </span>
      </div>
    </div>
  )
}

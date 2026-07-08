"use client"

import { useEffect, useMemo, useState } from "react"
import { CoverImage } from "@/components/ui/cover-image"
import { cn } from "@/lib/utils"
import { TasteStars } from "@/components/pilot/taste-stars"
import { fmtLastRead } from "@/components/pilot/pilot-shared"
import type { WorkState } from "@/components/pilot/pilot-shared"
import type { PilotWork, TasteCriterion } from "@/server/queries/pilot-taste"

/**
 * Visão "por obra": uma obra por vez, com a capa/sinopse e as 7 notas de gosto.
 * Navega com Anterior/Pular/Próxima e atalhos de teclado.
 */
export function ByWorkView({
  works,
  criteria,
  state,
  onRate,
  onNa,
  onFlush,
}: {
  works: PilotWork[]
  criteria: TasteCriterion[]
  state: WorkState[]
  onRate: (workIndex: number, crit: TasteCriterion, stars: number) => void
  onNa: (workIndex: number, crit: TasteCriterion) => void
  onFlush: () => void
}) {
  const aspects = useMemo(() => criteria.filter((c) => !c.isOverall), [criteria])
  const overall = useMemo(() => criteria.find((c) => c.isOverall) ?? null, [criteria])

  const [idx, setIdx] = useState(0)
  const [active, setActive] = useState<string | null>(null)
  const [hint, setHint] = useState<{ stars: number; text: string } | null>(null)

  const w = works[idx]
  const ws = state[idx]
  const overallKey = overall?.key
  const done = overallKey ? state.filter((s) => s.scores[overallKey] != null).length : 0
  // Barra do topo desta visão = POSIÇÃO na pilha (obra atual), enche ao navegar.
  const posPct = Math.round(((idx + 1) / works.length) * 100)

  const setStar = (crit: TasteCriterion, stars: number) => {
    onRate(idx, crit, stars)
    setActive(crit.slug)
  }
  const setNa = (crit: TasteCriterion) => {
    onNa(idx, crit)
    setActive(crit.slug)
  }

  const go = (d: number) => {
    const n = idx + d
    if (n < 0 || n >= works.length) return
    onFlush()
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

  const rowFor = (crit: TasteCriterion, goal: boolean) => {
    const val = ws.scores[crit.key]
    const na = crit.allowsNa && ws.endingNa && val == null
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
        <TasteStars
          crit={crit}
          value={val}
          na={na}
          onStar={(s) => setStar(crit, s)}
          onNa={crit.allowsNa ? () => setNa(crit) : undefined}
          onHover={(s) => {
            setActive(crit.slug)
            setHint({ stars: s, text: crit.hints[s - 1] ?? "" })
          }}
        />
      </div>
    )
  }

  return (
    <div onMouseLeave={() => setHint(null)}>
      {/* progresso: posição na pilha + total avaliado */}
      <div className="mb-4 flex items-center gap-4">
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Obra atual</span>
            <b className="text-[13px] tabular-nums text-foreground">
              {idx + 1} / {works.length}
            </b>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-rose-500 transition-[width] duration-300"
              style={{ width: `${posPct}%` }}
            />
          </div>
        </div>
        <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
          <b className="text-foreground">{done}</b> avaliada{done === 1 ? "" : "s"}
        </span>
      </div>

      {/* work card */}
      <div className="mb-2 flex items-start gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        {w.coverUrls.length > 0 ? (
          <CoverImage
            // remonta por obra: reseta o fallback de capa ao navegar (o card não é keyed)
            key={w.id}
            urls={w.coverUrls}
            alt=""
            loading="eager"
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
          className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border"
        >
          ← Anterior
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={idx === works.length - 1}
          className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border"
        >
          Pular
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={idx === works.length - 1}
          className="ml-auto rounded-xl border border-foreground bg-foreground px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
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

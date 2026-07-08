"use client"

import { useEffect, useMemo, useState } from "react"
import { CoverImage } from "@/components/ui/cover-image"
import { cn } from "@/lib/utils"
import { TasteStars } from "@/components/pilot/taste-stars"
import { CRITERION_BATCH, fmtLastRead, isAnswered } from "@/components/pilot/pilot-shared"
import type { WorkState } from "@/components/pilot/pilot-shared"
import type { PilotWork, TasteCriterion } from "@/server/queries/pilot-taste"

type Filter = "all" | "missing"

/**
 * Visão "por critério": UM eixo de cada vez, várias obras em lote, pra dar nota
 * comparando as obras entre si (rótulo mais consistente). Reusa o mesmo estado e
 * autosave da visão por obra — só muda a lente.
 */
export function ByCriterionView({
  works,
  criteria,
  state,
  onRate,
  onNa,
}: {
  works: PilotWork[]
  criteria: TasteCriterion[]
  state: WorkState[]
  onRate: (workIndex: number, crit: TasteCriterion, stars: number) => void
  onNa: (workIndex: number, crit: TasteCriterion) => void
}) {
  const [critSlug, setCritSlug] = useState(() => criteria[0]?.slug ?? "")
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState<Filter>("all")
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)

  const crit = useMemo(
    () => criteria.find((c) => c.slug === critSlug) ?? criteria[0],
    [criteria, critSlug],
  )

  // quantas obras já responderam cada critério (pros contadores dos chips)
  const answeredByCrit = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of criteria) m[c.slug] = state.filter((ws) => isAnswered(ws, c)).length
    return m
  }, [criteria, state])

  // obras (com índice original) filtradas pelo eixo ativo; ordem = leitura recente (query)
  const filtered = useMemo(() => {
    const all = works.map((w, i) => ({ w, i }))
    if (filter === "missing") return all.filter(({ i }) => !isAnswered(state[i], crit))
    return all
  }, [works, state, crit, filter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / CRITERION_BATCH))
  const safePage = Math.min(page, pageCount - 1)
  const start = safePage * CRITERION_BATCH
  const pageItems = filtered.slice(start, start + CRITERION_BATCH)

  const switchCrit = (slug: string) => {
    setCritSlug(slug)
    setPage(0)
    setHoverIdx(null)
  }
  const stepCrit = (d: number) => {
    const at = criteria.findIndex((c) => c.slug === crit.slug)
    const next = criteria[at + d]
    if (next) switchCrit(next.slug)
  }
  const changeFilter = (f: Filter) => {
    setFilter(f)
    setPage(0)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") return stepCrit(1)
      if (e.key === "ArrowLeft") return stepCrit(-1)
      if (hoverIdx == null) return
      if (e.key >= "1" && e.key <= "5") onRate(hoverIdx, crit, Number(e.key))
      else if (e.key.toLowerCase() === "n" && crit.allowsNa) onNa(hoverIdx, crit)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crit, hoverIdx, criteria])

  const answered = answeredByCrit[crit.slug] ?? 0
  const answeredPct = Math.round((answered / works.length) * 100)
  const rangeA = filtered.length === 0 ? 0 : start + 1
  const rangeB = Math.min(filtered.length, start + pageItems.length)

  return (
    <div>
      {/* seletor de critério */}
      <div className="mb-4 flex flex-wrap gap-2">
        {criteria.map((c) => {
          const on = c.slug === crit.slug
          return (
            <button
              key={c.slug}
              type="button"
              onClick={() => switchCrit(c.slug)}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                on
                  ? "border-violet-500/55 bg-gradient-to-r from-violet-500/20 to-rose-500/10 text-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-muted-foreground hover:text-foreground",
                c.isOverall && !on && "border-dashed",
              )}
            >
              <span aria-hidden>{c.emoji}</span>
              {c.name}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10.5px] tabular-nums",
                  on ? "bg-white/15 text-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {answeredByCrit[c.slug] ?? 0}
              </span>
            </button>
          )
        })}
      </div>

      {/* critério ativo + régua */}
      <div className="mb-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="text-2xl" aria-hidden>
            {crit.emoji}
          </span>
          <h1 className="text-lg font-bold tracking-tight">{crit.name}</h1>
          {crit.isOverall && (
            <span className="text-[10.5px] font-bold uppercase tracking-widest text-violet-500">
              o alvo
            </span>
          )}
          <span className="ml-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground">
            <b className="text-foreground">{answered}</b> / {works.length} avaliadas
          </span>
        </div>
        {crit.description && (
          <p className="mt-1.5 text-[13px] text-muted-foreground">{crit.description}</p>
        )}
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 to-rose-500 transition-[width] duration-300"
            style={{ width: `${answeredPct}%` }}
          />
        </div>
        {crit.hints.length > 0 && (
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {crit.hints.slice(0, 5).map((h, i) => (
              <div key={i} className="rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1.5">
                <div className="text-[11px] tracking-wider text-rose-500">{"★".repeat(i + 1)}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{h}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* controles do lote */}
      <div className="mb-2.5 flex flex-wrap items-center gap-3">
        <div className="text-xs text-muted-foreground">
          Obras <b className="text-foreground tabular-nums">{rangeA}</b>–
          <b className="text-foreground tabular-nums">{rangeB}</b> de{" "}
          <b className="text-foreground tabular-nums">{filtered.length}</b> · leitura recente
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex gap-1.5">
            {(["all", "missing"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => changeFilter(f)}
                className={cn(
                  "rounded-full border px-3 py-1 text-[11.5px] transition-colors",
                  filter === f
                    ? "border-violet-500/55 bg-violet-500/12 text-foreground"
                    : "border-border text-muted-foreground hover:border-muted-foreground",
                )}
              >
                {f === "all" ? "Todas" : "Só faltando"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-sm transition-colors hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border"
              aria-label="Lote anterior"
            >
              ←
            </button>
            <span className="min-w-[52px] text-center text-[11.5px] tabular-nums text-muted-foreground">
              {safePage + 1} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-sm transition-colors hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border"
              aria-label="Próximo lote"
            >
              →
            </button>
          </div>
        </div>
      </div>

      {/* lista de obras */}
      {pageItems.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Tudo avaliado neste eixo. 🎉
        </div>
      ) : (
        <div className="flex flex-col rounded-2xl border border-border bg-card p-1.5 shadow-sm">
          {pageItems.map(({ w, i }, j) => {
            const val = state[i].scores[crit.key]
            const na = crit.allowsNa && state[i].endingNa && val == null
            return (
              <div
                key={w.id}
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
                className={cn(
                  "flex items-center gap-3 rounded-xl border border-transparent px-3 py-2 transition-colors",
                  hoverIdx === i ? "border-violet-500/40 bg-muted/50" : "hover:bg-muted/40",
                  "[&+&]:border-t [&+&]:border-t-border/50 [&+&]:rounded-t-none",
                )}
              >
                <span className="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground/70">
                  {start + j + 1}
                </span>
                {w.coverUrls.length > 0 ? (
                  <CoverImage
                    key={w.id}
                    urls={w.coverUrls}
                    alt=""
                    loading="eager"
                    className="h-[59px] w-[42px] shrink-0 rounded-md object-cover ring-1 ring-black/10"
                  />
                ) : (
                  <div className="flex h-[59px] w-[42px] shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-violet-500 to-rose-500 text-base font-extrabold text-white">
                    {w.title.charAt(0)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold tracking-tight">{w.title}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="whitespace-nowrap rounded-full border border-border px-2 py-0.5">
                      tua nota{" "}
                      <b className="tabular-nums text-foreground">{w.userScore.toFixed(1)}</b>
                    </span>
                    <span className="whitespace-nowrap">{fmtLastRead(w.lastReadAt)}</span>
                  </div>
                </div>
                <div className="shrink-0">
                  <TasteStars
                    crit={crit}
                    value={val}
                    na={na}
                    starClass="h-[21px] w-[21px]"
                    onStar={(s) => onRate(i, crit, s)}
                    onNa={crit.allowsNa ? () => onNa(i, crit) : undefined}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3.5 px-0.5 text-[11.5px] text-muted-foreground/80">
        <span className="font-semibold text-muted-foreground">Atalhos</span>
        <span>
          <kbd className="rounded border border-border bg-muted px-1.5 text-[10px]">1</kbd>–
          <kbd className="rounded border border-border bg-muted px-1.5 text-[10px]">5</kbd> nota na
          obra sob o mouse
        </span>
        {crit.allowsNa && (
          <span>
            <kbd className="rounded border border-border bg-muted px-1.5 text-[10px]">N</kbd> não se
            aplica
          </span>
        )}
        <span>
          <kbd className="rounded border border-border bg-muted px-1.5 text-[10px]">←</kbd>{" "}
          <kbd className="rounded border border-border bg-muted px-1.5 text-[10px]">→</kbd> troca de
          critério
        </span>
      </div>
    </div>
  )
}

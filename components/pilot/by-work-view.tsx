"use client"

import { useEffect, useMemo, useState } from "react"
import { ArrowUpRight } from "lucide-react"
import { CoverImage } from "@/components/ui/cover-image"
import { PersonalStatusBadge } from "@/components/ui/status-badge"
import { cn, titleToSlug } from "@/lib/utils"
import { TasteStars } from "@/components/pilot/taste-stars"
import { fmtLastRead, isAnswered } from "@/components/pilot/pilot-shared"
import { isFullyReadPersonalStatus } from "@/lib/constants/status-lookups"
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
  visibleIndices,
  onRate,
  onFlush,
}: {
  works: PilotWork[]
  criteria: TasteCriterion[]
  state: WorkState[]
  /** Índices (originais em `works`/`state`) visíveis sob o filtro de status. */
  visibleIndices: number[]
  onRate: (workIndex: number, crit: TasteCriterion, stars: number) => void
  onFlush: () => void
}) {
  const aspects = useMemo(() => criteria.filter((c) => !c.isOverall), [criteria])
  const overall = useMemo(() => criteria.find((c) => c.isOverall) ?? null, [criteria])

  // `pos` navega pelo subconjunto visível; `wi` é o índice ORIGINAL da obra atual.
  const [pos, setPos] = useState(0)
  const [active, setActive] = useState<string | null>(null)
  const [hint, setHint] = useState<{ stars: number; text: string } | null>(null)

  // Filtro mudou (nova referência de visibleIndices) → reinicia no topo da lista
  // visível. Ajuste em render (padrão do React), não em efeito.
  const [prevVisible, setPrevVisible] = useState(visibleIndices)
  if (prevVisible !== visibleIndices) {
    setPrevVisible(visibleIndices)
    setPos(0)
    setActive(null)
    setHint(null)
  }

  const total = visibleIndices.length
  const safePos = Math.min(pos, Math.max(0, total - 1))
  const wi = visibleIndices[safePos] ?? -1
  const w = works[wi]
  const ws = state[wi]
  // "Avaliada" = todos os aspectos aplicáveis respondidos (o veredito manual foi aposentado).
  const done = visibleIndices.filter((i) =>
    aspects.every((a) => isAnswered(state[i], a, isFullyReadPersonalStatus(works[i].personalStatusId))),
  ).length
  // Barra do topo desta visão = POSIÇÃO na pilha (obra atual), enche ao navegar.
  const posPct = total === 0 ? 0 : Math.round(((safePos + 1) / total) * 100)

  const setStar = (crit: TasteCriterion, stars: number) => {
    onRate(wi, crit, stars)
    setActive(crit.slug)
  }

  const go = (d: number) => {
    const n = safePos + d
    if (n < 0 || n >= total) return
    onFlush()
    setPos(n)
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
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, wi, criteria])

  if (!w || !ws) {
    return (
      <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        Nenhuma obra neste status.
      </div>
    )
  }

  const endingLocked = !isFullyReadPersonalStatus(w.personalStatusId)

  const rowFor = (crit: TasteCriterion, goal: boolean) => {
    const val = ws.scores[crit.key]
    const locked = crit.allowsNa && endingLocked
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
          value={val}
          onStar={(s) => setStar(crit, s)}
          lockedReason={locked ? "Avalie ao terminar de ler" : undefined}
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
              {safePos + 1} / {total}
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

      {/* 2 colunas: obra à esquerda · notas de gosto à direita */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-start">
        {/* esquerda: capa grande + ficha da obra */}
        <div className="flex flex-col gap-3.5 rounded-2xl border border-border bg-card p-5 shadow-sm">
          {w.coverUrls.length > 0 ? (
            <CoverImage
              // remonta por obra: reseta o fallback de capa ao navegar (o card não é keyed)
              key={w.id}
              urls={w.coverUrls}
              alt=""
              loading="eager"
              className="aspect-[88/124] w-full max-w-[268px] self-start rounded-xl object-cover shadow-lg ring-1 ring-black/10"
            />
          ) : (
            <div className="flex aspect-[88/124] w-full max-w-[268px] items-center justify-center self-start rounded-xl bg-gradient-to-br from-violet-500 to-rose-500 text-6xl font-extrabold text-white shadow-lg">
              {w.title.charAt(0)}
            </div>
          )}
          <div className="text-[11px] uppercase tracking-wider tabular-nums text-muted-foreground">
            Obra {safePos + 1} de {total}
          </div>
          <a
            href={`/catalog/${titleToSlug(w.title)}`}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir a página da obra (nova aba)"
            className="group inline-flex items-start gap-1.5 self-start"
          >
            <h1 className="text-2xl font-bold leading-tight tracking-tight text-balance underline-offset-4 group-hover:underline group-hover:decoration-violet-500">
              {w.title}
            </h1>
            <ArrowUpRight className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-violet-500" />
          </a>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-[11px] text-muted-foreground">
              Tua nota <b className="tabular-nums text-foreground">{w.userScore.toFixed(1)}</b>
            </span>
            {w.personalStatusId != null && (
              <PersonalStatusBadge statusId={w.personalStatusId} className="text-[11px]" />
            )}
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

        {/* direita: régua (hint) + as 7 notas de gosto */}
        <div className="rounded-2xl border border-border bg-card p-1.5 shadow-sm">
          <div className="flex min-h-[20px] items-start gap-2 px-2.5 py-2 text-[12.5px]">
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
          <div className="flex flex-col gap-0.5">
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
        </div>
      </div>

      {/* nav */}
      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => go(-1)}
          disabled={safePos === 0}
          className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border"
        >
          ← Anterior
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={safePos === total - 1}
          className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold transition-colors hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border"
        >
          Pular
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={safePos === total - 1}
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
          <kbd className="rounded border border-border bg-muted px-1.5 text-[10px]">←</kbd>{" "}
          <kbd className="rounded border border-border bg-muted px-1.5 text-[10px]">→</kbd> navegar
        </span>
      </div>
    </div>
  )
}

"use client"

import { ChevronRight, Info, Lightbulb } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { formatEta, previewCascade, shortModelName } from "@/lib/cost-preview/catalog"
import { makeUsdScale, type UsdScale } from "@/lib/format/money"
import { COST_JOURNEYS, JOURNEY_GROUPS, type CostJourney } from "@/lib/cost-preview/journeys"

/** Nº de "moedas" (1–3) que representa a faixa de custo, pra bater o olho. */
function costDots(usd: number): number {
  if (usd < 0.02) return 1
  if (usd < 0.1) return 2
  return 3
}

export function CostMenu() {
  const [open, setOpen] = useState<Set<string>>(() => new Set())

  // Esta lista existe pra ORDENAR ações por custo, então a régua é a lista toda —
  // não cada linha por si. Escolhendo a unidade linha a linha, a coluna saía
  // "~$0,10 · ~4,72¢ · ~8,15¢ · ~3¢ · ~1,22¢" e comparar exigia converter de
  // cabeça. Entram os totais, os tetos e os passos, que são as parcelas do total.
  const previews = new Map(COST_JOURNEYS.map((j) => [j.id, previewCascade(j.parts)]))
  const scale = makeUsdScale(
    ...[...previews.values()].flatMap((pv) => [
      pv.likelyUsd,
      pv.upperBoundUsd,
      ...pv.steps.map((s) => s.likelyUsd),
    ]),
  )

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className="rounded-xl border border-border/70 bg-card/55 shadow-sm shadow-black/5">
      <header className="border-b border-border/60 px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-foreground">Quanto custa cada ação</h2>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          O que cada coisa que você faz no app consome de IA. Algumas ações disparam outras
          automaticamente — aqui o valor já vem somado.
        </p>
      </header>

      <div className="space-y-5 px-4 py-4 sm:px-5">
        <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/30 px-3 py-1.5 text-[11.5px] text-muted-foreground">
          <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
          Estimativa em dólar (<strong className="font-semibold">¢</strong> = centavo de dólar) — o
          mesmo valor que aparece antes de você confirmar uma ação.
        </div>

        {JOURNEY_GROUPS.map((group) => {
          const journeys = COST_JOURNEYS.filter((j) => j.group === group.id)
          if (journeys.length === 0) return null
          return (
            <div key={group.id}>
              <div className="mb-2.5 flex items-center gap-2.5">
                <span aria-hidden className="text-base">
                  {group.emoji}
                </span>
                <h3 className="text-[13px] font-semibold text-foreground">{group.label}</h3>
                <span className="h-px flex-1 bg-border/70" />
              </div>
              <div className="space-y-2">
                {journeys.map((journey) => (
                  <JourneyRow
                    key={journey.id}
                    journey={journey}
                    pv={previews.get(journey.id)!}
                    scale={scale}
                    isOpen={open.has(journey.id)}
                    onToggle={() => toggle(journey.id)}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function JourneyRow({
  journey,
  pv,
  scale,
  isOpen,
  onToggle,
}: {
  journey: CostJourney
  pv: ReturnType<typeof previewCascade>
  /** Régua da lista inteira — ver o comentário no `CostMenu`. */
  scale: UsdScale
  isOpen: boolean
  onToggle: () => void
}) {
  const composed = journey.parts.length > 1
  const expandable = composed || !!journey.note
  const dots = costDots(pv.likelyUsd)
  const isCheap = pv.likelyUsd < 0.01

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border/70 bg-card/40 transition-colors",
        expandable && "hover:border-border",
      )}
    >
      <div
        role={expandable ? "button" : undefined}
        tabIndex={expandable ? 0 : undefined}
        onClick={expandable ? onToggle : undefined}
        onKeyDown={
          expandable
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  onToggle()
                }
              }
            : undefined
        }
        className={cn(
          "grid grid-cols-[42px_1fr_auto] items-center gap-3.5 px-3.5 py-3 sm:px-4",
          expandable && "cursor-pointer",
        )}
      >
        <span
          aria-hidden
          className="grid h-[42px] w-[42px] place-items-center rounded-xl bg-primary/10 text-xl"
        >
          {journey.emoji}
        </span>

        <div className="min-w-0">
          <p className="text-[14.5px] font-semibold leading-tight text-foreground">
            {journey.label}
          </p>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{journey.summary}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1">
            <CostDots n={dots} />
            <span className="text-[11px] text-muted-foreground/80">⏱ {formatEta(pv.etaSeconds)}</span>
            {expandable && (
              <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary">
                <ChevronRight
                  className={cn("h-3 w-3 transition-transform", isOpen && "rotate-90")}
                />
                {composed ? "o que está incluído" : "detalhe"}
              </span>
            )}
          </div>
        </div>

        <div className="text-right">
          <p
            className={cn(
              "text-[19px] font-bold leading-none tabular-nums",
              isCheap ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
            )}
          >
            {scale.approx(pv.likelyUsd)}
          </p>
          {composed && (
            <p className="mt-1 text-[11px] text-muted-foreground/80">
              até {scale.format(pv.upperBoundUsd)}
            </p>
          )}
        </div>
      </div>

      {expandable && isOpen && (
        <div className="border-t border-dashed border-border/70 bg-muted/20 px-3.5 py-3 pl-[68px] sm:px-4 sm:pl-[68px]">
          {composed && (
            <>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Passos que rodam automaticamente
              </p>
              <div className="space-y-0.5">
                {pv.steps.map((step, i) => (
                  <div
                    key={`${step.label}-${i}`}
                    className="flex items-center justify-between gap-3 border-b border-border/40 py-1.5 text-[12.5px] last:border-b-0"
                  >
                    <span className="flex items-center gap-2 text-foreground">
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      {step.label}
                      <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {shortModelName(step.model)}
                      </span>
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {scale.approx(step.likelyUsd)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          {journey.note && (
            <p
              className={cn(
                "flex items-start gap-2 rounded-lg bg-amber-500/10 px-2.5 py-2 text-[11.5px] text-amber-700 dark:text-amber-300",
                composed && "mt-2.5",
              )}
            >
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{journey.note}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function CostDots({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`Faixa de custo: ${n} de 3`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn("h-[7px] w-[7px] rounded-full", i < n ? "bg-amber-400" : "bg-border")}
        />
      ))}
    </span>
  )
}

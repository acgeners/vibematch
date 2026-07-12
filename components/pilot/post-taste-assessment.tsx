"use client"

import { useMemo, useRef, useState } from "react"
import { Star } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { savePilotTaste } from "@/server/actions/pilot-taste"
import {
  starsToPostReadingScore,
  scoreToPostReadingStars,
} from "@/lib/constants/post-reading-criteria"
import type { TasteCriterion, TasteScoreKey } from "@/server/queries/pilot-taste"

interface Props {
  workId: string
  criteria: TasteCriterion[]
  initialScores: Record<TasteScoreKey, number | null>
  initialEndingNa: boolean
}

type SaveState = "idle" | "saving" | "saved"

/**
 * Avaliação por GOSTO da obra (6 aspectos + "Gostei geral"), embutida na aba de
 * leitura. Nota direta (não calculada da média — ver PLANO-ARQUITETURA-NOTAS.md).
 * Autosave em `pilot_taste_scores`.
 */
export function PostTasteAssessment({ workId, criteria, initialScores, initialEndingNa }: Props) {
  const aspects = useMemo(() => criteria.filter((c) => !c.isOverall), [criteria])
  const overall = useMemo(() => criteria.find((c) => c.isOverall) ?? null, [criteria])

  const [scores, setScores] = useState<Record<TasteScoreKey, number | null>>({ ...initialScores })
  const [endingNa, setEndingNa] = useState(initialEndingNa)
  const [active, setActive] = useState<string | null>(null)
  const [hint, setHint] = useState<{ stars: number; text: string } | null>(null)
  const [save, setSave] = useState<SaveState>("idle")

  const stateRef = useRef({ scores, endingNa })
  stateRef.current = { scores, endingNa }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleSave = () => {
    setSave("saving")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const s = stateRef.current
      savePilotTaste(workId, s.scores, s.endingNa)
        .then((r) => setSave(r.ok ? "saved" : "idle"))
        .catch(() => setSave("idle"))
    }, 550)
  }

  const setStar = (crit: TasteCriterion, stars: number) => {
    const value = starsToPostReadingScore(stars)
    setScores((p) => ({ ...p, [crit.key]: value }))
    if (crit.allowsNa) setEndingNa(false)
    setActive(crit.slug)
    scheduleSave()
  }
  const setNa = (crit: TasteCriterion) => {
    setScores((p) => ({ ...p, [crit.key]: null }))
    setEndingNa(true)
    setActive(crit.slug)
    scheduleSave()
  }

  const overallVal = overall ? scores[overall.key] : null

  const row = (crit: TasteCriterion, goal: boolean) => {
    const val = scores[crit.key]
    const na = crit.allowsNa && endingNa && val == null
    const filled = na ? 0 : scoreToPostReadingStars(val) ?? 0
    return (
      <div
        key={crit.slug}
        onClick={() => setActive(crit.slug)}
        className={cn(
          "flex items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 transition-colors cursor-pointer hover:bg-background/50",
          active === crit.slug && "border-violet-500/40 bg-background/50",
          goal && "bg-gradient-to-r from-violet-500/10 to-transparent border-violet-500/25",
        )}
      >
        <span className="w-6 shrink-0 text-center text-lg" aria-hidden>
          {crit.emoji}
        </span>
        <div className="min-w-0 flex-1 text-sm font-semibold tracking-tight">{crit.name}</div>
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
              className="rounded-md p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <Star
                className={cn(
                  "h-5 w-5 transition-transform hover:scale-110",
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
                "ml-1.5 rounded-full border px-2 py-0.5 text-[11px] tracking-wide transition-colors",
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
    <Card className="bg-card/50" onMouseLeave={() => setHint(null)}>
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-bold">Como foi pra você?</CardTitle>
          <div className="flex items-center gap-3">
            {overallVal != null && (
              <span className="text-sm text-muted-foreground">
                Gostei geral <b className="tabular-nums text-foreground">{overallVal}</b>
              </span>
            )}
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  save === "saving" ? "bg-muted-foreground" : "bg-emerald-500",
                  save === "idle" && "opacity-0",
                )}
              />
              {save === "saving" ? "Salvando…" : save === "saved" ? "Salvo" : ""}
            </span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          O quanto <strong>combinou com você</strong> — não &quot;quão bem feito&quot;.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex min-h-[18px] items-start gap-2 text-[12px]">
          {hint ? (
            <>
              <span className="shrink-0 font-bold tracking-wider text-rose-500">
                {"★".repeat(hint.stars)}
              </span>
              <span className="text-muted-foreground">{hint.text}</span>
            </>
          ) : (
            <span className="italic text-muted-foreground/60">
              Passe o mouse nas estrelas pra ver cada nota.
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{aspects.map((c) => row(c, false))}</div>

        {overall && (
          <>
            <div className="flex items-center gap-2.5 pt-1">
              <span className="text-[11px] font-bold uppercase tracking-widest text-violet-500">
                Veredito de gosto
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {row(overall, true)}
          </>
        )}
      </CardContent>
    </Card>
  )
}

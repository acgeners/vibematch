"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Star, Lock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScoreBadge } from "@/components/ui/score-badge"
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
  /**
   * O eixo "Final" (o único com `allowsNa`) só é avaliável quando a obra está
   * terminada (status fully-read). Vem do fluxo ao vivo — muda sem reload conforme o
   * status muda. Quando false, a linha vira um selo travado e é gravada vazia.
   */
  endingApplicable: boolean
}

type SaveState = "idle" | "saving" | "saved"

/**
 * Avaliação por GOSTO da obra (6 aspectos + "Gostei geral"), embutida na aba de
 * leitura. Nota direta (não calculada da média — ver PLANO-ARQUITETURA-NOTAS.md).
 * Autosave em `pilot_taste_scores`.
 */
export function PostTasteAssessment({ workId, criteria, initialScores, endingApplicable }: Props) {
  const aspects = useMemo(() => criteria.filter((c) => !c.isOverall), [criteria])
  const overall = useMemo(() => criteria.find((c) => c.isOverall) ?? null, [criteria])
  const endingKey = useMemo(() => criteria.find((c) => c.allowsNa)?.key, [criteria])

  const [scores, setScores] = useState<Record<TasteScoreKey, number | null>>({ ...initialScores })
  const [active, setActive] = useState<string | null>(null)
  const [hint, setHint] = useState<{ stars: number; text: string } | null>(null)
  const [save, setSave] = useState<SaveState>("idle")

  const stateRef = useRef({ scores, endingApplicable })
  useEffect(() => {
    stateRef.current = { scores, endingApplicable }
  }, [scores, endingApplicable])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleSave = () => {
    setSave("saving")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const s = stateRef.current
      // Regra autoritativa no save: obra não terminada → "Final" vazio + ending_na.
      const payload =
        s.endingApplicable || !endingKey ? s.scores : { ...s.scores, [endingKey]: null }
      savePilotTaste(workId, payload, !s.endingApplicable)
        .then((r) => setSave(r.ok ? "saved" : "idle"))
        .catch(() => setSave("idle"))
    }, 550)
  }

  const setStar = (crit: TasteCriterion, stars: number) => {
    const value = starsToPostReadingScore(stars)
    setScores((p) => ({ ...p, [crit.key]: value }))
    setActive(crit.slug)
    scheduleSave()
  }

  // Nota de gosto calculada = média dos 7 eixos do RÓTULO (todos menos o "Final"). É a MESMA
  // conta de `computeTasteUserScore`, que vira o `user_score` da obra: com os 7 preenchidos, este
  // número é idêntico à "Real" da página. O "Final" fica de fora de propósito (piora como rótulo —
  // PR #153); ele segue avaliável na tela como feature, só não entra nesta média. Antes de os 7
  // fecharem, isto é só um preview parcial (não há `user_score` gravado ainda).
  const labelScores = aspects
    .filter((c) => !c.allowsNa)
    .map((c) => scores[c.key])
    .filter((v): v is number => v != null)
  const calcScore =
    labelScores.length > 0
      ? Math.round((labelScores.reduce((a, b) => a + b, 0) / labelScores.length) * 10) / 10
      : null

  const row = (crit: TasteCriterion, goal: boolean) => {
    const val = scores[crit.key]
    const locked = crit.allowsNa && !endingApplicable
    if (locked) {
      return (
        <div
          key={crit.slug}
          className="flex items-center gap-3 rounded-lg border border-transparent px-2.5 py-2"
        >
          <span className="w-6 shrink-0 text-center text-lg opacity-50" aria-hidden>
            {crit.emoji}
          </span>
          <div className="min-w-0 flex-1 text-sm font-semibold tracking-tight text-muted-foreground">
            {crit.name}
          </div>
          <span className="flex items-center gap-1.5 text-[12px] italic text-muted-foreground/70">
            <Lock className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            Avalie ao terminar de ler
          </span>
        </div>
      )
    }
    const filled = scoreToPostReadingStars(val) ?? 0
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
            {calcScore != null && (
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1 shadow-xs">
                <div className="flex flex-col leading-none">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    Nota de gosto
                  </span>
                  <span className="text-[10px] leading-none text-muted-foreground/70">Calculada</span>
                </div>
                <ScoreBadge score={calcScore} size="sm" className="h-7 w-11 text-sm font-bold shadow-xs" />
              </div>
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

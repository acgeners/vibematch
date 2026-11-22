"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Star, Lock } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScoreBadge } from "@/components/ui/score-badge"
import { cn } from "@/lib/utils"
import { savePilotTaste } from "@/server/actions/pilot-taste"
import { saveQuickScore } from "@/server/actions/quick-score"
import {
  starsToPostReadingScore,
  scoreToPostReadingStars,
} from "@/lib/constants/post-reading-criteria"
import { effectiveRating, formatRating, tasteLabelState } from "@/lib/ratings/effective-rating"
import type { TasteLabelState } from "@/lib/ratings/effective-rating"
import type { TasteCriterion, TasteScoreKey } from "@/server/queries/pilot-taste"

/** A nota direta: 1 a 10, a mesma escala do `/rate`. */
const DIRECT_SCALE = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

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
  /** Versão ATIVA na tela (obra mixed, mig 216) — a de uma avaliação NOVA. Ver lib/editions/read-edition.ts. */
  activeEdition?: "normal" | "r18" | null
  /**
   * `card`: o cartão "Como foi pra você?" da página da obra, com a nota direta em cima.
   * `inline`: o painel aberto embaixo de uma obra no `/rate`, onde a nota direta é a escala da linha.
   */
  variant?: "card" | "inline"
  /** A nota gravada (`user_score`) ao abrir — ou, no `inline`, a direta dada na linha. */
  score?: number | null
  /** Há notas da avaliação antiga por critérios (craft): ela vence a direta (`effectiveRating`). */
  legacyPresent?: boolean
  /** Avisa quem está em volta (o `/rate`) quando as categorias mudam: completas, a nota é delas. */
  onTasteChange?: (state: TasteLabelState) => void
  /** `inline`: o botão "Fechar". */
  onClose?: () => void
}

type SaveState = "idle" | "saving" | "saved"

/**
 * Avaliação por GOSTO da obra (7 categorias + o "Final"), com a nota DIRETA ao lado — as duas formas
 * de dar nota, nas duas telas (página da obra e `/rate`). Qual delas vale sai de `effectiveRating`:
 * as 7 categorias completas vencem a direta, e a tela diz isso em vez de mostrar dois números.
 * Autosave em `pilot_taste_scores` (categorias) e `saveQuickScore` (direta).
 */
export function PostTasteAssessment({
  workId,
  criteria,
  initialScores,
  endingApplicable,
  activeEdition = null,
  variant = "card",
  score = null,
  legacyPresent = false,
  onTasteChange,
  onClose,
}: Props) {
  const aspects = useMemo(() => criteria.filter((c) => !c.isOverall), [criteria])
  const overall = useMemo(() => criteria.find((c) => c.isOverall) ?? null, [criteria])
  const endingKey = useMemo(() => criteria.find((c) => c.allowsNa)?.key, [criteria])

  const [scores, setScores] = useState<Record<TasteScoreKey, number | null>>({ ...initialScores })
  const [direct, setDirect] = useState<number | null>(score)
  const [active, setActive] = useState<string | null>(null)
  const [hint, setHint] = useState<{ stars: number; text: string } | null>(null)
  const [save, setSave] = useState<SaveState>("idle")

  // No `inline` a nota direta é a da LINHA, que muda por fora (a escala do `/rate`).
  const [syncedScore, setSyncedScore] = useState(score)
  if (variant === "inline" && score !== syncedScore) {
    setSyncedScore(score)
    setDirect(score)
  }

  const stateRef = useRef({ scores, endingApplicable, activeEdition })
  useEffect(() => {
    stateRef.current = { scores, endingApplicable, activeEdition }
  }, [scores, endingApplicable, activeEdition])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const scheduleSave = () => {
    setSave("saving")
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const s = stateRef.current
      // Regra autoritativa no save: obra não terminada → "Final" vazio + ending_na.
      const payload =
        s.endingApplicable || !endingKey ? s.scores : { ...s.scores, [endingKey]: null }
      savePilotTaste(workId, payload, !s.endingApplicable, s.activeEdition)
        .then((r) => setSave(r.ok ? "saved" : "idle"))
        .catch(() => setSave("idle"))
    }, 550)
  }

  const taste = tasteLabelState(criteria, scores)
  const rating = effectiveRating({ taste, legacyPresent, score: direct })

  const setStar = (crit: TasteCriterion, stars: number) => {
    const value = starsToPostReadingScore(stars)
    const next = { ...scores, [crit.key]: value }
    setScores(next)
    setActive(crit.slug)
    scheduleSave()
    onTasteChange?.(tasteLabelState(criteria, next))
  }

  const setDirectScore = (value: number) => {
    if (!rating.directAllowed) return
    const next = direct === value ? null : value
    setDirect(next)
    setSave("saving")
    void saveQuickScore(workId, next)
      .then((r) => setSave(r.ok ? "saved" : "idle"))
      .catch(() => setSave("idle"))
  }

  /** A linha que diz o que as categorias valem agora — nas duas telas, o mesmo texto. */
  const tasteLine = taste.complete ? (
    <>
      Nota pelas categorias: <b className="font-mono text-foreground">{formatRating(taste.average ?? 0)}</b> — é a que
      vale.
    </>
  ) : taste.filled > 0 ? (
    <>
      Prévia: <b className="font-mono text-foreground">{formatRating(taste.average ?? 0)}</b> · faltam{" "}
      {taste.needed - taste.filled} de {taste.needed} para virar a sua nota
      {direct != null && !legacyPresent ? ` (hoje vale a direta, ${formatRating(direct)})` : ""}.
    </>
  ) : (
    <>Preencha as {taste.needed} categorias para a nota sair delas. O Final não entra na conta.</>
  )

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
              aria-label={`${crit.name}: ${i} de 5`}
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

  const saveDot = (
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
  )

  const categories = (
    <>
      <div className="flex min-h-[18px] items-start gap-2 text-[12px]">
        {hint ? (
          <>
            <span className="shrink-0 font-bold tracking-wider text-rose-500">
              {"★".repeat(hint.stars)}
            </span>
            <span className="text-muted-foreground">{hint.text.replace(/^★+\s*→\s*/, "")}</span>
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
    </>
  )

  if (variant === "inline") {
    return (
      <div className="w-full space-y-2 rounded-xl border border-border/50 bg-background/30 p-3" onMouseLeave={() => setHint(null)}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] text-muted-foreground">{tasteLine}</p>
          <div className="flex items-center gap-3">
            {saveDot}
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border/60 bg-background/40 px-2.5 py-1 text-xs font-medium hover:bg-background/70"
              >
                Fechar
              </button>
            )}
          </div>
        </div>
        {categories}
      </div>
    )
  }

  const directNote =
    rating.source === "categories"
      ? "Vale a nota das categorias. Para usar a nota direta, use “Remover minha nota” no fim da página."
      : rating.source === "legacy"
        ? "Vale a avaliação antiga por critérios desta obra. Para usar a nota direta, use “Remover minha nota” no fim da página."
        : `Um toque e pronto. Com as ${taste.needed} categorias preenchidas, a nota delas passa a valer no lugar desta.`
  const shownDirect = rating.source === "direct" && direct != null && Number.isInteger(direct) ? direct : null

  return (
    <Card className="bg-card/50" onMouseLeave={() => setHint(null)}>
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base font-bold">Como foi pra você?</CardTitle>
          <div className="flex items-center gap-3">
            {rating.value != null && (
              <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1 shadow-xs">
                <div className="flex flex-col leading-none">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    Sua nota
                  </span>
                  <span className="text-[10px] leading-none text-muted-foreground/70">
                    {rating.source === "categories" ? "Calculada" : rating.source === "legacy" ? "Avaliação antiga" : "Direta"}
                  </span>
                </div>
                <ScoreBadge score={rating.value} size="sm" className="h-7 w-11 text-sm font-bold shadow-xs" />
              </div>
            )}
            {saveDot}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          O quanto <strong>combinou com você</strong> — não &quot;quão bem feito&quot;.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border/50 bg-background/30 px-3 py-2.5">
          <span className="text-sm font-semibold">Nota direta</span>
          <span className="flex gap-1" role="group" aria-label="Nota direta">
            {DIRECT_SCALE.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={shownDirect === v}
                aria-disabled={!rating.directAllowed || undefined}
                onClick={() => setDirectScore(v)}
                className={cn(
                  "h-8 w-8 rounded-md border border-border/60 bg-background/40 font-mono text-[13px] transition-colors",
                  rating.directAllowed ? "hover:border-sky-400/60" : "cursor-not-allowed opacity-35",
                  shownDirect === v && "border-transparent bg-sky-500 font-semibold text-slate-950",
                  shownDirect != null && v < shownDirect && "bg-sky-500/15",
                )}
              >
                {v}
              </button>
            ))}
          </span>
          <p className="basis-full text-xs text-muted-foreground">{directNote}</p>
        </div>
        <div className="flex items-center gap-2.5 pt-2">
          <span className="text-[11px] font-bold uppercase tracking-widest text-violet-500">ou por categorias</span>
          <span className="h-px flex-1 bg-border" />
        </div>
        <p className="text-[12.5px] text-muted-foreground">{tasteLine}</p>
        {categories}
      </CardContent>
    </Card>
  )
}

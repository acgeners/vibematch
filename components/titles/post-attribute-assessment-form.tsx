"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRefresh } from "@/lib/use-refresh"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { SaveButton } from "@/components/ui/save-button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug } from "@/types/domain"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { submitPostReadingAttributes } from "@/server/actions/post-reading-attributes"
import { bandForScore, rubricSummary, rubricTitle } from "@/lib/criteria/justification"
import { cn } from "@/lib/utils"
import { ChevronDown, Sparkles } from "lucide-react"

export interface PostAttributeAssessmentFormProps {
  workId: string
  latestAiEvaluation: {
    evaluationId: string
    modelName: string
    promptVersion: string
    attributes: Partial<Record<CriterionSlug, number>>
  } | null
  existingAssessment: Partial<Record<CriterionSlug, number>> | null
  /** Modo controlado (embedded): valores vêm do parent. Quando presente junto de
   *  onChange, substitui o estado interno — usado pelo fluxo "Terminei de ler". */
  value?: Record<CriterionSlug, number>
  onChange?: (next: Record<CriterionSlug, number>) => void
  /** Esconde o botão "Salvar avaliação" (o parent salva via fluxo unificado). */
  hideOwnSave?: boolean
  /** Estado inicial do colapso (default aberto; o fluxo de gosto passa false). */
  defaultOpen?: boolean
}

function clamp(v: number): number {
  return Math.min(10, Math.max(0, Math.round(v * 10) / 10))
}

/**
 * Painel que explica a FAIXA da nota do atributo sob o cursor/foco — o mesmo papel da dica de
 * estrelas em "Como foi pra você?". Fica visualmente separado das linhas (trilho + moldura
 * violeta, e o atributo nomeado antes do texto) porque é um campo que MUDA conforme a linha ativa:
 * sem isso lê-se como legenda fixa do card. O violeta é exclusivo desta ligação painel↔linha.
 *
 * Faixa e rótulo vêm da rubrica canônica (`criteria.ranges` via `bandForScore`/`rubricTitle`), não
 * da justificativa da IA — ver `lib/criteria/justification.ts`.
 */
function BandReadout({ slug, score }: { slug: CriterionSlug | null; score: number }) {
  const info = slug ? CRITERIA_INFO[slug] : null
  const band = slug ? bandForScore(score) : null
  const title = slug && band ? rubricTitle(slug, band) : null
  const summary = slug && band ? rubricSummary(slug, band) : null
  const active = Boolean(info && band)

  return (
    <div
      aria-live="polite"
      className={cn(
        // `flex-wrap`: dentro do diálogo o card é estreito — a explicação cai pra segunda linha
        // em vez de ser cortada.
        "relative flex min-h-[42px] flex-wrap items-center gap-x-2.5 gap-y-1 overflow-hidden rounded-lg py-2 pl-3.5 pr-3 text-xs",
        active
          ? "bg-violet-500/10 ring-1 ring-inset ring-violet-500/35"
          : "ring-1 ring-inset ring-border/60",
      )}
    >
      {/* Trilho: `border-<cor>` é morta neste app (regra `*` em globals.css) — a cor vem de `bg`. */}
      <span
        aria-hidden
        className={cn("absolute inset-y-0 left-0 w-[3px]", active ? "bg-violet-500" : "bg-border")}
      />
      {active && info && band ? (
        <>
          <span className="flex min-w-0 items-center gap-1.5 font-semibold">
            <span className="text-sm leading-none" aria-hidden>
              {info.emoji}
            </span>
            <span className="truncate">{info.name}</span>
          </span>
          <span aria-hidden className="h-4 w-px shrink-0 bg-violet-500/30" />
          <span className="shrink-0 font-bold tabular-nums text-violet-600 dark:text-violet-300">
            {band}
          </span>
          {title && (
            <span className="shrink-0 font-semibold text-violet-600 dark:text-violet-300">
              {title}
            </span>
          )}
          {/* Duas rubricas passam de 130 caracteres (couple_dynamics 4-6, protagonist 7-8): sem o
              clamp o painel cresce e empurra a grade ao trocar de linha. */}
          {summary && <span className="line-clamp-2 min-w-0 text-muted-foreground">{summary}</span>}
        </>
      ) : (
        <span className="italic text-muted-foreground/70">
          Passe o mouse num atributo pra ver o que a faixa da nota significa.
        </span>
      )}
    </div>
  )
}

export function PostAttributeAssessmentForm({
  workId,
  latestAiEvaluation,
  existingAssessment,
  value,
  onChange,
  hideOwnSave = false,
  defaultOpen = true,
}: PostAttributeAssessmentFormProps) {
  const refresh = useRefresh()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(defaultOpen)
  const isControlled = value !== undefined && onChange !== undefined
  // Atributo cuja faixa está sendo lida no painel. Mouse e teclado são fontes separadas: o mouse
  // manda enquanto está sobre uma linha, e o foco segura a leitura de quem navega por Tab (sem
  // isso, tirar o mouse do card apagaria a explicação do campo que está sendo editado).
  const [hovered, setHovered] = useState<CriterionSlug | null>(null)
  const [focused, setFocused] = useState<CriterionSlug | null>(null)
  const activeSlug = hovered ?? focused

  // Só os atributos que a IA avaliou entram no questionário — sem nota da
  // IA não há o que comparar (e o backend ignoraria de qualquer jeito).
  const ratedSlugs = useMemo(
    () =>
      CRITERION_SLUGS.filter(
        (slug) => latestAiEvaluation?.attributes[slug as CriterionSlug] != null,
      ),
    [latestAiEvaluation],
  )

  const initialValues = useMemo(() => {
    const out = {} as Record<CriterionSlug, number>
    for (const slug of ratedSlugs) {
      const existing = existingAssessment?.[slug as CriterionSlug]
      const ia = latestAiEvaluation?.attributes[slug as CriterionSlug]
      out[slug as CriterionSlug] = existing ?? ia ?? 0
    }
    return out
  }, [ratedSlugs, existingAssessment, latestAiEvaluation])

  const [internalValues, setInternalValues] = useState<Record<CriterionSlug, number>>(initialValues)
  const values = isControlled ? (value as Record<CriterionSlug, number>) : internalValues

  // Ainda não há avaliação pós-leitura salva? Salvar é sempre significativo
  // (registra o passo, mesmo concordando com a IA). Com avaliação salva,
  // "Salvar" só habilita quando algum valor difere do que já está persistido
  // (= initialValues, que embute `existing ?? ia`).
  const hasSavedAssessment = useMemo(
    () => ratedSlugs.some((slug) => existingAssessment?.[slug as CriterionSlug] != null),
    [ratedSlugs, existingAssessment],
  )
  const dirty =
    !hasSavedAssessment ||
    ratedSlugs.some(
      (slug) => values[slug as CriterionSlug] !== initialValues[slug as CriterionSlug],
    )
  const writeValues = (next: Record<CriterionSlug, number>) => {
    if (isControlled) onChange!(next)
    else setInternalValues(next)
  }

  if (!latestAiEvaluation || ratedSlugs.length === 0) {
    return (
      <Card className="bg-card/50">
        <CardHeader>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <CardTitle className="text-base font-bold">Atributos da obra</CardTitle>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
        </CardHeader>
        {open && (
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Esta obra ainda não foi avaliada pela IA. Rode a avaliação primeiro pra poder
              calibrar como você viu os atributos depois de ler.
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href={`/ai-evaluation?work=${workId}`}>
                <Sparkles className="h-4 w-4" />
                Avaliar com IA
              </Link>
            </Button>
          </CardContent>
        )}
      </Card>
    )
  }

  const acceptAiValues = () => {
    const next = {} as Record<CriterionSlug, number>
    for (const slug of ratedSlugs) {
      next[slug as CriterionSlug] = latestAiEvaluation.attributes[slug as CriterionSlug] ?? 0
    }
    writeValues(next)
  }

  const save = () => {
    startTransition(async () => {
      const payload: Partial<Record<CriterionSlug, number>> = {}
      for (const slug of ratedSlugs) payload[slug as CriterionSlug] = values[slug as CriterionSlug]
      const result = await submitPostReadingAttributes(workId, payload)
      if (result.ok) {
        toast.success("Avaliação pós-leitura salva. Offset recalculado.")
        refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Card className="bg-card/50">
      <CardHeader className="space-y-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left"
        >
          <CardTitle className="text-base font-bold">Atributos da obra</CardTitle>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <p className="text-xs text-muted-foreground">
            Como você viu a obra <strong>depois de ler</strong>. A diferença pro que a IA avaliou
            ({latestAiEvaluation.modelName}/{latestAiEvaluation.promptVersion}) calibra as previsões.
          </p>
        )}
      </CardHeader>
      {open && (
      <CardContent className="space-y-3">
        <BandReadout slug={activeSlug} score={activeSlug ? values[activeSlug] ?? 0 : 0} />
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {ratedSlugs.map((slug) => {
            const info = CRITERIA_INFO[slug]
            const ia = latestAiEvaluation.attributes[slug as CriterionSlug] ?? 0
            const value = values[slug as CriterionSlug] ?? 0
            const diff = Number((value - ia).toFixed(1))
            // A nota da IA só aparece quando o usuário alterou o valor do atributo.
            const changed = value !== ia
            const isActive = activeSlug === slug
            // Faixa DERIVADA da nota vigente (nunca da prosa da IA) — troca sozinha ao digitar.
            const band = bandForScore(value)
            const bandTitle = rubricTitle(slug, band)
            return (
              <div
                key={slug}
                onMouseEnter={() => setHovered(slug as CriterionSlug)}
                onMouseLeave={() => setHovered((s) => (s === slug ? null : s))}
                className={cn(
                  "flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2 transition-colors",
                  isActive && "bg-violet-500/5 ring-1 ring-inset ring-violet-500/40",
                )}
              >
                {/* `flex-wrap`: quando nome + rótulo da faixa não cabem na largura da coluna, o
                    rótulo desce uma linha em vez de espremer o nome até "Dinâmica entre Prot…". */}
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-lg leading-none" aria-hidden>
                    {info.emoji}
                  </span>
                  <span className="truncate text-sm font-medium">{info.name}</span>
                  {bandTitle && (
                    // Só o RÓTULO da faixa: os dígitos ("4-6") ficam no painel de cima. Na linha
                    // eles roubavam ~35px do nome — que passava a truncar em "Dinâmica entre
                    // Prot…" — pra repetir o que o próprio campo de nota já mostra ao lado.
                    <span
                      className={cn(
                        "shrink-0 rounded-full bg-violet-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-violet-600 dark:text-violet-300",
                        isActive && "ring-1 ring-inset ring-violet-500/40",
                      )}
                      title={`Faixa ${band}`}
                    >
                      {bandTitle}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {changed && (
                    <span
                      className="text-[11px] text-muted-foreground tabular-nums"
                      title="Nota sugerida pela IA"
                    >
                      IA: {ia.toFixed(1)}
                      {diff !== 0 && (
                        <span className={diff > 0 ? "text-emerald-600" : "text-amber-600"}>
                          {" "}
                          ({diff > 0 ? "+" : ""}
                          {diff})
                        </span>
                      )}
                    </span>
                  )}
                  <Input
                    type="number"
                    min={0}
                    max={10}
                    step={0.5}
                    value={value}
                    onChange={(e) => {
                      const raw = e.target.value
                      const next = raw === "" ? ia : clamp(Number(raw))
                      if (Number.isFinite(next)) {
                        writeValues({ ...values, [slug as CriterionSlug]: next })
                      }
                    }}
                    onFocus={() => setFocused(slug as CriterionSlug)}
                    onBlur={() => setFocused((s) => (s === slug ? null : s))}
                    aria-label={info.name}
                    className="w-20 text-center font-mono tabular-nums pr-3"
                  />
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={acceptAiValues} disabled={isPending}>
            Aceitar valores da IA
          </Button>
          {!hideOwnSave && (
            <SaveButton
              type="button"
              size="sm"
              onClick={save}
              disabled={isPending || !dirty}
              disabledReason={!dirty ? "Nenhuma alteração para salvar" : undefined}
            >
              {isPending ? "Salvando…" : "Salvar avaliação"}
            </SaveButton>
          )}
        </div>
      </CardContent>
      )}
    </Card>
  )
}

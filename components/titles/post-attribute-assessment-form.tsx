"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug } from "@/types/domain"
import { CRITERIA_INFO } from "@/lib/constants/criteria"
import { submitPostReadingAttributes } from "@/server/actions/post-reading-attributes"
import { Sparkles } from "lucide-react"

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
}

function clamp(v: number): number {
  return Math.min(10, Math.max(0, Math.round(v * 10) / 10))
}

export function PostAttributeAssessmentForm({
  workId,
  latestAiEvaluation,
  existingAssessment,
  value,
  onChange,
  hideOwnSave = false,
}: PostAttributeAssessmentFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const isControlled = value !== undefined && onChange !== undefined

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
  const writeValues = (next: Record<CriterionSlug, number>) => {
    if (isControlled) onChange!(next)
    else setInternalValues(next)
  }

  if (!latestAiEvaluation || ratedSlugs.length === 0) {
    return (
      <Card className="bg-card/50">
        <CardHeader>
          <CardTitle className="text-base font-bold">Atributos da obra (pós-leitura)</CardTitle>
        </CardHeader>
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
        router.refresh()
      } else {
        toast.error(result.error)
      }
    })
  }

  return (
    <Card className="bg-card/50">
      <CardHeader className="space-y-1">
        <CardTitle className="text-base font-bold">Atributos da obra (pós-leitura)</CardTitle>
        <p className="text-xs text-muted-foreground">
          Como você viu a obra <strong>depois de ler</strong>. A diferença pro que a IA avaliou
          ({latestAiEvaluation.modelName}/{latestAiEvaluation.promptVersion}) calibra as previsões.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          {ratedSlugs.map((slug) => {
            const info = CRITERIA_INFO[slug]
            const ia = latestAiEvaluation.attributes[slug as CriterionSlug] ?? 0
            const value = values[slug as CriterionSlug] ?? 0
            const diff = Number((value - ia).toFixed(1))
            // A nota da IA só aparece quando o usuário alterou o valor do atributo.
            const changed = value !== ia
            return (
              <div key={slug} className="flex items-center gap-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="text-lg leading-none" aria-hidden>
                    {info.emoji}
                  </span>
                  <span className="truncate text-sm font-medium">{info.name}</span>
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
                    aria-label={info.name}
                    className="w-20 text-right font-mono tabular-nums"
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
            <Button type="button" size="sm" onClick={save} disabled={isPending}>
              {isPending ? "Salvando…" : "Salvar avaliação"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

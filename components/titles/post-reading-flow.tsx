"use client"

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { WorkStatusForm } from "./work-status-form"
import { PostAttributeAssessmentForm } from "./post-attribute-assessment-form"
import type { PostAttributeAssessmentFormProps } from "./post-attribute-assessment-form"
import type { WorkStatusValues } from "@/lib/validations/work.schema"
import { CRITERION_SLUGS } from "@/types/domain"
import type { PersonalStatus, CriterionSlug } from "@/types/domain"
import { submitPostReadingAttributes } from "@/server/actions/post-reading-attributes"

// Atributos pós-leitura aparecem quando a obra já tem leitura suficiente:
// status terminal (Completed/Dropped) OU mais de 20% lido.
const TERMINAL_STATUSES: PersonalStatus[] = ["Completed", "Dropped"]
const MIN_READ_PCT_FOR_POST_ATTR = 20

interface PostReadingFlowProps {
  workId: string
  totalChapters: number | null
  statusInitial: WorkStatusValues
  latestAiEvaluation: PostAttributeAssessmentFormProps["latestAiEvaluation"]
  existingAssessment: PostAttributeAssessmentFormProps["existingAssessment"]
}

/**
 * Fluxo único "Terminei de ler": funde o form de status com o questionário de
 * atributos pós-leitura. A visibilidade da seção de atributos é client-driven
 * (revela na hora que o status vira terminal, sem reload). Um único submit
 * orquestra as DUAS server actions em sequência — updateWorkStatus (status + 8
 * critérios de qualidade) e submitPostReadingAttributes (9 atributos) — mantendo
 * as duas persistências separadas (tabelas/semânticas distintas).
 */
export function PostReadingFlow({
  workId,
  totalChapters,
  statusInitial,
  latestAiEvaluation,
  existingAssessment,
}: PostReadingFlowProps) {
  const [liveStatus, setLiveStatus] = useState<WorkStatusValues["personal_status"]>(
    statusInitial.personal_status,
  )
  const [liveChaptersRead, setLiveChaptersRead] = useState<number | null>(
    statusInitial.chapters_read ?? null,
  )

  // Revela ao vivo conforme o usuário muda status/capítulos no form (sem reload):
  // status terminal OU % lido > 20%.
  const readPct =
    totalChapters != null && totalChapters > 0 && liveChaptersRead != null
      ? (liveChaptersRead / totalChapters) * 100
      : null
  const isVisible =
    TERMINAL_STATUSES.includes(liveStatus as PersonalStatus) ||
    (readPct != null && readPct > MIN_READ_PCT_FOR_POST_ATTR)

  // Atributos que a IA avaliou (sem nota da IA não há o que comparar/salvar).
  const ratedSlugs = useMemo(
    () =>
      CRITERION_SLUGS.filter(
        (slug) => latestAiEvaluation?.attributes[slug as CriterionSlug] != null,
      ),
    [latestAiEvaluation],
  )

  const initialAttrValues = useMemo(() => {
    const out = {} as Record<CriterionSlug, number>
    for (const slug of ratedSlugs) {
      const existing = existingAssessment?.[slug as CriterionSlug]
      const ia = latestAiEvaluation?.attributes[slug as CriterionSlug]
      out[slug as CriterionSlug] = existing ?? ia ?? 0
    }
    return out
  }, [ratedSlugs, existingAssessment, latestAiEvaluation])

  const [attrValues, setAttrValues] = useState<Record<CriterionSlug, number>>(initialAttrValues)

  const hasEval = latestAiEvaluation != null && ratedSlugs.length > 0
  const showAttributes = isVisible && hasEval
  const attrDirty = showAttributes && ratedSlugs.some(
    (slug) => attrValues[slug as CriterionSlug] !== initialAttrValues[slug as CriterionSlug],
  )

  const [formState, setFormState] = useState<{ saving: boolean; canSubmit: boolean }>({
    saving: false,
    canSubmit: false,
  })

  return (
    <div className="space-y-5">
      <WorkStatusForm
        workId={workId}
        totalChapters={totalChapters}
        initialValues={statusInitial}
        onStatusChange={setLiveStatus}
        onChaptersReadChange={setLiveChaptersRead}
        extraSave={
          showAttributes ? () => submitPostReadingAttributes(workId, attrValues) : undefined
        }
        extraDirty={attrDirty}
        showEvaluationCriteria={isVisible}
        formId="work-status-form"
        onStateChange={setFormState}
      />
      {isVisible && (
        <PostAttributeAssessmentForm
          workId={workId}
          latestAiEvaluation={latestAiEvaluation}
          existingAssessment={existingAssessment}
          value={hasEval ? attrValues : undefined}
          onChange={hasEval ? setAttrValues : undefined}
          hideOwnSave={hasEval}
        />
      )}
      {/* Botão Salvar no fim de tudo — submete o WorkStatusForm via form={formId}. */}
      <div className="flex justify-end border-t border-border/40 pt-4">
        <Button type="submit" form="work-status-form" disabled={!formState.canSubmit}>
          {formState.saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </div>
  )
}

"use client"

import { useMemo, useState } from "react"
import { WorkStatusForm } from "./work-status-form"
import { PostAttributeAssessmentForm } from "./post-attribute-assessment-form"
import type { PostAttributeAssessmentFormProps } from "./post-attribute-assessment-form"
import type { WorkStatusValues } from "@/lib/validations/work.schema"
import { CRITERION_SLUGS } from "@/types/domain"
import type { PersonalStatus, CriterionSlug } from "@/types/domain"
import { submitPostReadingAttributes } from "@/server/actions/post-reading-attributes"

// Status terminais em que faz sentido avaliar os atributos pós-leitura
// (a obra já foi lida/abandonada). Mantém em sincronia com a regra do server.
const POST_ATTR_STATUSES: PersonalStatus[] = ["Completed", "Dropped", "On-hold", "Stalled", "Hiatus"]

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
  const isTerminal = POST_ATTR_STATUSES.includes(liveStatus as PersonalStatus)

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
  const showAttributes = isTerminal && hasEval
  const attrDirty = showAttributes && ratedSlugs.some(
    (slug) => attrValues[slug as CriterionSlug] !== initialAttrValues[slug as CriterionSlug],
  )

  return (
    <div className="space-y-5">
      <WorkStatusForm
        workId={workId}
        totalChapters={totalChapters}
        initialValues={statusInitial}
        onStatusChange={setLiveStatus}
        extraSave={
          showAttributes ? () => submitPostReadingAttributes(workId, attrValues) : undefined
        }
        extraDirty={attrDirty}
        submitLabel={showAttributes ? "Terminei de ler" : undefined}
      />
      {isTerminal && (
        <PostAttributeAssessmentForm
          workId={workId}
          latestAiEvaluation={latestAiEvaluation}
          existingAssessment={existingAssessment}
          value={hasEval ? attrValues : undefined}
          onChange={hasEval ? setAttrValues : undefined}
          hideOwnSave={hasEval}
        />
      )}
    </div>
  )
}

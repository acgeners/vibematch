"use client"

import { useState } from "react"
import { WorkStatusForm } from "./work-status-form"
import { PostAttributeAssessmentForm } from "./post-attribute-assessment-form"
import type { PostAttributeAssessmentFormProps } from "./post-attribute-assessment-form"
import type { WorkStatusValues } from "@/lib/validations/work.schema"
import type { PersonalStatus } from "@/types/domain"

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
 * Une o form de status com o questionário de atributos pós-leitura num fluxo
 * "Terminei de ler". A visibilidade da seção de atributos é **client-driven**:
 * revela na hora em que o status selecionado vira terminal, sem depender do
 * recompute server-side via router.refresh() (que não surfaçava o form — só
 * aparecia após reload manual).
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
  const showAttributes = POST_ATTR_STATUSES.includes(liveStatus as PersonalStatus)

  return (
    <div className="space-y-5">
      <WorkStatusForm
        workId={workId}
        totalChapters={totalChapters}
        initialValues={statusInitial}
        onStatusChange={setLiveStatus}
      />
      {showAttributes && (
        <PostAttributeAssessmentForm
          workId={workId}
          latestAiEvaluation={latestAiEvaluation}
          existingAssessment={existingAssessment}
        />
      )}
    </div>
  )
}

"use client"

import { createContext, useContext, useState } from "react"
import type { ReactNode } from "react"

import { StatusEditDialog } from "@/components/titles/status-edit-dialog"
import type { PostAttributeAssessmentFormProps } from "@/components/titles/post-attribute-assessment-form"
import type { WorkStatusValues } from "@/lib/validations/work.schema"
import type { TasteCriterion, TasteScoreKey } from "@/server/queries/pilot-taste"

/**
 * Dono ÚNICO do diálogo "Meu Status" na página da obra. Antes cada chamador (botão "Status" do
 * topo, e agora os atalhos da faixa) tinha sua própria instância — este contexto substitui as
 * várias por uma só, aberta de dois jeitos:
 *  - `requestOpen()` sem argumento: os valores atuais da obra (botão "Status").
 *  - `requestOpen(overrides)`: os valores atuais MESCLADOS com o que acabou de mudar no atalho
 *    (status/capítulos), pra o diálogo abrir já refletindo o clique que disparou o gate, sem
 *    esperar o round-trip do servidor.
 */
interface WorkStatusGateContextValue {
  requestOpen: (overrides?: Partial<WorkStatusValues>) => void
}

const WorkStatusGateContext = createContext<WorkStatusGateContextValue | null>(null)

export function useWorkStatusGate(): WorkStatusGateContextValue {
  const ctx = useContext(WorkStatusGateContext)
  if (!ctx) {
    throw new Error("useWorkStatusGate: chamado fora de um WorkStatusGateProvider")
  }
  return ctx
}

export interface WorkStatusGateProviderProps {
  workId: string
  totalChapters: number | null
  /** `works.publication_status_id` — o aviso "obra ainda em publicação" depende dele. */
  publicationStatusId?: number | null
  /** true ⇒ curador: o aviso oferece corrigir a publicação. */
  canEditCatalog?: boolean
  initialValues: WorkStatusValues
  latestAiEvaluation: PostAttributeAssessmentFormProps["latestAiEvaluation"]
  existingAssessment: PostAttributeAssessmentFormProps["existingAssessment"]
  tasteCriteria?: TasteCriterion[]
  tasteScores?: Record<TasteScoreKey, number | null>
  children: ReactNode
}

export function WorkStatusGateProvider({
  workId,
  totalChapters,
  publicationStatusId = null,
  canEditCatalog = false,
  initialValues,
  latestAiEvaluation,
  existingAssessment,
  tasteCriteria,
  tasteScores,
  children,
}: WorkStatusGateProviderProps) {
  const [open, setOpen] = useState(false)
  const [overrides, setOverrides] = useState<Partial<WorkStatusValues> | null>(null)

  const requestOpen = (next?: Partial<WorkStatusValues>) => {
    setOverrides(next ?? null)
    setOpen(true)
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setOverrides(null)
  }

  const values = overrides ? { ...initialValues, ...overrides } : initialValues

  return (
    <WorkStatusGateContext.Provider value={{ requestOpen }}>
      {children}
      <StatusEditDialog
        open={open}
        onOpenChange={handleOpenChange}
        workId={workId}
        totalChapters={totalChapters}
        publicationStatusId={publicationStatusId}
        canEditCatalog={canEditCatalog}
        initialValues={values}
        latestAiEvaluation={latestAiEvaluation}
        existingAssessment={existingAssessment}
        tasteCriteria={tasteCriteria}
        tasteScores={tasteScores}
      />
    </WorkStatusGateContext.Provider>
  )
}

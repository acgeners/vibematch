"use client"

import { useMemo, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { WorkStatusForm } from "./work-status-form"
import { PostAttributeAssessmentForm } from "./post-attribute-assessment-form"
import type { PostAttributeAssessmentFormProps } from "./post-attribute-assessment-form"
import type { WorkStatusValues } from "@/lib/validations/work.schema"
import { CRITERION_SLUGS } from "@/types/domain"
import type { CriterionSlug } from "@/types/domain"
import { submitPostReadingAttributes } from "@/server/actions/post-reading-attributes"
import { PostTasteAssessment } from "@/components/pilot/post-taste-assessment"
import type { TasteCriterion, TasteScoreKey } from "@/server/queries/pilot-taste"
import { isFullyReadPersonalStatus } from "@/lib/constants/status-lookups"
import { canRateReadingState, chaptersNeededForRating, MIN_READ_PCT_FOR_RATING } from "@/lib/reading-gate"
import { DEFAULT_POST_READING_WEIGHTS } from "@/lib/constants/post-reading-criteria"
import type { PostReadingScoreField } from "@/lib/constants/post-reading-criteria"
import { ClearRatingButton } from "./clear-rating-button"

/** Os 8 critérios craft, derivados da tabela de pesos — não relistados à mão. */
const CRAFT_FIELDS = Object.keys(DEFAULT_POST_READING_WEIGHTS) as PostReadingScoreField[]

// Craft (os 8 critérios de execução + o badge "Nota Pessoal Calculada") saiu de vista: a nota
// de gosto calculada dos 6 eixos o substitui na tela. NÃO é remoção — o dado craft continua
// salvo e o `user_score` (rótulo do modelo) segue computado dele por baixo; só a UI some. Vira
// `true` de novo se um dia a avaliação craft voltar a ser preenchida manualmente.
const CRAFT_EVALUATION_VISIBLE = false

interface PostReadingFlowProps {
  workId: string
  totalChapters: number | null
  /** `works.publication_status_id` — alimenta o aviso de coerência do WorkStatusForm. */
  publicationStatusId?: number | null
  /** true ⇒ curador: o aviso oferece corrigir a publicação (dado do catálogo). */
  canEditCatalog?: boolean
  statusInitial: WorkStatusValues
  latestAiEvaluation: PostAttributeAssessmentFormProps["latestAiEvaluation"]
  existingAssessment: PostAttributeAssessmentFormProps["existingAssessment"]
  /** Critérios de gosto (criteria eval_type='Gosto') + notas já dadas à obra.
   *  Opcionais: quando ausentes (ex.: dialog de status rápido), o card de gosto
   *  não é renderizado. */
  tasteCriteria?: TasteCriterion[]
  tasteScores?: Record<TasteScoreKey, number | null>
  /** Id do `<form>` do status (default "work-status-form"). Use um id distinto
   *  quando houver outra instância montada ao mesmo tempo (ex.: aba + dialog). */
  formId?: string
  /** Chamado após salvar com sucesso (ex.: fechar o dialog). */
  onSaved?: () => void
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
  publicationStatusId = null,
  canEditCatalog = false,
  statusInitial,
  latestAiEvaluation,
  existingAssessment,
  tasteCriteria = [],
  tasteScores = {} as Record<TasteScoreKey, number | null>,
  formId = "work-status-form",
  onSaved,
}: PostReadingFlowProps) {
  const [liveStatus, setLiveStatus] = useState<WorkStatusValues["personal_status"]>(
    statusInitial.personal_status,
  )
  const [liveChaptersRead, setLiveChaptersRead] = useState<number | null>(
    statusInitial.chapters_read ?? null,
  )

  // Revela ao vivo conforme o usuário muda status/capítulos no form (sem reload). A REGRA
  // (status terminal OU > 20% lido) mora em `lib/reading-gate.ts` — é a mesma que as server
  // actions aplicam na escrita. Antes ela era um const local aqui, e por isso valia só na tela.
  const readingState = {
    personalStatus: liveStatus,
    chaptersRead: liveChaptersRead,
    totalChapters,
  }
  const isVisible = canRateReadingState(readingState)

  // Nota que já existe numa obra que NÃO passa mais no gate (avaliei e depois voltei o status
  // pra "On-hold"/"Untracked", ou nunca registrei os capítulos). A nota é PRESERVADA — é rótulo
  // de treino do Ridge e apagá-la por um clique de status custa caro —, mas a inconsistência
  // aparece: sem isto ela some da tela junto com a seção e vira dado invisível.
  const orphanScore = !isVisible ? (statusInitial.user_score ?? null) : null
  const chaptersNeeded = chaptersNeededForRating(readingState)

  // O que o diálogo de "Remover minha nota" vai listar como perda. Vem das props (o servidor já
  // mandou tudo) — sem round-trip extra e sem mais um endpoint público só pra contar.
  const craftFilled = CRAFT_FIELDS.filter((f) => statusInitial[f] != null).length
  const tasteFilled = Object.values(tasteScores).filter((v) => v != null).length

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
        publicationStatusId={publicationStatusId}
        canEditCatalog={canEditCatalog}
        initialValues={statusInitial}
        onStatusChange={setLiveStatus}
        onChaptersReadChange={setLiveChaptersRead}
        extraSave={
          showAttributes ? () => submitPostReadingAttributes(workId, attrValues) : undefined
        }
        extraDirty={attrDirty}
        showEvaluationCriteria={CRAFT_EVALUATION_VISIBLE}
        criteriaDefaultOpen={false}
        formId={formId}
        onSaved={onSaved}
        onStateChange={setFormState}
      />
      {orphanScore != null && (
        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-sm text-muted-foreground ring-1 ring-amber-500/30">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            Esta obra tem nota pessoal{" "}
            <span className="font-medium text-foreground">{orphanScore.toFixed(1)}</span>, mas o
            estado de leitura não a sustenta:{" "}
            {liveChaptersRead == null || liveChaptersRead === 0
              ? "nenhum capítulo lido registrado"
              : `${liveChaptersRead} de ${totalChapters ?? "?"} capítulos`}
            {" "}em <span className="font-medium text-foreground">{liveStatus}</span>. A nota foi
            preservada (ela treina a Nota Prevista), mas só volta a ser editável com{" "}
            {chaptersNeeded != null
              ? <>mais <span className="font-medium text-foreground">{chaptersNeeded}</span> capítulo(s) lidos</>
              : `mais de ${MIN_READ_PCT_FOR_RATING}% lido`}{" "}
            ou status de leitura encerrada. Se você leu e só não registrou, corrija os capítulos
            acima; se a nota não deveria existir, use{" "}
            <span className="font-medium text-foreground">Remover minha nota</span> no fim da página.
          </span>
        </div>
      )}
      {isVisible && tasteCriteria.length > 0 && (
        <PostTasteAssessment
          workId={workId}
          criteria={tasteCriteria}
          initialScores={tasteScores}
          endingApplicable={isFullyReadPersonalStatus(liveStatus)}
        />
      )}
      {isVisible && (
        <PostAttributeAssessmentForm
          workId={workId}
          latestAiEvaluation={latestAiEvaluation}
          existingAssessment={existingAssessment}
          value={hasEval ? attrValues : undefined}
          onChange={hasEval ? setAttrValues : undefined}
          hideOwnSave={hasEval}
          defaultOpen={true}
        />
      )}
      {/* Botão Salvar no fim de tudo — submete o WorkStatusForm via form={formId}. "Remover minha
          nota" fica na MESMA barra e independe do gate: ela renderiza com a seção escondida
          também, que é justamente o caso em que a nota é inconsistente e você quer apagá-la. */}
      <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-4">
        <ClearRatingButton
          workId={workId}
          userScore={statusInitial.user_score ?? null}
          craftFilled={craftFilled}
          tasteFilled={tasteFilled}
        />
        <Button type="submit" form={formId} disabled={!formState.canSubmit} className="ml-auto">
          {formState.saving ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </div>
  )
}

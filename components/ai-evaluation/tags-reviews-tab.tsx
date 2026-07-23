"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { AlertTriangle, SquarePen } from "lucide-react"
import { titleToSlug } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { AiEvaluationFilters } from "@/components/ai-evaluation/ai-evaluation-filters"
import { ReviewRowAction, ReviewBatchAction } from "@/components/ai-evaluation/review-actions"
import { TagRowAction, TagBatchAction } from "@/components/ai-evaluation/tag-actions"
import { WorkQueueCard, type WorkQueueState } from "@/components/ai-evaluation/queue/work-queue-card"
import { WorkQueueGrid } from "@/components/ai-evaluation/queue/work-queue-grid"
import { QueueToolbar, QueueSortSelect } from "@/components/ai-evaluation/queue/queue-toolbar"
import { useWorkSelection } from "@/components/ai-evaluation/queue/use-work-selection"
import { useToggleRead } from "@/components/ai-evaluation/queue/use-toggle-read"
import type { UiReadiness } from "@/lib/orchestration/ui-readiness"

/** Obra da aba unificada — união dos universos "sem reviews" e "sem tags". */
export interface TagsReviewsWork {
  id: string
  title: string
  coverUrl: string | null
  publicationStatusId: number | null
  personalStatusId: number | null
  interest: string | null
  canonicalPresent: boolean
  /** Prontidão da inferência de tags (checkInferTags → UI); gate/selo no card. */
  readiness?: UiReadiness | null
  inGolden: boolean
  expectedScore: number | null
  /** Entrou por falta de reviews (faixa de reviews úteis). */
  reviewGap: boolean
  /** Entrou por falta de tags (faixa de tags). */
  tagGap: boolean
  tagCount: number
  reviewCount: number
  /** Chip 🔞 (works.is_adult) e badge "Real" (works_owner.user_score) — anexados na page. */
  isAdult?: boolean
  userScore?: number | null
}

/**
 * Aba "Tags & Reviews" — fusão de "Sem reviews" + "Sem tags". Lista a UNIÃO das
 * obras com poucas reviews e/ou poucas tags; cada card mostra 🏷/💬 e oferece só
 * a ação relevante ao gap (Buscar reviews se falta review, Inferir tags se falta
 * tag) + Editar obra. Sort na toolbar; ações em lote por eixo.
 */
export function TagsReviewsTab({
  works,
  readIds = [],
  activePubStatuses,
  activePersonalStatuses,
  activeInterest,
  activePredictionQualities = [],
  minReviews,
  maxReviews,
  minTags,
  maxTags,
}: {
  works: TagsReviewsWork[]
  readIds?: string[]
  activePubStatuses: string[]
  activePersonalStatuses: string[]
  activeInterest: string[]
  activePredictionQualities?: string[]
  minReviews: number
  maxReviews: number
  minTags: number
  maxTags: number
}) {
  const [sortField, setSortField] = useState<"title" | "expected" | "tags" | "reviews">("title")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")
  const sortedWorks = useMemo(() => {
    const arr = [...works]
    const mult = sortDir === "asc" ? 1 : -1
    if (sortField === "title") return arr.sort((a, b) => a.title.localeCompare(b.title, "pt-BR") * mult)
    const key = (w: TagsReviewsWork) =>
      sortField === "expected" ? w.expectedScore : sortField === "tags" ? w.tagCount : w.reviewCount
    return arr.sort((a, b) => {
      const ka = key(a), kb = key(b)
      if (ka == null && kb == null) return 0
      if (ka == null) return 1
      if (kb == null) return -1
      return (ka - kb) * mult
    })
  }, [works, sortField, sortDir])

  const ids = useMemo(() => sortedWorks.map((w) => w.id), [sortedWorks])
  const selection = useWorkSelection(ids)
  const { isRead, unmark } = useToggleRead("tags_reviews", readIds)

  // Ações em lote por EIXO — só as obras selecionadas com o gap correspondente.
  const byId = useMemo(() => new Map(works.map((w) => [w.id, w])), [works])
  const selectedReviewIds = selection.selectedIds.filter((id) => byId.get(id)?.reviewGap)
  const selectedTagIds = selection.selectedIds.filter((id) => byId.get(id)?.tagGap)

  const reviewGapCount = works.filter((w) => w.reviewGap).length
  const tagGapCount = works.filter((w) => w.tagGap).length

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span>
          Poucas <strong>tags</strong> ou <strong>reviews</strong> = menos sinal p/ recomendação e previsão.{" "}
          <strong>Buscar reviews</strong> / <strong>Inferir tags</strong> (individual ou em fila) enriquecem via IA
          (<strong>consome tokens</strong>); ou edite a obra manualmente.
        </span>
      </p>

      <AiEvaluationFilters
        activeFilters={[]}
        activePubStatuses={activePubStatuses}
        activePersonalStatuses={activePersonalStatuses}
        activeSynopsisQualities={activeInterest}
        activePredictionQualities={activePredictionQualities}
        showEvalState={false}
        showDataFilters
        dataFiltersPrimary
        activeMinTags={minTags}
        activeMaxTags={maxTags}
        activeMinReviews={minReviews}
        activeMaxReviews={maxReviews}
      />

      <p className="text-xs text-muted-foreground">
        {works.length} obra(s) · <span className="text-amber-600 dark:text-amber-400">{reviewGapCount}</span> sem
        reviews · <span className="text-amber-600 dark:text-amber-400">{tagGapCount}</span> sem tags.
      </p>

      <QueueToolbar
        count={selection.count}
        allSelected={selection.allSelected}
        onToggleAll={selection.toggleAll}
        onClear={selection.clear}
        selectedIds={selection.selectedIds}
        sort={
          <QueueSortSelect
            value={sortField}
            onChange={(v) => setSortField(v as typeof sortField)}
            options={[
              { value: "title", label: "Título" },
              { value: "expected", label: "Nota prevista" },
              { value: "reviews", label: "Nº reviews" },
              { value: "tags", label: "Nº tags" },
            ]}
            dir={sortDir}
            onToggleDir={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          />
        }
        selectedActions={
          <>
            {selectedReviewIds.length > 0 && <ReviewBatchAction workIds={selectedReviewIds} />}
            {selectedTagIds.length > 0 && <TagBatchAction workIds={selectedTagIds} />}
          </>
        }
      />

      {works.length === 0 ? (
        <p className="rounded-lg border border-border/60 p-6 text-center text-sm text-muted-foreground">
          Nenhuma obra precisando de tags ou reviews com os filtros atuais. 🎉
        </p>
      ) : (
        <WorkQueueGrid>
          {sortedWorks.map((w) => {
            const slug = titleToSlug(w.title)

            // Chip só p/ estados não óbvios; os gaps aparecem no 🏷/💬 (âmbar) do card.
            // Não exibe o marcador de teste/golden pilot nesta aba.
            // Gate REAL da inferência (sinopse ≥80 chars, canônica OU bruta) —
            // não só presença da canônica (o chip antigo mentia pros dois lados).
            const state: WorkQueueState | null =
              w.readiness && !w.readiness.ready ? { label: "sinopse curta", tone: "rose" } : null

            // "Editar obra" na coluna esquerda (abaixo das infos): botão outline
            // compacto — claramente clicável, mas secundário às ações de IA.
            const details = (
              <Button variant="outline" size="xs" className="w-fit gap-1.5" asChild>
                <Link href={`/titles/${slug}/edit`}>
                  <SquarePen className="h-3.5 w-3.5" />
                  Editar obra
                </Link>
              </Button>
            )

            // Trilho direito: as duas ações de IA (enriquecimento) sempre disponíveis.
            const actions = (
              <>
                <ReviewRowAction workId={w.id} />
                <TagRowAction workId={w.id} readiness={w.readiness} />
              </>
            )

            return (
              <WorkQueueCard
                key={w.id}
                workId={w.id}
                title={w.title}
                coverUrl={w.coverUrl}
                expectedScore={w.expectedScore}
                isAdult={w.isAdult}
                userScore={w.userScore}
                publicationStatusId={w.publicationStatusId}
                personalStatusId={w.personalStatusId}
                interest={w.interest}
                tagCount={w.tagCount}
                reviewCount={w.reviewCount}
                state={state}
                details={details}
                showDetailsDirectly
                actions={actions}
                wideActions
                selectable
                selected={selection.isSelected(w.id)}
                onToggleSelect={() => selection.toggle(w.id)}
                read={isRead(w.id)}
                onToggleRead={() => unmark(w.id)}
              />
            )
          })}
        </WorkQueueGrid>
      )}
    </div>
  )
}

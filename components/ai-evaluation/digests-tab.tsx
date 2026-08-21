"use client"

import { useMemo, useState } from "react"
import { MessageSquareOff } from "lucide-react"
import { WorkQueueCard } from "@/components/ai-evaluation/queue/work-queue-card"
import { WorkQueueGrid } from "@/components/ai-evaluation/queue/work-queue-grid"
import { QueueToolbar, QueueSortSelect } from "@/components/ai-evaluation/queue/queue-toolbar"
import { useWorkSelection } from "@/components/ai-evaluation/queue/use-work-selection"
import { DigestRowAction, DigestBatchAction } from "@/components/ai-evaluation/digest-actions"
import { MIN_USEFUL_REVIEWS_FOR_DIGEST } from "@/lib/reviews/digest-gate"
import type { DigestQueueWork } from "@/server/queries/review-digest-queue"

/**
 * Aba "Digests" — a fila do digest estruturado que morava como painel cego em
 * `/curation/settings?g=ia`.
 *
 * O painel antigo sabia dizer só "125 pendentes" e processava 10 que ninguém
 * escolhia nem via. Aqui cada obra mostra quantas reviews ÚTEIS tem, que é o
 * insumo do artefato — dá pra ver o que vale rodar e o que precisa de reviews
 * antes.
 *
 * 🔴 **As obras sem reviews suficientes ficam na lista, não somem.** Elas são a
 * resposta a "por que essa obra nunca sai da fila?", e some-las devolveria a
 * pergunta que a aba existe pra responder. Ficam em `blocked`: sem checkbox, sem
 * botão, com o chip dizendo o que falta.
 */
export function DigestsTab({
  works,
  eligibleCount,
  blockedCount,
  doneCount,
}: {
  works: DigestQueueWork[]
  eligibleCount: number
  blockedCount: number
  doneCount: number
}) {
  const [sortField, setSortField] = useState<"reviews" | "title">("reviews")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")

  const sorted = useMemo(() => {
    const arr = [...works]
    const mult = sortDir === "asc" ? 1 : -1
    if (sortField === "title") {
      return arr.sort((a, b) => a.title.localeCompare(b.title, "pt-BR") * mult)
    }
    return arr.sort(
      (a, b) => (a.usefulReviews - b.usefulReviews) * mult || a.title.localeCompare(b.title, "pt-BR"),
    )
  }, [works, sortField, sortDir])

  // 🔴 Só as ELEGÍVEIS entram na seleção. Se as bloqueadas entrassem, "selecionar
  // todas" montaria um lote que o servidor recusa obra por obra — o popup cobraria
  // por 10 e o resultado viria "8 sem reviews suficientes".
  const selectableIds = useMemo(
    () => sorted.filter((w) => w.eligible).map((w) => w.id),
    [sorted],
  )
  const selection = useWorkSelection(selectableIds)

  const totalComReviews = doneCount + eligibleCount

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        O <strong className="text-foreground">digest estruturado</strong> (consenso, divergências,
        traços, alertas) é o sinal qualitativo que o consultor IA consome — Recomendar, Veredito,
        Deep Dive e Chat. Sonnet, ~3¢ por obra, custo único: só re-roda quando a versão do digest
        muda ou chegam reviews suficientes pra mudar o resultado.
      </p>

      <p className="text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">{eligibleCount}</span> pronta(s) pra rodar ·{" "}
        <span className="text-amber-600 dark:text-amber-400">{blockedCount}</span> sem reviews
        suficientes ·{" "}
        <span className="font-semibold text-foreground">
          {doneCount}/{totalComReviews}
        </span>{" "}
        já com digest na versão atual.
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
              { value: "reviews", label: "Nº reviews" },
              { value: "title", label: "Título" },
            ]}
            dir={sortDir}
            onToggleDir={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
          />
        }
        selectedActions={<DigestBatchAction workIds={selection.selectedIds} />}
      />

      {works.length === 0 ? (
        <p className="rounded-lg border border-border/60 p-6 text-center text-sm text-muted-foreground">
          Todo o catálogo com reviews já tem digest na versão atual. 🎉
        </p>
      ) : (
        <WorkQueueGrid>
          {sorted.map((w) => (
            <WorkQueueCard
              key={w.id}
              workId={w.id}
              title={w.title}
              coverUrl={w.coverUrls[0] ?? null}
              isAdult={w.isAdult}
              publicationStatusId={w.publicationStatusId}
              reviewCount={w.usefulReviews}
              tagCount={w.tagCount}
              state={
                w.eligible
                  ? {
                      // "sky" = nunca rodou / está na fila, pela régua de cores de
                      // estado: falta uma ação sua. Versão velha é "stale" (âmbar):
                      // existe, mas os inputs mudaram.
                      label: w.pending === "absent" ? "Sem digest" : "Versão antiga",
                      tone: w.pending === "absent" ? "sky" : "amber",
                    }
                  : {
                      label: `Precisa de ${MIN_USEFUL_REVIEWS_FOR_DIGEST} reviews`,
                      tone: "slate",
                    }
              }
              selectable={w.eligible}
              selected={selection.isSelected(w.id)}
              onToggleSelect={() => selection.toggle(w.id)}
              actions={
                w.eligible ? (
                  <DigestRowAction workId={w.id} />
                ) : (
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MessageSquareOff className="h-3.5 w-3.5" />
                    {w.usefulReviews === 0
                      ? "sem reviews úteis"
                      : `${w.usefulReviews} review(s) útil(eis)`}
                  </span>
                )
              }
            />
          ))}
        </WorkQueueGrid>
      )}
    </div>
  )
}

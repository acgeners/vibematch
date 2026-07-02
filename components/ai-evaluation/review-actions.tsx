"use client"

import { Sparkles } from "lucide-react"
import { TaskButton } from "./task-button"
import {
  acquireReviewsForWork,
  acquireReviewsForWorks,
  type AcquireReviewsResult,
  type AcquireReviewsBatchResult,
} from "@/server/actions/ai-eval-maintenance"

const BATCH_CAP = 8

/** Botão por obra: busca reviews externas + gera o digest. */
export function ReviewRowAction({ workId }: { workId: string }) {
  return (
    <TaskButton
      taskId={`acquire-reviews:${workId}`}
      kind="acquire-reviews"
      label="Buscar reviews"
      busyLabel="Buscando…"
      variant="default"
      icon={<Sparkles className="h-3.5 w-3.5" />}
      run={() => acquireReviewsForWork(workId)}
      formatDone={(r) => {
        const x = r as AcquireReviewsResult
        return {
          ok: x.ok,
          message: x.ok ? `${x.reviews} review(s) · digest: ${x.digest}` : x.message ?? "Falhou",
        }
      }}
    />
  )
}

/** Botão de fila: processa as obras listadas (teto interno) — reviews + digest. */
export function ReviewBatchAction({ workIds }: { workIds: string[] }) {
  const n = Math.min(workIds.length, BATCH_CAP)
  return (
    <TaskButton
      taskId="acquire-reviews-batch"
      kind="acquire-reviews"
      label={`Buscar reviews em fila (${n})`}
      busyLabel="Buscando fila…"
      variant="default"
      icon={<Sparkles className="h-3.5 w-3.5" />}
      run={() => acquireReviewsForWorks(workIds)}
      disabled={workIds.length === 0}
      formatDone={(r) => {
        const x = r as AcquireReviewsBatchResult
        return {
          ok: true,
          message:
            `${x.processed} obra(s): ${x.reviews} review(s), ${x.digested} digest(s)` +
            (x.failed ? `, ${x.failed} falha(s)` : "") +
            (x.capped ? ` — limitado a ${BATCH_CAP}, rode de novo` : ""),
        }
      }}
    />
  )
}

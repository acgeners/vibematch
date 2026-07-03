"use client"

import { Sparkles } from "lucide-react"
import { TaskButton } from "./task-button"
import {
  inferTagsForWork,
  inferTagsForWorks,
  type InferTagsResult,
  type InferTagsBatchResult,
} from "@/server/actions/ai-eval-maintenance"

const BATCH_CAP = 25

/** Botão por obra: infere tags (Haiku) da sinopse + reviews. Props opcionais
 *  permitem reusar num peso mais leve (ex.: "Re-inferir" ghost no rodapé da obra). */
export function TagRowAction({
  workId,
  variant = "default",
  label = "Inferir tags",
  busyLabel = "Inferindo…",
  size = "sm",
  className,
}: {
  workId: string
  variant?: "default" | "outline" | "secondary" | "ghost"
  label?: string
  busyLabel?: string
  size?: "sm" | "default"
  className?: string
}) {
  return (
    <TaskButton
      taskId={`infer-tags:${workId}`}
      kind="infer-tags"
      label={label}
      busyLabel={busyLabel}
      variant={variant}
      size={size}
      className={className}
      icon={<Sparkles className="h-3.5 w-3.5" />}
      run={() => inferTagsForWork(workId)}
      formatDone={(r) => {
        const x = r as InferTagsResult
        return { ok: x.ok, message: x.ok ? `${x.added} tag(s) inferida(s)` : x.message ?? "Falhou" }
      }}
    />
  )
}

/** Botão de fila: infere tags das obras listadas (teto interno). */
export function TagBatchAction({ workIds }: { workIds: string[] }) {
  const n = Math.min(workIds.length, BATCH_CAP)
  return (
    <TaskButton
      taskId="infer-tags-batch"
      kind="infer-tags"
      label={`Inferir tags em fila (${n})`}
      busyLabel="Inferindo fila…"
      variant="default"
      icon={<Sparkles className="h-3.5 w-3.5" />}
      run={() => inferTagsForWorks(workIds)}
      disabled={workIds.length === 0}
      formatDone={(r) => {
        const x = r as InferTagsBatchResult
        return {
          ok: true,
          message:
            `${x.processed} obra(s): ${x.added} tag(s)` +
            (x.failed ? `, ${x.failed} falha(s)` : "") +
            (x.capped ? ` — limitado a ${BATCH_CAP}, rode de novo` : ""),
        }
      }}
    />
  )
}

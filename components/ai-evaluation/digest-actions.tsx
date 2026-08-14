"use client"

import { Layers } from "lucide-react"
import { TaskButton } from "./task-button"
import { generateWorkReviewDigest, type GenerateDigestResult } from "@/server/actions/review-digest"
import {
  generateDigestsForWorks,
  type DigestBatchProgress,
} from "@/server/actions/review-digest-batch"
import { DIGEST_BATCH_MAX } from "@/lib/reviews/digest-gate"

/**
 * Botão por obra: gera o digest estruturado (Sonnet, ~3¢).
 *
 * ⚠️ O `cost` faz o popup bloqueante aparecer antes de gastar — mesma régua do
 * botão da página da obra. Sem ele, um clique na fila viraria gasto direto.
 */
export function DigestRowAction({ workId }: { workId: string }) {
  return (
    <TaskButton
      taskId={`digest:${workId}`}
      kind="digest"
      label="Gerar digest"
      busyLabel="Gerando…"
      variant="default"
      icon={<Layers className="h-3.5 w-3.5" />}
      cost={{ action: "review_digest", title: "Gerar o digest desta obra?" }}
      run={() => generateWorkReviewDigest(workId)}
      formatDone={(r) => {
        const x = r as GenerateDigestResult
        return { ok: x.ok, message: x.ok ? "Digest gerado." : (x.message ?? "Falhou") }
      }}
    />
  )
}

/**
 * Botão de fila: gera o digest das obras selecionadas (teto de 10 por clique).
 *
 * ⚠️ **`scale` é o que o lote de fato vai processar**, não o tamanho da seleção:
 * a estimativa do popup precisa bater com o teto que a action aplica, senão o
 * modal promete 40 obras e o servidor roda 10 — um número que mente pra mais é o
 * pior lado numa confirmação de gasto.
 */
export function DigestBatchAction({ workIds }: { workIds: string[] }) {
  const n = Math.min(workIds.length, DIGEST_BATCH_MAX)
  return (
    <TaskButton
      taskId="digest-batch"
      kind="digest"
      label={`Gerar digests (${n})`}
      busyLabel="Gerando fila…"
      variant="default"
      icon={<Layers className="h-3.5 w-3.5" />}
      disabled={workIds.length === 0}
      cost={{
        action: "review_digest",
        scale: n,
        title: `Gerar digest de ${n} obra(s)?`,
      }}
      run={() => generateDigestsForWorks(workIds)}
      formatDone={(r) => {
        const res = r as { data?: DigestBatchProgress; error?: string }
        if (res.error) return { ok: false, message: res.error }
        const x = res.data
        if (!x) return { ok: false, message: "Sem resposta do servidor." }
        return {
          ok: x.failed === 0,
          message:
            `${x.generated} digest(s) gerado(s)` +
            (x.skipped ? `, ${x.skipped} já em dia` : "") +
            (x.blocked ? `, ${x.blocked} sem reviews suficientes` : "") +
            (x.failed ? `, ${x.failed} falha(s)` : "") +
            (workIds.length > DIGEST_BATCH_MAX
              ? ` — limitado a ${DIGEST_BATCH_MAX}, rode de novo`
              : ""),
        }
      }}
    />
  )
}

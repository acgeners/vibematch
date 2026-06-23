/**
 * Montagem da LINHA de `work_external_reviews_manual` a partir do input do formulário
 * (Plano 3 Fase B2.2I/J/M). SERVER-SIDE: usa `node:crypto` (via `computeNormalizedTextHash`)
 * — separado do schema (client-safe) para não puxar `node:crypto` ao bundle do client.
 *
 * Valida com o boundary Zod e ANEXA os campos calculados no servidor:
 *  - `normalized_text_hash` pela normalização canônica (a MESMA da dedup do corpus);
 *  - `created_by` só com sessão admin validada (default `null` — não inventar autoria).
 * O hash NUNCA é confiado do client. Puro/testável (não escreve no banco). `workId` é
 * argumento separado, validado pela rota/action.
 */

import { externalReviewInputSchema, type ExternalReviewRow } from "@/lib/validations/external-review.schema"
import { computeNormalizedTextHash } from "@/lib/synopsis-interest/canonical-review-corpus"

export function prepareExternalReviewRow(
  workId: string,
  rawInput: unknown,
  opts: { createdBy?: string | null } = {},
): { data: ExternalReviewRow | null; error: string | null } {
  if (!workId) return { data: null, error: "work_id obrigatório" }
  const parsed = externalReviewInputSchema.safeParse(rawInput)
  if (!parsed.success) return { data: null, error: parsed.error.issues.map((i) => i.message).join("; ") }
  const i = parsed.data
  return {
    data: {
      work_id: workId,
      source: i.source,
      text: i.text,
      normalized_text_hash: computeNormalizedTextHash(i.text),
      created_by: opts.createdBy ?? null,
    },
    error: null,
  }
}

import { z } from "zod"
import { PLATFORMS } from "@/types/domain"
import type { ExternalSourceId } from "@/lib/external/types"

/**
 * Boundary Zod para REVIEWS EXTERNAS inseridas manualmente (Plano 3, text-only — B2.2N).
 * Espelha a tabela `work_external_reviews_manual` após a migration 114 (só `source` + `text`;
 * os metadados opcionais source_url/external_review_id/reviewer_name/language/published_at
 * foram DROPADOS — eram inócuos ao experimento e ficavam vazios).
 *
 * SÓ `source` + `text`. NÃO aceita nota/opinião pessoal nem qualquer campo extra — `strictObject`
 * rejeita `user_rating`, `note`, `interest_label`, `score`, `id`, `normalizedTextHash`, `createdBy`,
 * timestamps, etc. O SERVIDOR calcula `normalized_text_hash` e `created_by` — nunca vêm do form.
 *
 * Client-safe (só `zod`): importável pelo formulário (RHF + zodResolver). O hash (`node:crypto`)
 * e a montagem da linha ficam em `external-review-row.ts` (server) — ver `prepareExternalReviewRow`.
 */

/**
 * Fontes externas aceitas para review manual. Deriva de `PLATFORMS` (gerado de `source`
 * pelo `sync-constants`) — assim o dropdown nunca defasa do banco. O `satisfies` garante
 * em compile-time que toda plataforma é um `ExternalSourceId` válido.
 */
export const EXTERNAL_REVIEW_SOURCES = PLATFORMS satisfies readonly ExternalSourceId[]

export type ExternalReviewSource = (typeof EXTERNAL_REVIEW_SOURCES)[number]

export const externalReviewInputSchema = z.strictObject({
  source: z.enum(EXTERNAL_REVIEW_SOURCES),
  text: z.string().trim().min(1, "texto não pode ser vazio"),
})

export type ExternalReviewInput = z.infer<typeof externalReviewInputSchema>

/** Linha pronta para `work_external_reviews_manual` — campos server-side calculados em `external-review-row.ts`. */
export interface ExternalReviewRow {
  work_id: string
  source: ExternalReviewSource
  text: string
  normalized_text_hash: string
  created_by: string | null
}

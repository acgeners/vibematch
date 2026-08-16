"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  assertLocalExternalReviewEditorAllowed,
  LocalEditorBlockedError,
} from "@/lib/synopsis-interest/local-external-review-gate"
import {
  ownershipError,
  type ExternalManualReviewActionResult,
} from "@/lib/validations/external-review-action-result"
import { ensureAdmin } from "@/server/queries/current-user"

/**
 * Server Action do EDITOR LOCAL para reviews BUSCADAS de fontes externas (`work_reviews`).
 *
 * Diferente das reviews manuais (`work_external_reviews_manual`, duráveis), o pool em
 * `work_reviews` é APAGADO e reescrito por inteiro a cada Avaliação IA/refetch
 * (ver `lib/external/persist-reviews.ts`). Logo, a exclusão é EFÊMERA: vale até a próxima
 * avaliação. Útil para remover reviews-lixo antes de uma avaliação pontual.
 *
 * Mesmo gate local/dev do editor manual (em produção, sem auth, o canal não fica editável).
 * Reusa o tipo de resultado discriminado e o helper de posse das reviews manuais.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const idSchema = z.string().regex(UUID_RE, "id inválido (UUID)")

export type { ExternalManualReviewActionResult } from "@/lib/validations/external-review-action-result"

async function runGate(): Promise<ExternalManualReviewActionResult | null> {
  try {
    await assertLocalExternalReviewEditorAllowed()
    return null
  } catch (e) {
    if (e instanceof LocalEditorBlockedError) return { ok: false, error: "blocked", message: e.message }
    return { ok: false, error: "blocked", message: "Editor de reviews indisponível." }
  }
}

export async function deleteFetchedReview(
  reviewId: string,
  workId: string,
): Promise<ExternalManualReviewActionResult> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: "blocked", message: gate.error }

  const blocked = await runGate()
  if (blocked) return blocked

  if (!idSchema.safeParse(workId).success) return { ok: false, error: "invalid_id", message: "Obra inválida (UUID)." }
  if (!idSchema.safeParse(reviewId).success) return { ok: false, error: "invalid_id", message: "Review inválida (UUID)." }

  const sb = createAdminClient()
  // Confirma que a review existe E pertence à obra (não excluir registro de outra obra).
  const { data: existing } = await sb
    .from("work_reviews")
    .select("id, work_id")
    .eq("id", reviewId)
    .maybeSingle()
  const owned = ownershipError(existing as { work_id: string } | null, workId)
  if (owned) return owned

  const { error } = await sb.from("work_reviews").delete().eq("id", reviewId).eq("work_id", workId)
  if (error) return { ok: false, error: "db", message: error.message }
  revalidatePath(`/catalog/${workId}`)
  return { ok: true, id: reviewId }
}

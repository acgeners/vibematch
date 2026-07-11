"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { after } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { ensureReviewDigest, ensureReviewSummary } from "@/lib/orchestration/integrations/reviews"
import { prepareExternalReviewRow } from "@/lib/validations/external-review-row"
import {
  assertLocalExternalReviewEditorAllowed,
  LocalEditorBlockedError,
} from "@/lib/synopsis-interest/local-external-review-gate"
import {
  mapUniqueConflict,
  ownershipError,
  type ExternalManualReviewActionResult,
} from "@/lib/validations/external-review-action-result"
import { ensureAdmin } from "@/server/queries/current-user"

/**
 * Server Actions do EDITOR LOCAL de reviews externas manuais (Plano 3 B2.2M §4).
 *
 * Escrevem em `public.work_external_reviews_manual` (canal externo COM proveniência) —
 * NUNCA em `work_manual_reviews` (opinião/nota pessoal). Cada ação:
 *  1. executa o gate local (`assertLocalExternalReviewEditorAllowed`) ANTES de tocar no banco;
 *  2. valida `workId`/`reviewId` (UUID) com Zod;
 *  3. valida o formulário com o schema central via `prepareExternalReviewRow`
 *     (hash calculado no servidor; `created_by` = null — sem inventar autoria);
 *  4. confirma que a obra existe; update/delete confirmam que o registro pertence à obra;
 *  5. tratam conflito dos DOIS índices únicos (external_id / hash);
 *  6. retornam resultado DISCRIMINADO e tipado + `revalidatePath`.
 *
 * A service-role key existe SÓ aqui (server). O componente é client e nunca a recebe.
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
    return { ok: false, error: "blocked", message: "Editor de reviews externas indisponível." }
  }
}

async function confirmWorkExists(
  sb: ReturnType<typeof createAdminClient>,
  workId: string,
): Promise<boolean> {
  const { data } = await sb.from("works").select("id").eq("id", workId).maybeSingle()
  return Boolean(data?.id)
}

/**
 * Lacuna #1 (fecha o ciclo do 2A): a review manual externa É parte do corpus
 * CANÔNICO do RESUMO e do DIGEST. Toda edição deliberada (create/update/delete)
 * muda o corpus ⇒ regenera os DOIS. Roda pós-resposta via `after()`; não bloqueia
 * o retorno. Cada `ensure*` lê o corpus por dentro (não passamos `reviews`).
 *  - Resumo (Haiku): gate por content-hash — a mudança no texto já dispara (sem force).
 *  - Digest (Sonnet): gate por contagem — precisa de `force` (add/edit/delete de 1
 *    review não cruza o limiar de materialidade); dedup por contentHash evita run redundante.
 * Custo ~$0,02–0,07/edição (Haiku + Sonnet, allowPaid pré-autorizado).
 */
function regenReviewArtifactsAfterManualEdit(workId: string): void {
  after(async () => {
    const sb = createAdminClient()
    const [s, d] = await Promise.allSettled([
      ensureReviewSummary(workId, { supabase: sb, allowPaid: true }),
      ensureReviewDigest(workId, { supabase: sb, allowPaid: true, force: true }),
    ])
    if (s.status === "rejected") console.error("[external-manual-reviews] ensureReviewSummary rejeitou:", s.reason)
    if (d.status === "rejected") console.error("[external-manual-reviews] ensureReviewDigest rejeitou:", d.reason)
  })
}

export async function createExternalManualReview(
  workId: string,
  rawInput: unknown,
): Promise<ExternalManualReviewActionResult> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: "blocked", message: gate.error }

  const blocked = await runGate()
  if (blocked) return blocked

  const idCheck = idSchema.safeParse(workId)
  if (!idCheck.success) return { ok: false, error: "invalid_id", message: "Obra inválida (UUID)." }

  const { data: row, error: prepErr } = prepareExternalReviewRow(workId, rawInput)
  if (prepErr || !row) return { ok: false, error: "validation", message: prepErr ?? "input inválido" }

  const sb = createAdminClient()
  if (!(await confirmWorkExists(sb, workId))) return { ok: false, error: "work_not_found", message: "Obra não encontrada." }

  const { data, error } = await sb.from("work_external_reviews_manual").insert(row).select("id").single()
  if (error) {
    const conflict = mapUniqueConflict(error)
    if (conflict) return conflict
    return { ok: false, error: "db", message: error.message }
  }
  regenReviewArtifactsAfterManualEdit(workId)
  revalidatePath(`/titles/${workId}`)
  return { ok: true, id: data.id as string }
}

export async function updateExternalManualReview(
  reviewId: string,
  workId: string,
  rawInput: unknown,
): Promise<ExternalManualReviewActionResult> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, error: "blocked", message: gate.error }

  const blocked = await runGate()
  if (blocked) return blocked

  if (!idSchema.safeParse(workId).success) return { ok: false, error: "invalid_id", message: "Obra inválida (UUID)." }
  if (!idSchema.safeParse(reviewId).success) return { ok: false, error: "invalid_id", message: "Review inválida (UUID)." }

  const { data: row, error: prepErr } = prepareExternalReviewRow(workId, rawInput)
  if (prepErr || !row) return { ok: false, error: "validation", message: prepErr ?? "input inválido" }

  const sb = createAdminClient()
  // Busca o registro ANTES e confirma que pertence à obra (não alterar registro de outra obra).
  const { data: existing } = await sb
    .from("work_external_reviews_manual")
    .select("id, work_id")
    .eq("id", reviewId)
    .maybeSingle()
  const owned = ownershipError(existing as { work_id: string } | null, workId)
  if (owned) return owned

  const { error } = await sb
    .from("work_external_reviews_manual")
    .update({
      source: row.source,
      text: row.text,
      normalized_text_hash: row.normalized_text_hash,
      // created_by NÃO é alterado (mantém null — sem inventar autoria).
    })
    .eq("id", reviewId)
    .eq("work_id", workId)
  if (error) {
    const conflict = mapUniqueConflict(error)
    if (conflict) return conflict
    return { ok: false, error: "db", message: error.message }
  }
  regenReviewArtifactsAfterManualEdit(workId)
  revalidatePath(`/titles/${workId}`)
  return { ok: true, id: reviewId }
}

export async function deleteExternalManualReview(
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
  const { data: existing } = await sb
    .from("work_external_reviews_manual")
    .select("id, work_id")
    .eq("id", reviewId)
    .maybeSingle()
  const owned = ownershipError(existing as { work_id: string } | null, workId)
  if (owned) return owned

  const { error } = await sb.from("work_external_reviews_manual").delete().eq("id", reviewId).eq("work_id", workId)
  if (error) return { ok: false, error: "db", message: error.message }
  regenReviewArtifactsAfterManualEdit(workId)
  revalidatePath(`/titles/${workId}`)
  return { ok: true, id: reviewId }
}

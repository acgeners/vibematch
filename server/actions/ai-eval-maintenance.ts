"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { acquireAndPersistWorkReviews } from "@/lib/external/acquire-reviews"
import { inferAndPersistTagsForWork } from "@/lib/tags/auto-infer"
import { generateWorkReviewDigest } from "@/server/actions/review-digest"
import { markRecalcPending } from "@/server/actions/recalc-queue"

// Tetos por execução (re-rode pra processar mais). Reviews é caro/lento
// (scraping + digest Sonnet por obra) → teto menor; tags é Haiku rápido.
const REVIEWS_BATCH_CAP = 8
const TAGS_BATCH_CAP = 25

export interface AcquireReviewsResult {
  ok: boolean
  reviews: number
  /** status do digest: generated | fresh | no_reviews | processing | ... */
  digest: string
  message?: string
}

/**
 * Busca + persiste reviews externas de UMA obra (scraping pelos IDs aceitos) e
 * garante o digest estruturado. No-op de reviews quando a obra não tem IDs
 * aceitos. Clique deliberado ⇒ custo pré-autorizado (digest Sonnet ~$0,02–0,05).
 */
export async function acquireReviewsForWork(workId: string): Promise<AcquireReviewsResult> {
  if (!workId) return { ok: false, reviews: 0, digest: "error", message: "Obra inválida." }
  const reviews = await acquireAndPersistWorkReviews(workId)
  // O save já dispara o digest (fire-and-forget); chamamos aqui pra AGUARDAR e
  // reportar o status — o gate por conteúdo/versão evita regerar (sem custo duplo).
  const d = await generateWorkReviewDigest(workId)
  revalidatePath("/ai-evaluation")
  revalidateTag("ai-eval-tab-counts", "max")
  return { ok: true, reviews, digest: d.status, message: `${reviews} review(s); digest: ${d.status}` }
}

export interface AcquireReviewsBatchResult {
  processed: number
  reviews: number
  digested: number
  failed: number
  capped: boolean
}

/** Lote de aquisição de reviews + digest (sequencial, teto REVIEWS_BATCH_CAP). */
export async function acquireReviewsForWorks(workIds: string[]): Promise<AcquireReviewsBatchResult> {
  const ids = (workIds ?? []).slice(0, REVIEWS_BATCH_CAP)
  let processed = 0
  let reviews = 0
  let digested = 0
  let failed = 0
  for (const id of ids) {
    try {
      reviews += await acquireAndPersistWorkReviews(id)
      const d = await generateWorkReviewDigest(id)
      if (d.status === "generated") digested += 1
      processed += 1
    } catch (err) {
      failed += 1
      console.error("[acquireReviewsForWorks] falha em", id, err instanceof Error ? err.message : err)
    }
  }
  revalidatePath("/ai-evaluation")
  revalidateTag("ai-eval-tab-counts", "max")
  return { processed, reviews, digested, failed, capped: (workIds ?? []).length > REVIEWS_BATCH_CAP }
}

export interface InferTagsResult {
  ok: boolean
  added: number
  message?: string
}

/**
 * Infere + grava tags (Haiku, alta confiança) de UMA obra a partir da sinopse +
 * contexto de reviews (digest/resumo) quando houver. Marca recalc pendente se
 * adicionou — as features de tag entram nas notas no próximo recalc.
 */
export async function inferTagsForWork(workId: string): Promise<InferTagsResult> {
  if (!workId) return { ok: false, added: 0, message: "Obra inválida." }
  const added = await inferAndPersistTagsForWork(workId)
  if (added > 0) await markRecalcPending("infer_tags_ai_eval")
  revalidatePath("/ai-evaluation")
  revalidateTag("ai-eval-tab-counts", "max")
  return { ok: true, added, message: `${added} tag(s) inferida(s)` }
}

export interface InferTagsBatchResult {
  processed: number
  added: number
  failed: number
  capped: boolean
}

/** Lote de inferência de tags (sequencial, teto TAGS_BATCH_CAP). */
export async function inferTagsForWorks(workIds: string[]): Promise<InferTagsBatchResult> {
  const ids = (workIds ?? []).slice(0, TAGS_BATCH_CAP)
  let processed = 0
  let added = 0
  let failed = 0
  for (const id of ids) {
    try {
      added += await inferAndPersistTagsForWork(id)
      processed += 1
    } catch (err) {
      failed += 1
      console.error("[inferTagsForWorks] falha em", id, err instanceof Error ? err.message : err)
    }
  }
  if (added > 0) await markRecalcPending("infer_tags_ai_eval_batch")
  revalidatePath("/ai-evaluation")
  revalidateTag("ai-eval-tab-counts", "max")
  return { processed, added, failed, capped: (workIds ?? []).length > TAGS_BATCH_CAP }
}

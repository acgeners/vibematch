"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { acquireAndPersistWorkReviews } from "@/lib/external/acquire-reviews"
import { inferAndPersistTagsForWork } from "@/lib/tags/auto-infer"
import { generateWorkReviewDigest } from "@/server/actions/review-digest"
import { markRecalcPending } from "@/server/recalc/queue"
import { ensureAdmin } from "@/server/queries/current-user"

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
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, reviews: 0, digest: "error", message: gate.error }
  if (!workId) return { ok: false, reviews: 0, digest: "error", message: "Obra inválida." }
  const reviews = await acquireAndPersistWorkReviews(workId)
  // O save já dispara o digest (fire-and-forget); chamamos aqui pra AGUARDAR e
  // reportar o status — o gate por conteúdo/versão evita regerar (sem custo duplo).
  const d = await generateWorkReviewDigest(workId)
  revalidatePath("/curation/works")
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
  const gate = await ensureAdmin()
  if (!gate.ok) throw new Error(gate.error)
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
  revalidatePath("/curation/works")
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
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, added: 0, message: gate.error }
  if (!workId) return { ok: false, added: 0, message: "Obra inválida." }
  const added = await inferAndPersistTagsForWork(workId)
  if (added > 0) await markRecalcPending("infer_tags_ai_eval")
  revalidatePath("/curation/works")
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
  const gate = await ensureAdmin()
  if (!gate.ok) throw new Error(gate.error)
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
  revalidatePath("/curation/works")
  revalidateTag("ai-eval-tab-counts", "max")
  return { processed, added, failed, capped: (workIds ?? []).length > TAGS_BATCH_CAP }
}

export interface RegenerateSynopsisResult {
  ok: boolean
  /** done | fresh | no_synopsis | failed — espelha ConsolidateForWorkResult. */
  status: string
  message?: string
}

/**
 * REGERA a sinopse canônica de UMA obra, furando o gate de
 * `canonical_synopsis_inputs_hash`.
 *
 * Por que precisa de `force`: o gate compara só as sinopses de ENTRADA, não a
 * versão do prompt nem o modelo. Sem furá-lo, uma obra cujas fontes não mudaram
 * fica presa no texto gerado pelo prompt antigo para sempre — e a chamada
 * devolveria `fresh` sem escrever nada, sem erro. É exatamente o caso deste
 * botão: o usuário está pedindo justamente porque as fontes NÃO mudaram.
 *
 * Clique deliberado ⇒ custo pré-autorizado (~$0,008 no Sonnet, medido).
 */
export async function regenerateCanonicalSynopsis(workId: string): Promise<RegenerateSynopsisResult> {
  const gate = await ensureAdmin()
  if (!gate.ok) return { ok: false, status: "failed", message: gate.error }
  if (!workId) return { ok: false, status: "failed", message: "Obra inválida." }

  const { consolidateSynopsisForWork } = await import("@/lib/ai-recommendation/consolidate-for-work")
  const r = await consolidateSynopsisForWork(workId, { force: true })

  revalidatePath(`/catalog/${workId}`)
  revalidatePath("/curation/works")
  revalidatePath("/my-ai-scores")

  const messages: Record<string, string> = {
    done: "Sinopse canônica regerada",
    fresh: "Sem mudança (não deveria acontecer com force)",
    no_synopsis: "A obra não tem sinopse de fonte para consolidar",
    failed: "Falhou",
  }
  return {
    ok: r.status === "done",
    status: r.status,
    message: r.status === "failed" ? `Falhou: ${r.error}` : messages[r.status],
  }
}

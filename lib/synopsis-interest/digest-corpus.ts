/**
 * Plano 3 — LOADER ÚNICO do corpus canônico de reviews para o digest (Fase B2.2M §5–§8).
 * SERVER-ONLY (lê o banco). É a ÚNICA fonte de verdade do corpus: preflight, snapshot
 * base FUTURO (base-2r1), planner e executor consomem ESTE módulo — nenhum deles deve
 * ter consulta independente às tabelas de review.
 *
 * Duas fontes EXTERNAS com proveniência, lidas por loaders SEPARADOS:
 *   - `readScrapedExternalReviews`        → public.work_reviews            (origin=external_scraped)
 *   - `readManuallyEnteredExternalReviews`→ public.work_external_reviews_manual (origin=manual_external)
 * `readCanonicalReviewCorpus` combina os dois via `buildCanonicalReviewCorpus`.
 *
 * PROIBIÇÃO ABSOLUTA (guard arquitetural + teste estático): este módulo NUNCA importa nem
 * consulta `work_manual_reviews` (opinião/nota PESSOAL da usuária), nem `saveManualReviews`,
 * nem o card de impressões pessoais. Essas entradas vazariam preferência/sentimento no corpus.
 *
 * O limite de 40 (`CANONICAL_REVIEW_CAP`) e o filtro de utilidade (`isUsefulReviewText`, ≥40
 * chars) são aplicados DENTRO de `buildCanonicalReviewCorpus`: a assinatura cobre as reviews
 * úteis deduplicadas (todas); o `sample` é o recorte de ≤40 entregue ao modelo.
 */

import "server-only"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  buildCanonicalReviewCorpus,
  workReviewsToCanonicalInput,
  CANONICAL_REVIEW_CAP,
  type CanonicalReviewInput,
  type CanonicalReview,
} from "@/lib/synopsis-interest/canonical-review-corpus"

type AdminClient = ReturnType<typeof createAdminClient>

/** Linha bruta de `work_external_reviews_manual` (text-only após migration 114). */
export interface ManualExternalReviewRow {
  id: string
  source: string | null
  text: string | null
}

/** PURO: `work_external_reviews_manual` → entrada canônica (origin=manual_external). */
export function manualExternalRowsToCanonicalInput(rows: ManualExternalReviewRow[]): CanonicalReviewInput[] {
  return rows.map((r) => ({
    reviewId: r.id,
    origin: "manual_external" as const,
    source: (r.source ?? "desconhecida").trim().toLowerCase(),
    externalId: null,
    sourceUrl: null,
    text: r.text ?? "",
  }))
}

/** Reviews EXTERNAS SCRAPADAS (origin=external_scraped). Lê SOMENTE `public.work_reviews`. */
export async function readScrapedExternalReviews(
  workId: string,
  sb: AdminClient = createAdminClient(),
): Promise<CanonicalReviewInput[]> {
  if (!workId) return []
  const { data, error } = await sb.from("work_reviews").select("id, source, text").eq("work_id", workId)
  if (error) throw new Error(`readScrapedExternalReviews: ${error.message}`)
  return workReviewsToCanonicalInput((data ?? []) as Array<{ id: string; source: string | null; text: string | null }>)
}

/** Reviews EXTERNAS inseridas à MÃO (origin=manual_external). Lê SOMENTE `public.work_external_reviews_manual`. */
export async function readManuallyEnteredExternalReviews(
  workId: string,
  sb: AdminClient = createAdminClient(),
): Promise<CanonicalReviewInput[]> {
  if (!workId) return []
  const { data, error } = await sb
    .from("work_external_reviews_manual")
    .select("id, source, text")
    .eq("work_id", workId)
  if (error) throw new Error(`readManuallyEnteredExternalReviews: ${error.message}`)
  return manualExternalRowsToCanonicalInput((data ?? []) as ManualExternalReviewRow[])
}

export interface CanonicalReviewCorpusResult {
  /** Úteis, deduplicadas, ordenadas (TODAS). */
  reviews: CanonicalReview[]
  /** Amostra entregue ao modelo (≤ `CANONICAL_REVIEW_CAP`). */
  sample: CanonicalReview[]
  usefulReviewCount: number
  /** Assinatura reprodutível do corpus (= `corpusSignature`). */
  reviewCorpusSignature: string
  /** Assinatura da seleção de ≤40 (só policy + textos normalizados selecionados). */
  digestSelectionSignature: string
  noReviewsAvailable: boolean
  state: "no_reviews_available" | "available"
  /** Escala de custo do digest = min(úteis, 40). */
  scale: number
}

/**
 * Corpus CANÔNICO de uma obra: combina as DUAS fontes externas e aplica utilidade/dedup/
 * teto/ordenação determinística. É o que preflight, snapshot futuro, planner e executor
 * devem usar (mesma fonte ⇒ planner e executor enxergam EXATAMENTE o mesmo corpus).
 */
export async function readCanonicalReviewCorpus(
  workId: string,
  sb: AdminClient = createAdminClient(),
  opts: { cap?: number } = {},
): Promise<CanonicalReviewCorpusResult> {
  const [scraped, manual] = await Promise.all([
    readScrapedExternalReviews(workId, sb),
    readManuallyEnteredExternalReviews(workId, sb),
  ])
  const corpus = buildCanonicalReviewCorpus([...scraped, ...manual], { cap: opts.cap ?? CANONICAL_REVIEW_CAP })
  return {
    reviews: corpus.reviews,
    sample: corpus.sample,
    usefulReviewCount: corpus.usefulCount,
    reviewCorpusSignature: corpus.corpusSignature,
    digestSelectionSignature: corpus.digestSelectionSignature,
    noReviewsAvailable: corpus.state === "no_reviews_available",
    state: corpus.state,
    scale: Math.min(corpus.usefulCount, opts.cap ?? CANONICAL_REVIEW_CAP),
  }
}

/**
 * Item do planner derivado SÓ do corpus canônico (mesma fonte do executor). Mantém o
 * planner/preflight do golden FUTURO (base-2r1) sem consulta própria às tabelas.
 */
export interface CanonicalDigestPlanItem {
  workId: string
  reviewCorpusSignature: string
  digestSelectionSignature: string
  usefulReviewCount: number
  scale: number
  noReviewsAvailable: boolean
}

export async function buildCanonicalDigestPlanItem(
  workId: string,
  sb: AdminClient = createAdminClient(),
): Promise<CanonicalDigestPlanItem> {
  const c = await readCanonicalReviewCorpus(workId, sb)
  return {
    workId,
    reviewCorpusSignature: c.reviewCorpusSignature,
    digestSelectionSignature: c.digestSelectionSignature,
    usefulReviewCount: c.usefulReviewCount,
    scale: c.scale,
    noReviewsAvailable: c.noReviewsAvailable,
  }
}

/**
 * Token de fonte UNIFORME para o digest do experimento (B2.2N, text-only). O `source` real
 * é metadado administrativo e NÃO entra no prompt: todas as reviews entram com a MESMA fonte,
 * então o rótulo `[source #N]` do summarizer fica uniforme (sem sinal de fonte) e a
 * estratificação por fonte colapsa em 1 grupo (seleção independe da fonte). Só o TEXTO é sinal.
 */
export const EXPERIMENT_DIGEST_SOURCE = "review"

/**
 * Entrada de digest (`{text, source, userRating}`) derivada do corpus canônico — para
 * INJETAR como gateway de `ensureReviewDigest` no executor do golden FUTURO (base-2r1).
 * `userRating` é SEMPRE null (corpus externo não tem nota pessoal — leakage-proof) e `source`
 * é o token UNIFORME `EXPERIMENT_DIGEST_SOURCE` (text-only: a fonte real não entra no prompt
 * nem na seleção). O recorte de ≤40 já vem do `sample`. NÃO é ligado ao auto-digest de produção
 * (`persist-reviews.ts`), que segue inalterado (não muda a amostragem existente).
 */
export async function readCanonicalDigestInput(
  workId: string,
  sb: AdminClient = createAdminClient(),
): Promise<Array<{ text: string; source: string; userRating: null }>> {
  const c = await readCanonicalReviewCorpus(workId, sb)
  return c.sample.map((r) => ({ text: r.text, source: EXPERIMENT_DIGEST_SOURCE, userRating: null }))
}

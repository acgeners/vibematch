/**
 * Plano 3 — Boundary CANÔNICO de reviews para o corpus de digest (Fase B2.2H). PURO: sem
 * banco, sem rede, sem `server-only`, sem LLM.
 *
 * LEAKAGE-PROOF POR CONSTRUÇÃO: o tipo de entrada (`CanonicalReviewInput`) só admite reviews
 * EXTERNAS com PROVENIÊNCIA (origin/source/url) — **não existe** campo de nota pessoal,
 * opinião, personal_status, reading_status, label, score, ranking ou prediction. Portanto o
 * STORE PESSOAL da usuária (opinião/nota, SEM proveniência) **não** pode alimentar este corpus;
 * só um canal externo com proveniência (Opção C — ver PLANO). Este módulo NÃO importa nem lê
 * o store pessoal (guard arquitetural com teste estático).
 *
 * Reusa a regra central `isUsefulReviewText`. Determinístico e independente da ordem de entrada.
 */

import { createHash } from "node:crypto"
import { isUsefulReviewText } from "@/lib/reviews/useful-review"

/** Mesmo teto do pipeline atual (REVIEW_SAMPLE_CAP). */
export const CANONICAL_REVIEW_CAP = 40

/**
 * VERSÃO EXPLÍCITA da política do corpus (Plano 3 B2.2N). Entra na `corpusSignature` (e, via
 * planner/executor, na `planSignature` e na chave de cache do digest) ⇒ trocar a política
 * INVALIDA plano e cache de execuções anteriores, mesmo com texto idêntico.
 *
 *  - `v0` (IMPLÍCITA, pré-B2.2N): assinatura = texto normalizado + `origin:source`; fonte
 *    entrava no prompt e na estratificação. APOSENTADA.
 *  - `text-only-v1` (ATUAL): SÓ o texto normalizado é sinal; `source`/URL/autor/idioma/data
 *    são metadado administrativo (fora da assinatura, do prompt e da seleção das 40).
 */
export const REVIEW_CORPUS_POLICY_VERSION = "text-only-v1"

export type ReviewOrigin = "external_scraped" | "manual_external"

/** Entrada — SÓ reviews externas com proveniência. Sem campos de opinião/nota pessoal. */
export interface CanonicalReviewInput {
  reviewId: string
  origin: ReviewOrigin
  /** proveniência obrigatória: plataforma/fonte. */
  source: string
  externalId?: string | null
  sourceUrl?: string | null
  /** texto da review externa (apresentado ao modelo sem alteração). */
  text: string
}

export interface ReviewProvenance {
  origin: ReviewOrigin
  source: string
  externalId: string | null
  sourceUrl: string | null
  reviewId: string
}

export interface CanonicalReview {
  /** texto EXIBIDO (não normalizado/alterado). */
  text: string
  origin: ReviewOrigin
  source: string
  externalId: string | null
  sourceUrl: string | null
  reviewId: string
  /** TODAS as fontes que continham este texto (dedup entre/dentro de tabelas). */
  provenance: ReviewProvenance[]
}

export interface CanonicalReviewCorpus {
  /** úteis, deduplicadas, ordenadas (TODAS). */
  reviews: CanonicalReview[]
  /** amostra para o modelo (primeiras `cap`). */
  sample: CanonicalReview[]
  usefulCount: number
  /** Assinatura do corpus inteiro (todas as úteis dedup). */
  corpusSignature: string
  /** Assinatura da SELEÇÃO de ≤cap que iria ao digest — só `policy` + textos normalizados
   * selecionados, na ordem determinística. NÃO depende de id/source/origin/URL/data/ordem-DB. */
  digestSelectionSignature: string
  state: "no_reviews_available" | "available"
}

function sha256(o: unknown): string {
  return createHash("sha256").update(JSON.stringify(o)).digest("hex")
}

/**
 * Normalização canônica do texto de review — SÓ para dedup/hash/ordenação, **não**
 * altera o texto apresentado ao modelo. Ordem: `trim` → Unicode NFC → case folding
 * (lowercase) → colapso de TODO espaço em branco (incl. quebras de linha) em 1 espaço.
 * É a MESMA regra usada para o `normalized_text_hash` no servidor/migration 112.
 */
export function normalizeReviewText(text: string): string {
  return (text ?? "").trim().normalize("NFC").toLowerCase().replace(/\s+/g, " ")
}

/** SHA-256 do texto normalizado. Calculado NO SERVIDOR (nunca confiado do client). */
export function computeNormalizedTextHash(text: string): string {
  return createHash("sha256").update(normalizeReviewText(text)).digest("hex")
}

/**
 * Comparador CANÔNICO único do caminho experimental (B2.2R). Ordem lexicográfica pelas UNIDADES
 * de código UTF-16 do JavaScript (operadores `<`/`>`), independente de locale e de ICU/CLDR —
 * ao contrário de `String.prototype.localeCompare`/`Intl.Collator`, cujo resultado varia por
 * locale, versão do ICU e plataforma. É a ÚNICA regra de desempate de TEXTO: ordenação do corpus,
 * escolha do representante após dedupe, seleção das ≤cap e ordem do prompt. NÃO usa
 * reviewId/source/origin/data/ordem-da-query como critério.
 */
export function compareCanonicalText(a: string, b: string): number {
  if (a === b) return 0
  return a < b ? -1 : 1
}

const normForDedup = normalizeReviewText

/**
 * Assinatura DETERMINÍSTICA da seleção de ≤cap reviews que iriam ao digest. Depende
 * EXCLUSIVAMENTE de `corpusPolicyVersion` + os textos normalizados selecionados na ordem
 * determinística (ordenada por texto). NÃO depende de `reviewId`/`source`/`origin`/URL/
 * external id/autor/idioma/datas/ordem da query. Trocar a política invalida a assinatura.
 */
export function computeDigestSelectionSignature(
  selectedNormalizedTexts: string[],
  policyVersion: string = REVIEW_CORPUS_POLICY_VERSION,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ policy: policyVersion, selectedNormalizedTexts }))
    .digest("hex")
}

/**
 * Constrói o corpus canônico a partir de reviews externas com proveniência. Regras:
 * útil (≥40 após trim) · dedup por texto normalizado (preserva toda a proveniência) ·
 * ordem determinística (independe da entrada) · teto `cap` na amostra · assinatura
 * reprodutível que muda se qualquer review incluída mudar e ignora as excluídas/não-úteis.
 */
export function buildCanonicalReviewCorpus(
  inputs: CanonicalReviewInput[],
  opts: { cap?: number; policyVersion?: string } = {},
): CanonicalReviewCorpus {
  const cap = opts.cap ?? CANONICAL_REVIEW_CAP
  const policyVersion = opts.policyVersion ?? REVIEW_CORPUS_POLICY_VERSION

  // agrupa úteis por texto normalizado
  const groups = new Map<string, CanonicalReviewInput[]>()
  for (const r of inputs) {
    if (!isUsefulReviewText(r.text)) continue
    const key = normForDedup(r.text)
    if (!key) continue
    const g = groups.get(key)
    if (g) g.push(r)
    else groups.set(key, [r])
  }

  const reviews: CanonicalReview[] = []
  for (const group of groups.values()) {
    // Representante DISPLAY = MENOR texto (trim) por `compareCanonicalText` (unidades de código
    // UTF-16, locale-independente) — SEM source/origin/data. `reviewId` é desempate APENAS de
    // DETERMINISMO entre textos byte-idênticos (não muda o texto exibido nem nenhuma assinatura:
    // corpusSignature/digestSelectionSignature usam o texto NORMALIZADO, idêntico em todo o grupo).
    const sorted = [...group].sort((a, b) => {
      const c = compareCanonicalText((a.text ?? "").trim(), (b.text ?? "").trim())
      return c !== 0 ? c : compareCanonicalText(a.reviewId, b.reviewId)
    })
    const rep = sorted[0]
    const provenance: ReviewProvenance[] = sorted
      .map((r) => ({ origin: r.origin, source: r.source, externalId: r.externalId ?? null, sourceUrl: r.sourceUrl ?? null, reviewId: r.reviewId }))
      .sort((a, b) => compareCanonicalText(`${a.origin}|${a.source}|${a.reviewId}`, `${b.origin}|${b.source}|${b.reviewId}`))
    reviews.push({
      text: (rep.text ?? "").trim(),
      origin: rep.origin,
      source: rep.source,
      externalId: rep.externalId ?? null,
      sourceUrl: rep.sourceUrl ?? null,
      reviewId: rep.reviewId,
      provenance,
    })
  }
  // text-only-v1: ordenação SÓ por texto normalizado, via `compareCanonicalText` (code-unit UTF-16,
  // locale-independente; NÃO `localeCompare`/`Intl.Collator`). Pós-dedupe cada texto é único ⇒ ordem
  // total sem desempate — `reviewId` NÃO entra na seleção/ordem. (selectionPolicyVersion
  // normalized-text-js-code-unit-order-cap40-v1; ver lib/synopsis-interest/digest-text-only.ts.)
  reviews.sort((a, b) => compareCanonicalText(normForDedup(a.text), normForDedup(b.text)))

  // text-only (B2.2N): SÓ o texto normalizado é sinal experimental. `source`/`origin` são
  // metadado administrativo e NÃO entram na assinatura — alterar fonte/URL/autor/idioma/data
  // (sem mudar o texto) não muda `corpusSignature`. A ordenação/seleção da amostra também é
  // por texto (acima), independente de fonte. Proveniência segue preservada no output.
  // A VERSÃO DA POLÍTICA entra na assinatura ⇒ trocar a política invalida plano/cache.
  const corpusSignature = sha256({
    policy: policyVersion,
    n: reviews.length,
    items: reviews.map((r) => ({ t: normForDedup(r.text) })),
  })

  const sample = reviews.slice(0, cap)
  const digestSelectionSignature = computeDigestSelectionSignature(
    sample.map((r) => normForDedup(r.text)),
    policyVersion,
  )

  return {
    reviews,
    sample,
    usefulCount: reviews.length,
    corpusSignature,
    digestSelectionSignature,
    state: reviews.length === 0 ? "no_reviews_available" : "available",
  }
}

// ── Mapeadores de proveniência (para wiring FUTURO — não executado nesta fase) ──

export interface WorkReviewRow {
  id: string
  source: string | null
  text: string | null
}

/** `work_reviews` → entrada canônica (origin=external_scraped). Wiring de produção é FUTURO. */
export function workReviewsToCanonicalInput(rows: WorkReviewRow[]): CanonicalReviewInput[] {
  return rows.map((r) => ({ reviewId: r.id, origin: "external_scraped", source: (r.source ?? "desconhecida").trim().toLowerCase(), externalId: null, sourceUrl: null, text: r.text ?? "" }))
}

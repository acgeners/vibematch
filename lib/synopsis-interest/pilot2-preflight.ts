/**
 * Plano 3 Fase B2.2P — PREFLIGHT read-only dos digests sob `base-2r1` / `text-only-v1`. PURO:
 * sem banco, sem rede, sem LLM, sem `server-only`. Classifica a readiness de cada obra de forma
 * FAIL-CLOSED: só marca um digest como reutilizável se houver PROVA COMPLETA de equivalência
 * (política + prompt + corpus + seleção + modelo + schema). Ausência de prova ⇒ NÃO reutilizável.
 *
 * NÃO reconstrói o corpus por outro caminho e NÃO usa o digest persistido como substituto das
 * reviews do snapshot. NÃO lê store pessoal/labels/status/scores/predictions/ranking.
 */

import { createHash } from "node:crypto"

/** Classes de readiness — mutuamente exclusivas (§4). */
export type DigestReadinessClass =
  | "no_reviews_available"
  | "digest_reusable_exact"
  | "digest_missing"
  | "digest_incompatible_corpus_policy"
  | "digest_incompatible_prompt"
  | "digest_corpus_changed"
  | "digest_selection_changed"
  | "digest_compatibility_unproven"
  | "blocked"

/** As 6 dimensões cuja PROVA é exigida para reutilização (§4.2). */
export interface DigestProvenance {
  present: boolean
  /** Versão do registro (`works.review_digest_version`). */
  version: string | null
  /** N de reviews que originou o digest (`works.review_digest_n`). */
  n: number | null
  /** Campos de PROVA (hoje NÃO persistidos no schema ⇒ chegam undefined ⇒ fail-closed). */
  corpusPolicyVersion?: string | null
  reviewCorpusSignature?: string | null
  digestSelectionSignature?: string | null
  promptVersion?: string | null
  model?: string | null
  schema?: string | null
  /** JSON do digest não-parseável/ inválido. */
  malformed?: boolean
}

/** O que o preflight EXIGE (do código atual do gerador) para aceitar reutilização. */
export interface ExpectedDigestIdentity {
  corpusPolicyVersion: string // "text-only-v1"
  digestVersion: string // ex. "digest-v1"
  promptVersion: string // prompt text-only ([Review N]) — FUTURO
  model: string // "claude-sonnet-4-6"
  schema: string // versão do schema do digest
}

export interface PreflightWorkInput {
  workId: string
  /** Do `base-2r1` (frozen, verificado). */
  reviewsAfterDedupe: number
  reviewCorpusSignature: string
  digestSelectionSignature: string
  /** Estado ATUAL do digest persistido (null ⇒ ausente). */
  persisted: DigestProvenance | null
  /** Flags de inconsistência detectadas fora da função. */
  duplicateWorkId?: boolean
  missingFromSnapshot?: boolean
}

export interface PreflightWorkResult {
  workId: string
  readiness: DigestReadinessClass
  reason: string
}

/**
 * Classifica UMA obra. FAIL-CLOSED: reutilização exige prova COMPLETA das 6 dimensões; qualquer
 * lacuna/divergência ⇒ classe específica de incompatibilidade (ou `digest_compatibility_unproven`
 * quando faltam dados para sequer comprovar). Ordem de precedência: blocked → no_reviews →
 * missing → (prova completa? então policy/prompt/corpus/seleção/modelo/schema) → unproven.
 */
export function classifyDigestReadiness(input: PreflightWorkInput, expected: ExpectedDigestIdentity): PreflightWorkResult {
  const r = (readiness: DigestReadinessClass, reason: string): PreflightWorkResult => ({ workId: input.workId, readiness, reason })

  // 4.9 blocked — inconsistências estruturais
  if (input.duplicateWorkId) return r("blocked", "work_id duplicado no conjunto")
  if (input.missingFromSnapshot) return r("blocked", "obra ausente do base-2r1")
  if (!Number.isInteger(input.reviewsAfterDedupe) || input.reviewsAfterDedupe < 0) return r("blocked", "contagem de reviews impossível")
  if (input.persisted?.malformed) return r("blocked", "digest persistido malformado/não-parseável")

  // 4.1 no_reviews_available
  if (input.reviewsAfterDedupe === 0) return r("no_reviews_available", "0 textos canônicos após dedupe")

  // 4.3 digest_missing
  if (!input.persisted || !input.persisted.present) return r("digest_missing", "obra com corpus útil, sem digest persistido")

  const p = input.persisted

  // ── Prova COMPLETA das 6 dimensões? Qualquer ausência ⇒ 4.8 unproven (fail-closed) ──
  const proofMissing: string[] = []
  if (p.corpusPolicyVersion == null) proofMissing.push("corpusPolicyVersion")
  if (p.promptVersion == null) proofMissing.push("promptVersion")
  if (p.reviewCorpusSignature == null) proofMissing.push("reviewCorpusSignature")
  if (p.digestSelectionSignature == null) proofMissing.push("digestSelectionSignature")
  if (p.model == null) proofMissing.push("model")
  if (p.schema == null) proofMissing.push("schema")
  if (proofMissing.length > 0) {
    return r("digest_compatibility_unproven", `proveniência insuficiente p/ comprovar reutilização (faltam: ${proofMissing.join(", ")})`)
  }

  // ── Prova presente: avaliar equivalência, da causa mais específica à mais geral ──
  // 4.4 política do corpus
  if (p.corpusPolicyVersion !== expected.corpusPolicyVersion) {
    return r("digest_incompatible_corpus_policy", `política "${p.corpusPolicyVersion}" ≠ "${expected.corpusPolicyVersion}"`)
  }
  // 4.5 prompt (text-only [Review N])
  if (p.promptVersion !== expected.promptVersion) {
    return r("digest_incompatible_prompt", `prompt "${p.promptVersion}" ≠ esperado "${expected.promptVersion}"`)
  }
  // 4.6 corpus mudou
  if (p.reviewCorpusSignature !== input.reviewCorpusSignature) {
    return r("digest_corpus_changed", "reviewCorpusSignature do digest ≠ base-2r1")
  }
  // 4.7 seleção mudou
  if (p.digestSelectionSignature !== input.digestSelectionSignature) {
    return r("digest_selection_changed", "digestSelectionSignature do digest ≠ base-2r1")
  }
  // modelo / schema / versão do digest — divergência bloqueia reutilização (sem classe própria ⇒ unproven)
  if (p.model !== expected.model) return r("digest_compatibility_unproven", `modelo "${p.model}" ≠ "${expected.model}"`)
  if (p.schema !== expected.schema) return r("digest_compatibility_unproven", `schema "${p.schema}" ≠ "${expected.schema}"`)
  if (p.version !== expected.digestVersion) return r("digest_compatibility_unproven", `versão "${p.version}" ≠ "${expected.digestVersion}"`)

  // 4.2 reutilizável EXATO — todas as 6 dimensões comprovadamente equivalentes
  return r("digest_reusable_exact", "equivalência completa comprovada (policy+prompt+corpus+seleção+modelo+schema)")
}

/** Classes que EXIGIRIAM geração de digest no futuro (tudo que não é reusable/no_reviews/blocked). */
export const FUTURE_GENERATION_CLASSES: DigestReadinessClass[] = [
  "digest_missing",
  "digest_incompatible_corpus_policy",
  "digest_incompatible_prompt",
  "digest_corpus_changed",
  "digest_selection_changed",
  "digest_compatibility_unproven",
]

export interface ReconcileExpectation {
  total: number // 90
  noReviews: number // 19
  withReviews: number // 71
}

export interface ReconcileResult {
  ok: boolean
  total: number
  counts: Record<DigestReadinessClass, number>
  noReviews: number
  withReviews: number
  reusableExact: number
  futureGeneration: number
  blocked: number
  violations: string[]
}

const ALL_CLASSES: DigestReadinessClass[] = [
  "no_reviews_available",
  "digest_reusable_exact",
  "digest_missing",
  "digest_incompatible_corpus_policy",
  "digest_incompatible_prompt",
  "digest_corpus_changed",
  "digest_selection_changed",
  "digest_compatibility_unproven",
  "blocked",
]

/**
 * Reconcilia as classes contra a expectativa congelada. Invariantes: soma=total; no_reviews
 * bate; futureGeneration + reusable_exact = withReviews; blocked deve ser 0. Qualquer violação
 * é listada (bloqueante para o relatório).
 */
export function reconcile(results: PreflightWorkResult[], exp: ReconcileExpectation): ReconcileResult {
  const counts = Object.fromEntries(ALL_CLASSES.map((c) => [c, 0])) as Record<DigestReadinessClass, number>
  for (const r of results) counts[r.readiness] += 1
  const total = results.length
  const noReviews = counts.no_reviews_available
  const withReviews = total - noReviews
  const reusableExact = counts.digest_reusable_exact
  const futureGeneration = FUTURE_GENERATION_CLASSES.reduce((n, c) => n + counts[c], 0)
  const blocked = counts.blocked

  const violations: string[] = []
  if (total !== exp.total) violations.push(`total ${total} ≠ ${exp.total}`)
  if (noReviews !== exp.noReviews) violations.push(`no_reviews ${noReviews} ≠ ${exp.noReviews}`)
  if (withReviews !== exp.withReviews) violations.push(`withReviews ${withReviews} ≠ ${exp.withReviews}`)
  if (futureGeneration + reusableExact !== withReviews) {
    violations.push(`futureGeneration(${futureGeneration}) + reusable(${reusableExact}) ≠ withReviews(${withReviews})`)
  }
  if (blocked > 0) violations.push(`blocked = ${blocked} (esperado 0)`)

  return { ok: violations.length === 0, total, counts, noReviews, withReviews, reusableExact, futureGeneration, blocked, violations }
}

/**
 * Assinatura DIAGNÓSTICA do relatório de preflight. Representa SOMENTE o diagnóstico (entradas
 * congeladas + classificação + contagens). NÃO inclui timestamp. NÃO é autorização nem
 * assinatura de plano/execução.
 */
export function computePreflightReportSignature(payload: {
  base2Signature: string
  base2r1Signature: string
  reviewCorpusAggregateSignature: string
  digestSelectionAggregateSignature: string
  corpusPolicyVersion: string
  expected: ExpectedDigestIdentity
  results: PreflightWorkResult[]
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: "preflight-diagnostic",
        base2Signature: payload.base2Signature,
        base2r1Signature: payload.base2r1Signature,
        reviewCorpusAggregateSignature: payload.reviewCorpusAggregateSignature,
        digestSelectionAggregateSignature: payload.digestSelectionAggregateSignature,
        corpusPolicyVersion: payload.corpusPolicyVersion,
        expected: payload.expected,
        results: [...payload.results]
          .sort((a, b) => a.workId.localeCompare(b.workId))
          .map((r) => [r.workId, r.readiness]),
      }),
    )
    .digest("hex")
}

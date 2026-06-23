/**
 * Planner + runner AGREGADO SEGURO dos digests do golden contextual (Plano 3 Fase
 * B2.2A). PURO no planner; runner com IO INJETÁVEL (testável sem DB/LLM).
 *
 * Opera EXCLUSIVAMENTE sobre o snapshot-base `base-1`: só obras elegíveis do golden,
 * exclui as 29 `no_reviews_available`, exclui digests fresh reutilizáveis, BLOQUEIA
 * se o corpus de reviews mudou (exige base-2). Sem labels. Dry-run não cria job nem
 * chama LLM. NÃO usa o lote legado de settings (que bypassa o cost gate).
 */

import { createHash } from "node:crypto"

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

// ── Classificação por obra ───────────────────────────────────────────────────

export type GoldenDigestItemState =
  | "corpus_unchanged_digest_missing"
  | "corpus_unchanged_digest_fresh_reusable"
  | "corpus_unchanged_digest_stale"
  | "corpus_changed"
  | "digest_failed_previous"
  | "no_reviews_available"
  | "blocked"

/** Estado FROZEN da obra no snapshot-base. `base-1` rotula a ausência como
 * `no_reviews` (a UI/doc usa `no_reviews_available`); ambos = "sem reviews úteis". */
export interface SnapshotWorkRef {
  workId: string
  reviewState: "frozen_current" | "no_reviews" | "no_reviews_available"
  /** Assinatura do corpus de reviews congelada no base-1. */
  reviewCorpusSignature: string
}

/** Estado ATUAL da obra (lido do banco, read-only). */
export interface CurrentWorkState {
  workId: string
  /** Recalculada do banco AGORA (mesma função do snapshot). */
  currentCorpusSignature: string
  digestPresent: boolean
  digestVersion: string | null
  /** Último job de digest desta obra ficou failed? (resume/diagnóstico) */
  lastDigestJobFailed?: boolean
  /** Digest presente mas não-parseável/ inválido. */
  digestInvalid?: boolean
}

export function classifyGoldenDigestItem(
  snap: SnapshotWorkRef,
  cur: CurrentWorkState,
  opts: { digestVersion: string },
): GoldenDigestItemState {
  if (snap.reviewState !== "frozen_current") {
    // Sem reviews úteis no base-1. O corpus (lista vazia) deve bater — senão
    // alguém adicionou reviews ⇒ corpus_changed (exige base-2).
    return cur.currentCorpusSignature === snap.reviewCorpusSignature ? "no_reviews_available" : "corpus_changed"
  }
  if (cur.currentCorpusSignature !== snap.reviewCorpusSignature) return "corpus_changed"
  // corpus inalterado:
  if (cur.digestInvalid) return "corpus_unchanged_digest_stale"
  if (cur.lastDigestJobFailed && !cur.digestPresent) return "digest_failed_previous"
  if (!cur.digestPresent) return "corpus_unchanged_digest_missing"
  if (cur.digestVersion !== opts.digestVersion) return "corpus_unchanged_digest_stale"
  return "corpus_unchanged_digest_fresh_reusable"
}

/** Estados que EXIGEM geração de digest. */
const GENERATES = new Set<GoldenDigestItemState>([
  "corpus_unchanged_digest_missing",
  "corpus_unchanged_digest_stale",
  "digest_failed_previous",
])

// ── Plano ────────────────────────────────────────────────────────────────────

export interface GoldenDigestVersions {
  experimentVersion: string
  goldenVersion: string
  snapshotVersion: string
  digestVersion: string
  promptVersion: string
  model: string
  schemaVersion: string
  pricingVersion: string
  costPolicyVersion: string
  /** Versão da política do corpus (B2.2N) — entra na `planSignature` via `versions`. */
  corpusPolicyVersion: string
}

export interface GoldenDigestPlanInput {
  versions: GoldenDigestVersions
  snapshotBaseSignature: string
  reviewCorpusSignature: string
  /** Por obra: ref frozen + estado atual + escala de custo (min(úteis,40)). */
  items: Array<{ snap: SnapshotWorkRef; current: CurrentWorkState; usefulCount: number }>
  /** Custo injetado (estimateStep de produção). */
  costPerWork: (scale: number) => { likelyUsd: number; upperBoundUsd: number }
  reviewSampleCap?: number
}

export interface GoldenDigestBatchPlan {
  versions: GoldenDigestVersions
  snapshotBaseSignature: string
  reviewCorpusSignature: string
  items: Array<{ workId: string; state: GoldenDigestItemState }>
  eligibleWorkIds: string[]
  reusableWorkIds: string[]
  noReviewsWorkIds: string[]
  changedWorkIds: string[]
  /** true ⇒ corpus mudou em ≥1 obra ⇒ NÃO executar; exige base-2. */
  blocked: boolean
  likelyUsd: number
  upperBoundUsd: number
  planSignature: string
  requiresAggregateAuthorization: true
}

const DEFAULT_CAP = 40

export function planGoldenDigestBatch(input: GoldenDigestPlanInput): GoldenDigestBatchPlan {
  const cap = input.reviewSampleCap ?? DEFAULT_CAP
  const items: Array<{ workId: string; state: GoldenDigestItemState }> = []
  const eligible: Array<{ workId: string; reviewCorpusSignature: string; scale: number }> = []
  const reusable: string[] = []
  const noReviews: string[] = []
  const changed: string[] = []

  for (const it of input.items) {
    const state = classifyGoldenDigestItem(it.snap, it.current, { digestVersion: input.versions.digestVersion })
    items.push({ workId: it.snap.workId, state })
    if (state === "corpus_changed") changed.push(it.snap.workId)
    else if (state === "no_reviews_available") noReviews.push(it.snap.workId)
    else if (state === "corpus_unchanged_digest_fresh_reusable") reusable.push(it.snap.workId)
    else if (GENERATES.has(state)) eligible.push({ workId: it.snap.workId, reviewCorpusSignature: it.snap.reviewCorpusSignature, scale: Math.min(it.usefulCount, cap) })
  }

  eligible.sort((a, b) => a.workId.localeCompare(b.workId))
  let likelyUsd = 0
  let upperBoundUsd = 0
  for (const e of eligible) {
    const c = input.costPerWork(e.scale)
    likelyUsd += c.likelyUsd
    upperBoundUsd += c.upperBoundUsd
  }

  // Assinatura: versões + assinaturas globais + IDs elegíveis ordenados + review
  // input hash POR obra (corpus frozen). Order-independent. Sem labels.
  const planSignature = sha256(
    JSON.stringify({
      versions: input.versions,
      snapshotBaseSignature: input.snapshotBaseSignature,
      reviewCorpusSignature: input.reviewCorpusSignature,
      eligible: eligible.map((e) => [e.workId, e.reviewCorpusSignature]),
    }),
  )

  return {
    versions: input.versions,
    snapshotBaseSignature: input.snapshotBaseSignature,
    reviewCorpusSignature: input.reviewCorpusSignature,
    items,
    eligibleWorkIds: eligible.map((e) => e.workId),
    reusableWorkIds: reusable.sort(),
    noReviewsWorkIds: noReviews.sort(),
    changedWorkIds: changed.sort(),
    blocked: changed.length > 0,
    likelyUsd,
    upperBoundUsd,
    planSignature,
    requiresAggregateAuthorization: true,
  }
}

// ── Runner (IO injetável; NÃO executado nesta etapa) ─────────────────────────

export interface DigestOutcome {
  status: "succeeded" | "skipped" | "failed" | "processing"
  ranLlm: boolean
  costUsd: number
  error?: string
}

export interface RunGoldenDigestDeps {
  /** Gera (ou confirma) o digest de UMA obra. Injetado: o CLI passa ensureReviewDigest. */
  ensureDigest: (workId: string) => Promise<DigestOutcome>
  /** Re-check antes de cada obra: snapshot ainda válido + corpus inalterado. */
  recheck: (workId: string) => Promise<{ snapshotValid: boolean; corpusUnchanged: boolean }>
  /** Upper estimado da PRÓXIMA chamada (para o soft-cap). */
  upperFor: (workId: string) => number
  maxCostUsd: number
  /** Cancelamento cooperativo. */
  shouldStop?: () => boolean
  concurrency?: number
}

export interface GoldenDigestReport {
  planned: number
  started: number
  succeeded: number
  reused: number
  failed: number
  processing: number
  changedDuringRun: number
  stoppedByCost: boolean
  stoppedByCancel: boolean
  stoppedByPlanChange: boolean
  actualUsd: number
  errors: string[]
  status: "completed" | "completed_with_failures" | "partial" | "plan_changed" | "blocked_cost"
}

/**
 * Executa o lote APÓS confirmação. Sequencial por padrão (concorrência opcional).
 * Soft-cap: `acc + upper(próxima) > maxCostUsd ⇒ stoppedByCost`. Re-check por obra:
 * snapshot/corpus divergente ⇒ `plan_changed` (não inicia). Falhas persistidas pelo
 * `ensureDigest` (job failed); SEM retry automático; SEM fallback de summary; sucessos
 * preservados. `completed` só se todos os elegíveis ficarem succeeded/reused.
 */
export async function runGoldenDigestBatch(
  plan: GoldenDigestBatchPlan,
  deps: RunGoldenDigestDeps,
): Promise<GoldenDigestReport> {
  const report: GoldenDigestReport = {
    planned: plan.eligibleWorkIds.length,
    started: 0, succeeded: 0, reused: 0, failed: 0, processing: 0, changedDuringRun: 0,
    stoppedByCost: false, stoppedByCancel: false, stoppedByPlanChange: false,
    actualUsd: 0, errors: [], status: "partial",
  }
  if (plan.blocked) { report.status = "plan_changed"; report.stoppedByPlanChange = true; return report }

  let acc = 0
  for (const workId of plan.eligibleWorkIds) {
    if (deps.shouldStop?.()) { report.stoppedByCancel = true; break }
    // Soft-cap (custo real acumulado + upper da próxima ≤ teto).
    if (acc + deps.upperFor(workId) > deps.maxCostUsd) { report.stoppedByCost = true; break }
    // Re-check de plano.
    const rc = await deps.recheck(workId)
    if (!rc.snapshotValid || !rc.corpusUnchanged) { report.stoppedByPlanChange = true; report.changedDuringRun += 1; break }

    report.started += 1
    const out = await deps.ensureDigest(workId)
    if (out.status === "succeeded") { report.succeeded += 1; if (out.ranLlm) { acc += out.costUsd; report.actualUsd += out.costUsd } }
    else if (out.status === "skipped") { report.reused += 1 }
    else if (out.status === "processing") { report.processing += 1 }
    else { report.failed += 1; if (out.error) report.errors.push(out.error) }
  }

  const allHandled = report.succeeded + report.reused === report.planned
  if (report.stoppedByPlanChange) report.status = "plan_changed"
  else if (report.failed > 0) report.status = "completed_with_failures"
  else if (report.stoppedByCost || report.stoppedByCancel || report.processing > 0 || !allHandled) report.status = "partial"
  else report.status = "completed"
  return report
}

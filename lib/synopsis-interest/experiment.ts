/**
 * Protocolo experimental CONGELADO do Plano 3 — comparação de candidatos de
 * Interesse na Sinopse (Fase B2.0). PURO: sem banco, sem LLM, sem Date/random,
 * sem `server-only`. Só `node:crypto` + tipos de domínio.
 *
 * Define: versões do experimento, registro de candidatos (baseline × enriquecido),
 * resolução de contexto de review (digest → summary → no_reviews, com estados stale
 * EXPLÍCITOS), assinatura de snapshot, assinatura de entrada por candidato, e o
 * planner PURO do digest restrito ao golden. NÃO executa nada, NÃO cria jobs, NÃO
 * escreve em `synopsis_quality_predictions` de produção.
 *
 * Invariantes (ver PLANO3-EXPERIMENTO-DIGEST-GOLDEN.md):
 *  - rótulos humanos NUNCA entram em nenhuma assinatura/entrada de candidato;
 *  - baseline NÃO depende de digest/summary;
 *  - digest/summary stale ou ausente são estados EXPLÍCITOS (sem substituição
 *    silenciosa);
 *  - a mesma snapshot produz a mesma assinatura, independente da ordem das obras;
 *  - micro-threshold individual NÃO autoriza o lote (gate agregado obrigatório).
 */

import { createHash } from "node:crypto"

// ── Versões congeladas ───────────────────────────────────────────────────────

export const EXPERIMENT_VERSION = "digest-exp-1"
/** Espelha REVIEW_DIGEST_VERSION de review-summarizer.ts (server-only). Manter em sincronia. */
export const EXPERIMENT_DIGEST_VERSION = "digest-v1"
/** prompt_version de PRODUÇÃO — NÃO usar como storage/identidade de experimento. */
export const PRODUCTION_PROMPT_VERSION = "v2"

function sha256(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj)).digest("hex")
}

/** Mirror PURO de isMaterialReviewChange (review-summarizer.ts). */
export function isMaterialReviewGrowth(prevN: number | null, nowN: number): boolean {
  if (prevN == null) return true
  return nowN - prevN >= Math.max(2, Math.ceil(nowN * 0.2))
}

// ── Candidatos ───────────────────────────────────────────────────────────────

export interface ExperimentCandidate {
  id: string
  label: string
  /** true ⇒ injeta contexto de review (digest/summary) no prompt. */
  usesReviewContext: boolean
  promptVersion: string
  model: string
  schemaVersion: string
}

/**
 * Registro CONGELADO. `b1` replica o contrato de produção (perfil+título+sinopse+
 * tags, SEM digest/summary) e é re-executado no experimento (nunca reusa as 112
 * de produção sem equivalência exata provada). `e1` adiciona o contexto de review
 * com fallback digest→summary→no_reviews.
 */
export const CANDIDATES: Record<"b1" | "e1", ExperimentCandidate> = {
  b1: {
    id: "b1",
    label: "baseline — perfil+título+sinopse+tags (sem digest/summary)",
    usesReviewContext: false,
    promptVersion: "v2",
    model: "claude-sonnet-4-6",
    schemaVersion: "v1",
  },
  e1: {
    id: "e1",
    label: "enriquecido — baseline + contexto de review (digest→summary→no_reviews)",
    usesReviewContext: true,
    promptVersion: "v2+digest",
    model: "claude-sonnet-4-6",
    schemaVersion: "v1",
  },
}

// ── Resolução de contexto de review (fallback explícito) ─────────────────────

export type ReviewContextType =
  | "digest"        // digest fresco usado
  | "summary"       // sem digest fresco; summary fresco usado (fallback)
  | "no_reviews"    // ausência legítima
  | "stale_digest"  // digest presente porém stale — EXPLÍCITO, sem downgrade silencioso
  | "stale_summary" // summary presente porém stale — EXPLÍCITO
  | "missing"       // reviews existem mas nenhum artefato utilizável (precisa gerar)

export interface ReviewArtifactState {
  usefulReviewCount: number
  digestPresent: boolean
  digestFresh: boolean
  summaryPresent: boolean
  summaryFresh: boolean
}

export interface ResolvedReviewContext {
  type: ReviewContextType
  /** Parte da assinatura do candidato enriquecido — muda quando o conteúdo/estado muda. */
  signaturePart: string
}

/**
 * Fallback OBRIGATÓRIO do candidato enriquecido. Ordem:
 *   digest fresco → summary fresco → no_reviews.
 * Estados stale/ausente NÃO são substituídos silenciosamente: viram tipo explícito.
 */
export function resolveReviewContext(s: ReviewArtifactState): ResolvedReviewContext {
  if (s.usefulReviewCount === 0) return { type: "no_reviews", signaturePart: "no_reviews" }
  if (s.digestPresent && s.digestFresh) return { type: "digest", signaturePart: "digest:fresh" }
  if (s.digestPresent && !s.digestFresh) return { type: "stale_digest", signaturePart: "digest:stale" }
  if (s.summaryPresent && s.summaryFresh) return { type: "summary", signaturePart: "summary:fresh" }
  if (s.summaryPresent && !s.summaryFresh) return { type: "stale_summary", signaturePart: "summary:stale" }
  return { type: "missing", signaturePart: "missing" }
}

// ── Contexto de tags (4 estados; proveniência S078) ──────────────────────────

/**
 * Quatro estados de proveniência de tags (Fase B2.1C). `loading_error` NUNCA
 * produz assinatura (é lançado), por isso não aparece num `ResolvedTagContext`.
 */
export type TagContextType =
  | "tags_present"
  | "no_tags_legitimate"
  | "missing_recoverable_frozen_empty"
  | "loading_error"

export interface ResolvedTagContext {
  type: Exclude<TagContextType, "loading_error">
  /** Parte canônica da assinatura — order-independent. */
  signaturePart: string
  tags: string[]
}

export interface TagContextOptions {
  /**
   * true ⇒ a obra tem FONTES de onde tags são recuperáveis (IDs externos aceitos
   * que carregam tags e/ou gêneros), mas as tags não foram persistidas. `[]` então
   * é `missing_recoverable_frozen_empty` (S078) — DISTINTO de ausência legítima.
   */
  recoverable?: boolean
}

/**
 * Resolve o contexto de tags para o snapshot/assinatura. Distingue 4 estados que
 * antes colidiam:
 *   - `null`/`undefined` = **loading_error** ⇒ **THROW** (erro de carregamento
 *     nunca é assinado silenciosamente);
 *   - lista não-vazia ⇒ `tags_present`;
 *   - `[]` + `recoverable` ⇒ `missing_recoverable_frozen_empty` (tags existem na
 *     fonte, congeladas vazias de propósito — S078);
 *   - `[]` sem `recoverable` ⇒ `no_tags_legitimate` (sem tags em lugar nenhum).
 * Cada estado tem `signaturePart` própria. A ordem das tags não afeta a assinatura
 * (normaliza + ordena). NÃO inventa nem busca tags.
 */
export function resolveTagContext(
  tags: string[] | null | undefined,
  opts: TagContextOptions = {},
): ResolvedTagContext {
  if (tags == null) {
    throw new Error("tags não carregadas (loading_error) — não assinar; corrija o carregamento da obra")
  }
  const norm = [...tags].map((t) => t.trim().toLowerCase()).filter(Boolean).sort()
  if (norm.length > 0) return { type: "tags_present", signaturePart: `tags:${norm.join("|")}`, tags: norm }
  if (opts.recoverable) {
    return { type: "missing_recoverable_frozen_empty", signaturePart: "no_tags:recoverable_frozen", tags: [] }
  }
  return { type: "no_tags_legitimate", signaturePart: "no_tags:legitimate", tags: [] }
}

/**
 * Assinatura canônica de tags. O loader DEVE usar isto para produzir o `tagsSig`
 * do snapshot — garante que `[]` recuperável (S078) tenha hash **distinto** de `[]`
 * legítimo, de qualquer lista de tags, e de erro de carregamento (`null` ⇒ throw,
 * nunca gera assinatura). "Obra não encontrada" é tratada antes (loader lança).
 */
export function computeTagsSignature(tags: string[] | null | undefined, opts: TagContextOptions = {}): string {
  return sha256(resolveTagContext(tags, opts).signaturePart)
}

// ── Snapshot + assinaturas ───────────────────────────────────────────────────

/**
 * Estado congelado de UMA obra no snapshot experimental. Assinaturas pré-hashadas
 * pelo loader (nunca o conteúdo bruto — sem sinopse/review/digest/rótulo aqui).
 */
export interface WorkSnapshotInput {
  workId: string
  titleSig: string
  synopsisSig: string
  tagsSig: string
  profileSig: string
  reviewContextType: ReviewContextType
  reviewContextSig: string
}

/** Assinatura de UMA obra (inclui o contexto de review — é o estado completo). */
export function computeWorkSnapshotSignature(w: WorkSnapshotInput): string {
  return sha256({
    workId: w.workId,
    title: w.titleSig,
    synopsis: w.synopsisSig,
    tags: w.tagsSig,
    profile: w.profileSig,
    reviewContextType: w.reviewContextType,
    reviewContextSig: w.reviewContextSig,
  })
}

export interface SnapshotSignatureParts {
  goldenVersion: string
  works: WorkSnapshotInput[]
  promptVersions: string[]
  models: string[]
  schemaVersions: string[]
}

/**
 * Assinatura do SNAPSHOT inteiro — base compartilhada por todos os candidatos.
 * Independente da ordem das obras (ordena por workId). NÃO inclui rótulos humanos.
 */
export function computeSnapshotSignature(parts: SnapshotSignatureParts): string {
  const works = [...parts.works]
    .sort((a, b) => a.workId.localeCompare(b.workId))
    .map(computeWorkSnapshotSignature)
  return sha256({
    experimentVersion: EXPERIMENT_VERSION,
    goldenVersion: parts.goldenVersion,
    works,
    promptVersions: [...parts.promptVersions].sort(),
    models: [...parts.models].sort(),
    schemaVersions: [...parts.schemaVersions].sort(),
  })
}

/**
 * Assinatura de entrada de UM candidato para UMA obra. O baseline EXCLUI o
 * contexto de review (não depende de digest/summary); o enriquecido inclui.
 * Nenhum candidato inclui rótulo humano, score, ranking, alignment ou mood.
 */
export function computeCandidateInputSignature(c: ExperimentCandidate, w: WorkSnapshotInput): string {
  const base = {
    workId: w.workId,
    title: w.titleSig,
    synopsis: w.synopsisSig,
    tags: w.tagsSig,
    profile: w.profileSig,
    candidate: c.id,
    prompt: c.promptVersion,
    model: c.model,
    schema: c.schemaVersion,
  }
  if (!c.usesReviewContext) return sha256(base)
  return sha256({ ...base, reviewContextType: w.reviewContextType, reviewContextSig: w.reviewContextSig })
}

// ── Planner PURO do digest restrito ao golden ────────────────────────────────

export type GoldenDigestState = "fresh" | "stale" | "missing_with_reviews" | "no_reviews"

export interface GoldenDigestRow {
  workId: string
  usefulReviewCount: number
  digestPresent: boolean
  digestVersion: string | null
  digestN: number | null
  summaryPresent: boolean
}

/** Classifica o digest de uma obra do golden (mirror de classifyDigestReadiness). */
export function classifyGoldenDigest(r: GoldenDigestRow): GoldenDigestState {
  if (r.usefulReviewCount === 0) return "no_reviews"
  if (!r.digestPresent) return "missing_with_reviews"
  if (r.digestVersion !== EXPERIMENT_DIGEST_VERSION || isMaterialReviewGrowth(r.digestN, r.usefulReviewCount)) return "stale"
  return "fresh"
}

export interface GoldenDigestPlan {
  goldenVersion: string
  total: number
  fresh: number
  stale: number
  missingWithReviews: number
  summaryOnly: number
  noReviews: number
  /** Obras que precisam de digest gerado (missing_with_reviews + stale). */
  eligibleWorkIds: string[]
  likelyUsd: number
  upperBoundUsd: number
  planSignature: string
  /** SEMPRE true — micro-threshold individual não autoriza o lote agregado. */
  requiresAggregateAuthorization: boolean
}

const DEFAULT_REVIEW_SAMPLE_CAP = 40

/**
 * Dry-run PURO do digest do golden. NÃO executa, NÃO cria job. Rejeita qualquer
 * obra fora de `allowedWorkIds` (escopo do golden). `costPerWork(scale)` injeta o
 * custo (o caller usa estimateStep de produção). Determinístico e order-independent.
 */
export function planGoldenDigest(
  rows: GoldenDigestRow[],
  opts: {
    goldenVersion: string
    allowedWorkIds: string[]
    costPerWork: (scale: number) => { likelyUsd: number; upperBoundUsd: number }
    reviewSampleCap?: number
  },
): GoldenDigestPlan {
  const allowed = new Set(opts.allowedWorkIds)
  for (const r of rows) {
    if (!allowed.has(r.workId)) throw new Error(`work fora do escopo do golden: ${r.workId}`)
  }
  const cap = opts.reviewSampleCap ?? DEFAULT_REVIEW_SAMPLE_CAP

  let fresh = 0, stale = 0, missingWithReviews = 0, summaryOnly = 0, noReviews = 0
  const eligible: GoldenDigestRow[] = []
  for (const r of rows) {
    const st = classifyGoldenDigest(r)
    if (st === "fresh") fresh += 1
    else if (st === "no_reviews") noReviews += 1
    else if (st === "stale") { stale += 1; eligible.push(r) }
    else { missingWithReviews += 1; if (r.summaryPresent) summaryOnly += 1; eligible.push(r) }
  }

  let likelyUsd = 0, upperBoundUsd = 0
  for (const r of eligible) {
    const c = opts.costPerWork(Math.min(r.usefulReviewCount, cap))
    likelyUsd += c.likelyUsd
    upperBoundUsd += c.upperBoundUsd
  }

  const eligibleWorkIds = eligible.map((r) => r.workId).sort()
  const planSignature = sha256({
    experimentVersion: EXPERIMENT_VERSION,
    goldenVersion: opts.goldenVersion,
    digestVersion: EXPERIMENT_DIGEST_VERSION,
    eligibleWorkIds,
  })

  return {
    goldenVersion: opts.goldenVersion,
    total: rows.length,
    fresh,
    stale,
    missingWithReviews,
    summaryOnly,
    noReviews,
    eligibleWorkIds,
    likelyUsd,
    upperBoundUsd,
    planSignature,
    requiresAggregateAuthorization: true,
  }
}

// ── Dry-run PURO de um candidato ─────────────────────────────────────────────

export interface CandidateDryRun {
  candidateId: string
  total: number
  byReviewContext: Record<ReviewContextType, number>
  /** Chamadas necessárias (todas as obras do snapshot — sem reuso de produção). */
  callsNeeded: number
  likelyUsd: number
  upperBoundUsd: number
  snapshotSignature: string
  planSignature: string
}

/**
 * Dry-run PURO de um candidato sobre o snapshot. Conta obras por contexto de
 * review e estima o custo. NÃO gera output. `callsNeeded` = todas as obras
 * (baseline e enriquecido são re-executados; nunca reusam as 112 de produção).
 */
export function planCandidateDryRun(
  candidate: ExperimentCandidate,
  works: WorkSnapshotInput[],
  opts: {
    snapshotSignature: string
    costPerCall: () => { likelyUsd: number; upperBoundUsd: number }
  },
): CandidateDryRun {
  const byReviewContext: Record<ReviewContextType, number> = {
    digest: 0, summary: 0, no_reviews: 0, stale_digest: 0, stale_summary: 0, missing: 0,
  }
  for (const w of works) byReviewContext[w.reviewContextType] += 1

  const callsNeeded = works.length
  const per = opts.costPerCall()
  const likelyUsd = per.likelyUsd * callsNeeded
  const upperBoundUsd = per.upperBoundUsd * callsNeeded

  const planSignature = sha256({
    experimentVersion: EXPERIMENT_VERSION,
    candidate: candidate.id,
    prompt: candidate.promptVersion,
    model: candidate.model,
    schema: candidate.schemaVersion,
    snapshotSignature: opts.snapshotSignature,
    inputs: [...works]
      .sort((a, b) => a.workId.localeCompare(b.workId))
      .map((w) => computeCandidateInputSignature(candidate, w)),
  })

  return {
    candidateId: candidate.id,
    total: works.length,
    byReviewContext,
    callsNeeded,
    likelyUsd,
    upperBoundUsd,
    snapshotSignature: opts.snapshotSignature,
    planSignature,
  }
}

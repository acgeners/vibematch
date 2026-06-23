/**
 * Plano 3 — Auditoria PURA dos artefatos do pilot-2 / base-2 (Fase B2.2F-audit). Sem banco,
 * sem rede, sem `server-only`, sem LLM. Assinaturas de vínculo (base-2 ↔ manifesto), mapa de
 * carryovers, escopo do plano de digests, detecção de `plan_changed`, soma de custo. Nada
 * depende de `captured_at` (reprodutível).
 *
 * NÃO lê labels nem outputs de candidatos.
 */

import { createHash } from "node:crypto"
import type { Split, Stratum } from "./pilot2-composition"

function sha256(o: unknown): string {
  return createHash("sha256").update(typeof o === "string" ? o : JSON.stringify(o)).digest("hex")
}

// ── base-2: assinatura de CONTEÚDO (independente de captured_at) ──────────────

export interface Base2WorkEntry {
  workId: string
  canonicalSynopsis: string
  tags: string[]
  split: Split
  stratum: Stratum
}

/**
 * Assinatura do CONTEÚDO das 90 obras do base-2. Determinística e INDEPENDENTE de
 * `captured_at`/ordem (ordena por work_id; hasheia sinopse/tags/split/stratum).
 */
export function computeBase2ContentSignature(works: Base2WorkEntry[]): string {
  const canon = [...works]
    .sort((a, b) => a.workId.localeCompare(b.workId))
    .map((e) => ({ id: e.workId, syn: sha256(e.canonicalSynopsis || ""), tags: [...e.tags].sort(), split: e.split, stratum: e.stratum }))
  return sha256(JSON.stringify(canon))
}

// ── base-2 ↔ manifesto pilot-2: assinatura de VÍNCULO ────────────────────────

export interface Base2BindingInput {
  goldenVersion: string
  baseSnapshotVersion: string
  base2Signature: string
  base2FileSha256: string
  pilot2ManifestSha256: string
  selectionListHash: string
  repeatsListHash: string
  base1Signature: string
  tasteProfileVersion: string
}

/**
 * Liga o base-2 à assinatura ÍNTEGRA do manifesto do pilot-2 (que contém os 100 slots) +
 * às hashes de seleção/repeats + base-1 + perfil. Garante que o base-2 (que guarda 90 obras,
 * não 100 slots) referencie a estrutura completa.
 */
export function computeBase2BindingSignature(input: Base2BindingInput): string {
  return sha256({
    goldenVersion: input.goldenVersion,
    baseSnapshotVersion: input.baseSnapshotVersion,
    base2Signature: input.base2Signature,
    base2FileSha256: input.base2FileSha256,
    pilot2ManifestSha256: input.pilot2ManifestSha256,
    selectionListHash: input.selectionListHash,
    repeatsListHash: input.repeatsListHash,
    base1Signature: input.base1Signature,
    tasteProfileVersion: input.tasteProfileVersion,
  })
}

// ── Mapa estrutural dos carryovers ────────────────────────────────────────────

export interface CarryoverMapEntry {
  workId: string
  pilot1Slot: string
  pilot2Slot: string
  split: Split
  stratum: Stratum
  origin: "carryover"
  displaySignature: string
}

/** Assinatura do mapa de carryovers (por work_id; sem labels). */
export function computeCarryoverMapSignature(entries: CarryoverMapEntry[]): string {
  const canon = [...entries]
    .sort((a, b) => a.workId.localeCompare(b.workId))
    .map((e) => [e.workId, e.pilot1Slot, e.pilot2Slot, e.split, e.stratum, e.displaySignature])
  return sha256({ n: canon.length, items: canon })
}

/** Valida o mapa: 51 entradas, work_ids únicos, todos origin=carryover, sem repeats. */
export function validateCarryoverMap(entries: CarryoverMapEntry[]): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (entries.length !== 51) errors.push(`esperado 51 carryovers, achou ${entries.length}`)
  if (new Set(entries.map((e) => e.workId)).size !== entries.length) errors.push("work_id duplicado no mapa")
  if (entries.some((e) => e.origin !== "carryover")) errors.push("entrada com origin != carryover")
  if (entries.some((e) => !e.displaySignature || e.displaySignature.length !== 64)) errors.push("displaySignature ausente/curta")
  return { ok: errors.length === 0, errors }
}

// ── Escopo do plano de digests ────────────────────────────────────────────────

export interface DigestPlanItem {
  workId: string
  state: string
  scale: number
  reviewCorpusSignature: string
  likelyUsd: number
  upperBoundUsd: number
}

/**
 * O plano deve conter SOMENTE obras novas com reviews úteis. Reporta violações: carryover,
 * no_reviews, fora do pilot-2, ou scale ≤ 0.
 */
export function digestPlanScopeIssues(
  items: DigestPlanItem[],
  ctx: { carryoverIds: Set<string>; noReviewsIds: Set<string>; pilot2NewIds: Set<string> },
): string[] {
  const issues: string[] = []
  for (const it of items) {
    if (ctx.carryoverIds.has(it.workId)) issues.push(`carryover no plano: ${it.workId}`)
    if (ctx.noReviewsIds.has(it.workId)) issues.push(`no_reviews no plano: ${it.workId}`)
    if (!ctx.pilot2NewIds.has(it.workId)) issues.push(`fora das 39 novas: ${it.workId}`)
    if (it.scale <= 0) issues.push(`scale<=0: ${it.workId}`)
  }
  return issues
}

/** Soma de custo por obra → agregado (deve bater com o total do planner). */
export function sumPerWorkCost(items: Array<{ likelyUsd: number; upperBoundUsd: number }>): { likelyUsd: number; upperBoundUsd: number } {
  return items.reduce(
    (a, i) => ({ likelyUsd: a.likelyUsd + i.likelyUsd, upperBoundUsd: a.upperBoundUsd + i.upperBoundUsd }),
    { likelyUsd: 0, upperBoundUsd: 0 },
  )
}

// ── plan_changed ──────────────────────────────────────────────────────────────

/**
 * `true` ⇒ a execução futura deve recusar (corpus/seleção mudou). Compara a assinatura
 * gravada com a atual.
 */
export function planChanged(recordedSignature: string, currentSignature: string): boolean {
  return recordedSignature !== currentSignature
}

/** Assinatura do plano de digests (espelha o planGoldenDigestBatch: versões + corpus por obra). */
export function computeDigestPlanSignature(input: {
  versions: Record<string, unknown>
  base2Signature: string
  pilot2ManifestSha256: string
  eligible: Array<{ workId: string; reviewCorpusSignature: string }>
}): string {
  return sha256({
    versions: input.versions,
    base2Signature: input.base2Signature,
    pilot2ManifestSha256: input.pilot2ManifestSha256,
    eligible: [...input.eligible].sort((a, b) => a.workId.localeCompare(b.workId)).map((e) => [e.workId, e.reviewCorpusSignature]),
  })
}

// ── Status de SUPERSESSÃO do plano/base-2 (B2.2N) ────────────────────────────
// O `pilot2-audit` segue sendo o AUDITOR HISTÓRICO do protocolo v0: reproduz base-2 e a
// `planSignature 295fe2d6…` EXATAMENTE (sem `text-only-v1` no hash). Mas a política de corpus
// mudou (v0 → text-only-v1), então o artefato está SUPERSEDED. Este status é de SAÍDA: NÃO
// entra em `computeDigestPlanSignature` (não muda o hash, não impede a reprodução de 295fe2d6),
// e marca explicitamente que o plano NÃO é vigente/executável.

export interface DigestPlanArtifactStatus {
  artifactStatus: "superseded"
  /** política sob a qual o artefato foi congelado. */
  corpusPolicyVersion: "v0"
  /** política vigente que o aposenta. */
  supersededBy: "text-only-v1"
  executable: false
  reason: string
}

export const DIGEST_PLAN_ARTIFACT_STATUS: DigestPlanArtifactStatus = {
  artifactStatus: "superseded",
  corpusPolicyVersion: "v0",
  supersededBy: "text-only-v1",
  executable: false,
  reason: "corpus policy changed; regenerate base-2r1 and digest plan",
}

/**
 * Visão histórica do plano: a `planSignature` v0 (inalterada) + o status de supersessão (de
 * SAÍDA). Prova por construção que o status é SEPARADO do hash — `planSignature` é exatamente
 * `computeDigestPlanSignature(input)`, sem qualquer campo de política.
 */
export function buildHistoricalDigestPlanView(input: {
  versions: Record<string, unknown>
  base2Signature: string
  pilot2ManifestSha256: string
  eligible: Array<{ workId: string; reviewCorpusSignature: string }>
}): { planSignature: string; status: DigestPlanArtifactStatus } {
  return { planSignature: computeDigestPlanSignature(input), status: DIGEST_PLAN_ARTIFACT_STATUS }
}

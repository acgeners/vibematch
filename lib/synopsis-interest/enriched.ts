/**
 * Snapshot ENRIQUECIDO (`enriched-1`) do golden contextual (Plano 3 Fase B2.2C).
 * PURO: deriva ESTRITAMENTE de `base-1` (campos de trabalho congelados) + o digest
 * SANITIZADO. Sem banco, sem LLM, sem `server-only`. Estados: `digest_available` |
 * `no_reviews_available` (NÃO existe `summary_fallback` nesta versão).
 */

import { createHash } from "node:crypto"
import {
  CANDIDATES,
  computeCandidateInputSignature,
  type WorkSnapshotInput,
  type TagContextType,
} from "./experiment"
import { selectContextualTags, sanitizeDigestForLabeling, type ContextualTag, type SanitizedDigest } from "./contextual-package"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"

export const ENRICHED_SNAPSHOT_VERSION = "enriched-1"
export const CONTEXTUAL_PACKAGE_VERSION = "contextual-1"
export const TARGET_CONSTRUCT = "contextual-work-interest-v1"

function sha256(obj: unknown): string {
  return createHash("sha256").update(typeof obj === "string" ? obj : JSON.stringify(obj)).digest("hex")
}

export type EnrichedReviewContext = "digest_available" | "no_reviews_available"

/** Campos do base-1 que o enriched-1 carrega (congelados; NÃO relidos do banco). */
export interface BaseWorkRef {
  workId: string
  slots: Array<{ slotKey: string; isRepeat: boolean; repeatOf: string | null }>
  split: "development" | "holdout"
  stratum: string
  title: string
  canonicalSynopsis: string
  tags: string[]
  tagContextType: TagContextType
  titleSignature: string
  synopsisSignature: string
  tagsSignature: string
  tasteProfileSignature: string
  reviewCorpusSignature: string
  baseInputSignature: string
  reviewState: "frozen_current" | "no_reviews" | "no_reviews_available"
}

export interface EnrichedWork {
  workId: string
  slots: Array<{ slotKey: string; isRepeat: boolean; repeatOf: string | null }>
  split: "development" | "holdout"
  stratum: string
  // congelados (carregados de base-1)
  tagContextType: TagContextType
  titleSignature: string
  synopsisSignature: string
  tagsSignature: string
  tasteProfileSignature: string
  reviewCorpusSignature: string
  baseInputSignature: string
  // enriquecido
  reviewContext: EnrichedReviewContext
  /** Tags contextuais selecionadas (nomes) — para exibição. */
  contextualTags: string[]
  sanitizedDigest: SanitizedDigest | null
  rawDigestSignature: string | null
  sanitizedDigestSignature: string | null
  reviewContextSignature: string
  enrichedInputSignature: string
}

/**
 * Constrói o registro enriquecido de UMA obra a partir do base-1 + (se houver) o
 * digest BRUTO. Sanitiza o digest e calcula as assinaturas. `tagGroupOf` mapeia
 * nome→grupo a partir do catálogo ESTÁTICO (não do banco) p/ a política de tags.
 * Lança se `digest_available` mas o digest estiver ausente/ inválido.
 */
export function buildEnrichedWork(
  base: BaseWorkRef,
  rawDigest: ReviewDigest | null,
  tagGroupOf: (name: string) => string | null,
): EnrichedWork {
  const reviewContext: EnrichedReviewContext = base.reviewState === "frozen_current" ? "digest_available" : "no_reviews_available"
  const contextualTags = selectContextualTags(base.tags.map((n) => ({ name: n, group: tagGroupOf(n) } as ContextualTag))).map((t) => t.name)

  let sanitizedDigest: SanitizedDigest | null = null
  let rawDigestSignature: string | null = null
  let sanitizedDigestSignature: string | null = null
  let reviewContextSignature: string
  let reviewContextTypeForSig: WorkSnapshotInput["reviewContextType"]

  if (reviewContext === "digest_available") {
    if (!rawDigest || !Array.isArray(rawDigest.salient_traits) || typeof rawDigest.consensus !== "string") {
      throw new Error(`${base.workId}: digest_available mas digest ausente/inválido — NÃO usar summary; exige base-2/regerar`)
    }
    sanitizedDigest = sanitizeDigestForLabeling(rawDigest)
    rawDigestSignature = sha256(rawDigest)
    sanitizedDigestSignature = sha256(sanitizedDigest)
    reviewContextSignature = `digest:${sanitizedDigestSignature}`
    reviewContextTypeForSig = "digest"
  } else {
    reviewContextSignature = "no_reviews_available"
    reviewContextTypeForSig = "no_reviews"
  }

  const workSnap: WorkSnapshotInput = {
    workId: base.workId,
    titleSig: base.titleSignature,
    synopsisSig: base.synopsisSignature,
    tagsSig: base.tagsSignature,
    profileSig: base.tasteProfileSignature,
    reviewContextType: reviewContextTypeForSig,
    reviewContextSig: reviewContextSignature,
  }
  const enrichedInputSignature = computeCandidateInputSignature(CANDIDATES.e1, workSnap)

  return {
    workId: base.workId,
    slots: [...base.slots].sort((a, b) => a.slotKey.localeCompare(b.slotKey)),
    split: base.split,
    stratum: base.stratum,
    tagContextType: base.tagContextType,
    titleSignature: base.titleSignature,
    synopsisSignature: base.synopsisSignature,
    tagsSignature: base.tagsSignature,
    tasteProfileSignature: base.tasteProfileSignature,
    reviewCorpusSignature: base.reviewCorpusSignature,
    baseInputSignature: base.baseInputSignature,
    reviewContext,
    contextualTags,
    sanitizedDigest,
    rawDigestSignature,
    sanitizedDigestSignature,
    reviewContextSignature,
    enrichedInputSignature,
  }
}

export interface EnrichedSnapshot {
  versions: {
    experimentVersion: string
    goldenVersion: string
    baseSnapshotVersion: string
    enrichedSnapshotVersion: string
    contextualPackageVersion: string
    targetConstruct: string
    tasteProfileVersion: string
    digestVersion: string
    schemaVersion: string
  }
  capturedAt: string
  baseSnapshotSignature: string
  reviewCorpusSignature: string
  works: EnrichedWork[]
  enrichedSnapshotSignature: string
  sanitizedDigestCorpusSignature: string
}

export function buildEnrichedSnapshot(
  baseWorks: BaseWorkRef[],
  digestByWork: Map<string, ReviewDigest | null>,
  tagGroupOf: (name: string) => string | null,
  base: { snapshotBaseSignature: string; reviewCorpusSignature: string },
  capturedAt: string,
): EnrichedSnapshot {
  const works = baseWorks
    .map((b) => buildEnrichedWork(b, digestByWork.get(b.workId) ?? null, tagGroupOf))
    .sort((a, b) => a.workId.localeCompare(b.workId))

  // Assinatura order-independent: deriva de base + enriquecimento (sem capturedAt).
  const perWork = works.map((w) => ({
    workId: w.workId,
    baseInputSignature: w.baseInputSignature, // amarra à base congelada
    reviewCorpusSignature: w.reviewCorpusSignature,
    tagsSignature: w.tagsSignature,
    contextualTags: w.contextualTags,
    reviewContext: w.reviewContext,
    sanitizedDigestSignature: w.sanitizedDigestSignature,
    enrichedInputSignature: w.enrichedInputSignature,
  }))
  const enrichedSnapshotSignature = sha256({
    base: base.snapshotBaseSignature,
    reviewCorpus: base.reviewCorpusSignature,
    enrichedVersion: ENRICHED_SNAPSHOT_VERSION,
    construct: TARGET_CONSTRUCT,
    works: perWork,
  })
  const sanitizedDigestCorpusSignature = sha256(
    works
      .filter((w) => w.sanitizedDigestSignature)
      .map((w) => [w.workId, w.sanitizedDigestSignature])
      .sort((a, b) => (a[0] as string).localeCompare(b[0] as string)),
  )

  return {
    versions: {
      experimentVersion: "digest-exp-1",
      goldenVersion: "pilot-1",
      baseSnapshotVersion: "base-1",
      enrichedSnapshotVersion: ENRICHED_SNAPSHOT_VERSION,
      contextualPackageVersion: CONTEXTUAL_PACKAGE_VERSION,
      targetConstruct: TARGET_CONSTRUCT,
      tasteProfileVersion: "v7",
      digestVersion: "digest-v1",
      schemaVersion: "v1",
    },
    capturedAt,
    baseSnapshotSignature: base.snapshotBaseSignature,
    reviewCorpusSignature: base.reviewCorpusSignature,
    works,
    enrichedSnapshotSignature,
    sanitizedDigestCorpusSignature,
  }
}

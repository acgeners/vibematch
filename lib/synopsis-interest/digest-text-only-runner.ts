/**
 * Plano 3 Fase B2.2Q (+fix) — Runner EXPERIMENTAL do digest `text-only-v1` + storage local. Lógica
 * pura com IO INJETÁVEL (adapter de modelo + filesystem). NESTA FASE: só roda com adapter FALSO nos
 * testes — NÃO conecta CLI ao adapter real, NÃO chama LLM, NÃO grava no banco.
 *
 * GUARD ARQUITETURAL: este módulo NUNCA importa o executor de PRODUÇÃO source-aware
 * (`ensureReviewDigest`/`persistReviewDigest`/`consolidateReviewsDigestDetailed`) nem
 * `works.review_digest*`. NÃO lê store pessoal/labels/status/scores/predictions/ranking/candidate/
 * alignment. O adapter REAL vive em módulo separado (`digest-text-only-adapter.ts`) e NÃO é
 * importado aqui (sem chamada acidental).
 *
 * Storage: escrita ATÔMICA (temp → rename), IDEMPOTENTE (reusa output compatível por TODAS as
 * assinaturas), RETOMÁVEL por obra, e NÃO sobrescreve output válido incompatível (`conflict`).
 */

import * as nodeFsModule from "node:fs"
import {
  EXPERIMENT_DIGEST_VERSION,
  EXPERIMENT_DIGEST_PROMPT_VERSION,
  EXPERIMENT_DIGEST_SCHEMA_VERSION,
  EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION,
  EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION,
  EXPERIMENT_DIGEST_MODEL,
  EXPERIMENT_DIGEST_MAX_TOKENS,
  EXPERIMENT_DIGEST_TEMPERATURE_POLICY,
  EXPERIMENT_DIGEST_PRICING_VERSION,
  computeDigestContractSignature,
  computeDigestImplementationSignature,
  computeDigestInputSignature,
  computeDigestOutputSignature,
  computeDigestPromptCorpusSignature,
  buildTextOnlyDigestPrompt,
  selectTextOnly,
  checkFrozenInput,
  parseDigestOutput,
  type DigestModelAdapter,
  type TextOnlyDigest,
} from "@/lib/synopsis-interest/digest-text-only"

// ── Filesystem injetável ───────────────────────────────────────────────────────

export interface FsLike {
  exists(path: string): boolean
  readFile(path: string): string
  writeFile(path: string, content: string): void
  rename(from: string, to: string): void
  mkdirp(path: string): void
}

// ── Artefato por obra (§10/§12) ─────────────────────────────────────────────────

export type WorkDigestStatus = "succeeded" | "failed"

export interface WorkDigestArtifact {
  workId: string
  status: WorkDigestStatus
  base2Signature: string
  base2r1Signature: string
  corpusPolicyVersion: string
  selectionPolicyVersion: string
  reviewCorpusSignature: string
  digestSelectionSignature: string
  digestPromptCorpusSignature: string
  digestVersion: string
  promptVersion: string
  model: string
  schemaVersion: string
  maxTokens: number
  temperaturePolicy: string
  pricingVersion: string
  digestContractSignature: string
  digestImplementationSignature: string
  digestInputSignature: string
  digest?: TextOnlyDigest
  digestOutputSignature?: string
  error?: string
  createdAt: string // FORA das assinaturas
}

const DIGESTS_SUBDIR = "digests-text-only-v1"
const joinPath = (...parts: string[]): string => parts.join("/")
export const workArtifactPath = (baseDir: string): string => joinPath(baseDir, DIGESTS_SUBDIR, "works")
const workFile = (baseDir: string, workId: string): string => joinPath(workArtifactPath(baseDir), `${workId}.json`)

const stringify = (o: unknown): string => JSON.stringify(o, null, 2) + "\n"

/** Lê o artefato de uma obra (null se ausente/ilegível). */
export function readWorkArtifact(fs: FsLike, baseDir: string, workId: string): WorkDigestArtifact | null {
  const p = workFile(baseDir, workId)
  if (!fs.exists(p)) return null
  try {
    return JSON.parse(fs.readFile(p)) as WorkDigestArtifact
  } catch {
    return null
  }
}

/** Escrita ATÔMICA (temp → rename). */
export function writeWorkArtifactAtomic(fs: FsLike, baseDir: string, art: WorkDigestArtifact): void {
  fs.mkdirp(workArtifactPath(baseDir))
  const final = workFile(baseDir, art.workId)
  const tmp = `${final}.tmp`
  fs.writeFile(tmp, stringify(art))
  fs.rename(tmp, final)
}

/** Conjunto de assinaturas que travam reutilização/conflito (B2.2Q-fix §12). */
export interface ReuseSignatures {
  inputSig: string
  contractSig: string
  implSig: string
  promptCorpusSig: string
}

/** Reutilizável SÓ se succeeded + TODAS as 4 assinaturas baterem. */
export function isReusable(existing: WorkDigestArtifact | null, s: ReuseSignatures): boolean {
  return (
    !!existing &&
    existing.status === "succeeded" &&
    existing.digestInputSignature === s.inputSig &&
    existing.digestContractSignature === s.contractSig &&
    existing.digestImplementationSignature === s.implSig &&
    existing.digestPromptCorpusSignature === s.promptCorpusSig
  )
}

/** Incompatível (presente mas alguma assinatura diverge) — não reusar e NÃO sobrescrever. */
export function isIncompatible(existing: WorkDigestArtifact | null, s: ReuseSignatures): boolean {
  if (!existing) return false
  return (
    existing.digestInputSignature !== s.inputSig ||
    existing.digestContractSignature !== s.contractSig ||
    existing.digestImplementationSignature !== s.implSig ||
    existing.digestPromptCorpusSignature !== s.promptCorpusSig
  )
}

// ── Runner ──────────────────────────────────────────────────────────────────────

export type WorkOutcomeStatus =
  | "succeeded"
  | "failed"
  | "reused"
  | "input_changed"
  | "conflict"
  | "cancelled"
  | "stopped_by_cost"

export interface WorkOutcome {
  workId: string
  status: WorkOutcomeStatus
  reason?: string
  digestInputSignature?: string
  digestOutputSignature?: string
  digestPromptCorpusSignature?: string
}

export interface FrozenWork {
  workId: string
  reviewCorpusSignature: string
  digestSelectionSignature: string
  digestSelectionNormalizedHashes: string[]
}

export interface CurrentCorpus {
  reviewCorpusSignature: string
  digestSelectionSignature: string
  /** Reviews canônicas (já úteis+dedup) — para reconstruir a seleção text-only. */
  reviews: Array<{ text: string }>
}

export interface RunTextOnlyDigestDeps {
  baseDir: string
  base2Signature: string
  base2r1Signature: string
  scopeWorkIds: string[]
  frozen: Map<string, FrozenWork>
  /** Lê o corpus canônico ATUAL da obra (read-only). Injetado (DB real ou fake). */
  readCorpus: (workId: string) => Promise<CurrentCorpus>
  /** Adapter de modelo — OBRIGATÓRIO injetar (não há default real ⇒ sem chamada acidental). */
  adapter: DigestModelAdapter
  fs: FsLike
  now: () => string
  /** Soft-cap futuro (opcional). */
  maxCostUsd?: number
  estimateUsd?: (nReviews: number) => number
  shouldStop?: () => boolean
}

export interface RunReport {
  scope: number
  outcomes: WorkOutcome[]
  counts: Record<WorkOutcomeStatus, number>
  contractSignature: string
  implementationSignature: string
}

/**
 * Roda o lote experimental. Por obra: cancelamento → revalidação do input congelado → corpus EXATO
 * de prompt + assinaturas → reuso (4 assinaturas) → conflito se incompatível → soft-cap → adapter →
 * Zod → escrita atômica. Falha isolada por obra. O prompt é construído dos MESMOS textos usados na
 * `digestPromptCorpusSignature` (boundary único — §5).
 */
export async function runTextOnlyDigest(deps: RunTextOnlyDigestDeps): Promise<RunReport> {
  const contractSig = computeDigestContractSignature()
  const implSig = computeDigestImplementationSignature()
  const outcomes: WorkOutcome[] = []
  let accCost = 0

  for (const workId of deps.scopeWorkIds) {
    if (deps.shouldStop?.()) { outcomes.push({ workId, status: "cancelled" }); continue }

    const frozen = deps.frozen.get(workId)
    if (!frozen) { outcomes.push({ workId, status: "input_changed", reason: "obra ausente do base-2r1 congelado" }); continue }

    let current: CurrentCorpus
    try {
      current = await deps.readCorpus(workId)
    } catch (e) {
      outcomes.push({ workId, status: "failed", reason: `readCorpus: ${e instanceof Error ? e.message : String(e)}` })
      continue
    }

    // Seleção text-only ATUAL (caixa preservada) + revalidação contra o congelado.
    const selected = selectTextOnly(current.reviews)
    const promptTexts = selected.map((s) => s.promptText)
    const check = checkFrozenInput(
      { reviewCorpusSignature: frozen.reviewCorpusSignature, digestSelectionSignature: frozen.digestSelectionSignature, digestSelectionNormalizedHashes: frozen.digestSelectionNormalizedHashes },
      { reviewCorpusSignature: current.reviewCorpusSignature, digestSelectionSignature: current.digestSelectionSignature, selectedNormalizedHashes: selected.map((s) => s.normalizedHash) },
    )
    if (!check.ok) { outcomes.push({ workId, status: "input_changed", reason: check.detail }); continue }

    // Corpus EXATO de prompt + assinaturas (boundary único).
    const promptCorpusSig = computeDigestPromptCorpusSignature(promptTexts)
    const inputSig = computeDigestInputSignature({
      workId,
      base2r1Signature: deps.base2r1Signature,
      reviewCorpusSignature: frozen.reviewCorpusSignature,
      digestSelectionSignature: frozen.digestSelectionSignature,
      digestPromptCorpusSignature: promptCorpusSig,
      digestContractSignature: contractSig,
    })
    const sigs: ReuseSignatures = { inputSig, contractSig, implSig, promptCorpusSig }

    const existing = readWorkArtifact(deps.fs, deps.baseDir, workId)
    if (isReusable(existing, sigs)) {
      outcomes.push({ workId, status: "reused", digestInputSignature: inputSig, digestOutputSignature: existing!.digestOutputSignature, digestPromptCorpusSignature: promptCorpusSig })
      continue
    }
    if (isIncompatible(existing, sigs)) {
      outcomes.push({ workId, status: "conflict", reason: "output existente com assinatura divergente — não sobrescrito" })
      continue
    }

    if (deps.maxCostUsd != null && deps.estimateUsd) {
      const next = deps.estimateUsd(selected.length)
      if (accCost + next > deps.maxCostUsd) { outcomes.push({ workId, status: "stopped_by_cost" }); break }
      accCost += next
    }

    const { system, user } = buildTextOnlyDigestPrompt(promptTexts)
    let raw: unknown
    try {
      const out = await deps.adapter.generate({ system, user, model: EXPERIMENT_DIGEST_MODEL })
      raw = out.raw
    } catch (e) {
      writeFailed(deps, workId, frozen, sigs, `adapter: ${e instanceof Error ? e.message : String(e)}`)
      outcomes.push({ workId, status: "failed", reason: "adapter_error" })
      continue
    }

    const parsed = parseDigestOutput(raw)
    if (!parsed.ok) {
      writeFailed(deps, workId, frozen, sigs, `schema: ${parsed.error}`)
      outcomes.push({ workId, status: "failed", reason: "schema_invalid" })
      continue
    }

    const outputSig = computeDigestOutputSignature(inputSig, parsed.digest)
    writeWorkArtifactAtomic(deps.fs, deps.baseDir, baseArtifact(deps, workId, frozen, sigs, {
      status: "succeeded", digest: parsed.digest, digestOutputSignature: outputSig,
    }))
    outcomes.push({ workId, status: "succeeded", digestInputSignature: inputSig, digestOutputSignature: outputSig, digestPromptCorpusSignature: promptCorpusSig })
  }

  const counts = outcomes.reduce((acc, o) => { acc[o.status] = (acc[o.status] ?? 0) + 1; return acc }, {} as Record<WorkOutcomeStatus, number>)
  return { scope: deps.scopeWorkIds.length, outcomes, counts, contractSignature: contractSig, implementationSignature: implSig }
}

function baseArtifact(
  deps: RunTextOnlyDigestDeps,
  workId: string,
  frozen: FrozenWork,
  sigs: ReuseSignatures,
  extra: Partial<WorkDigestArtifact> & { status: WorkDigestStatus },
): WorkDigestArtifact {
  return {
    workId,
    status: extra.status,
    base2Signature: deps.base2Signature,
    base2r1Signature: deps.base2r1Signature,
    corpusPolicyVersion: EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION,
    selectionPolicyVersion: EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION,
    reviewCorpusSignature: frozen.reviewCorpusSignature,
    digestSelectionSignature: frozen.digestSelectionSignature,
    digestPromptCorpusSignature: sigs.promptCorpusSig,
    digestVersion: EXPERIMENT_DIGEST_VERSION,
    promptVersion: EXPERIMENT_DIGEST_PROMPT_VERSION,
    model: EXPERIMENT_DIGEST_MODEL,
    schemaVersion: EXPERIMENT_DIGEST_SCHEMA_VERSION,
    maxTokens: EXPERIMENT_DIGEST_MAX_TOKENS,
    temperaturePolicy: EXPERIMENT_DIGEST_TEMPERATURE_POLICY,
    pricingVersion: EXPERIMENT_DIGEST_PRICING_VERSION,
    digestContractSignature: sigs.contractSig,
    digestImplementationSignature: sigs.implSig,
    digestInputSignature: sigs.inputSig,
    digest: extra.digest,
    digestOutputSignature: extra.digestOutputSignature,
    error: extra.error,
    createdAt: deps.now(),
  }
}

function writeFailed(deps: RunTextOnlyDigestDeps, workId: string, frozen: FrozenWork, sigs: ReuseSignatures, error: string): void {
  writeWorkArtifactAtomic(deps.fs, deps.baseDir, baseArtifact(deps, workId, frozen, sigs, { status: "failed", error }))
}

// ── FS real (node) — usado pelo CLI futuro; testes usam fake em memória ──

export function nodeFs(): FsLike {
  return {
    exists: (p) => nodeFsModule.existsSync(p),
    readFile: (p) => nodeFsModule.readFileSync(p, "utf8"),
    writeFile: (p, c) => nodeFsModule.writeFileSync(p, c),
    rename: (a, b) => nodeFsModule.renameSync(a, b),
    mkdirp: (p) => { if (!nodeFsModule.existsSync(p)) nodeFsModule.mkdirSync(p, { recursive: true }) },
  }
}

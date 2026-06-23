/**
 * Plano 3 Fase B2.2S — Plano de EXECUÇÃO read-only dos digests text-only-v1 sob o base-2r1.
 * PURO: sem banco, sem rede, sem LLM, sem `server-only`. Define o tipo de entrada do plano e a
 * `planSignature` reprodutível. NÃO autoriza nem executa nada (a execução paga exige autorização
 * humana com a planSignature exata).
 */

import { createHash } from "node:crypto"

export const DIGEST_PLAN_VERSION = "digest-execution-plan-v1"

/** Uma obra a gerar (status sempre `planned` nesta fase). */
export interface DigestPlanEntry {
  workId: string
  /** Frozen do base-2r1. */
  reviewCorpusSignature: string
  /** Frozen do base-2r1. */
  digestSelectionSignature: string
  /** Corpus EXATO de prompt (caixa preservada), recomputado do corpus estável. */
  digestPromptCorpusSignature: string
  /** Vincula obra + base-2r1 + corpus/seleção + prompt + contrato. */
  digestInputSignature: string
  /** Global (igual para todas as obras). */
  digestContractSignature: string
  /** Global (igual para todas as obras). */
  digestImplementationSignature: string
  /** Úteis após dedupe (todas). */
  reviewCountCanonical: number
  /** ≤ cap efetivamente enviadas (min(canonical, cap)). */
  reviewCountSelected: number
  /** Estimativa (estimateStep): 1500 + 350×reviewCountSelected. */
  estimatedInputTokens: number
  /** Teto de saída do call (EXPERIMENT_DIGEST_MAX_TOKENS). */
  maxOutputTokens: number
  status: "planned"
}

/** Versões + assinaturas globais que prendem o plano à identidade de contrato/implementação. */
export interface DigestPlanVersions {
  planVersion: string
  base2Signature: string
  base2r1Signature: string
  reviewCorpusAggregateSignature: string
  digestSelectionAggregateSignature: string
  digestContractSignature: string
  digestImplementationSignature: string
  pricingVersion: string
  model: string
  maxTokens: number
  temperaturePolicy: string
}

/** Tetos PROPOSTOS (não autorizam execução). */
export interface DigestPlanCaps {
  softCapUsd: number
  hardCapUsd: number
}

/**
 * `planSignature` DETERMINÍSTICA. Inclui: versões + assinaturas globais + por obra
 * {workId, digestInputSignature, digestPromptCorpusSignature} (ordenado por workId) + tetos
 * propostos. EXCLUI: timestamp/mtime/caminhos locais/status operacional. Mesmos inputs ⇒ mesma
 * assinatura; mudar UMA digestInputSignature ⇒ assinatura diferente.
 */
export function computeDigestPlanSignature(
  versions: DigestPlanVersions,
  entries: DigestPlanEntry[],
  caps: DigestPlanCaps,
): string {
  const ordered = [...entries].sort((a, b) => (a.workId < b.workId ? -1 : a.workId > b.workId ? 1 : 0))
  return createHash("sha256")
    .update(
      JSON.stringify({
        kind: "digest-execution-plan",
        planVersion: versions.planVersion,
        base2Signature: versions.base2Signature,
        base2r1Signature: versions.base2r1Signature,
        reviewCorpusAggregateSignature: versions.reviewCorpusAggregateSignature,
        digestSelectionAggregateSignature: versions.digestSelectionAggregateSignature,
        digestContractSignature: versions.digestContractSignature,
        digestImplementationSignature: versions.digestImplementationSignature,
        pricingVersion: versions.pricingVersion,
        model: versions.model,
        maxTokens: versions.maxTokens,
        temperaturePolicy: versions.temperaturePolicy,
        softCapUsd: caps.softCapUsd,
        hardCapUsd: caps.hardCapUsd,
        entries: ordered.map((e) => [e.workId, e.digestInputSignature, e.digestPromptCorpusSignature]),
      }),
    )
    .digest("hex")
}

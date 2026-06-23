/**
 * Plano 3 — Assinatura de EQUIVALÊNCIA DE DISPLAY para reaproveitamento futuro de
 * labels (Fase B2.2D, Parte D). PURO: sem banco, sem rede, sem `server-only`.
 *
 * Objetivo (futuro, NÃO executado aqui): quando existir um `enriched-2`, decidir por
 * obra se o label humano já coletado em `enriched-1` pode ser **reaproveitado**:
 *
 *   assinatura idêntica  → o avaliador veria EXATAMENTE o mesmo conteúdo → reaproveitar
 *   assinatura divergente → a obra mudou de display → re-rotular
 *
 * A assinatura considera SOMENTE o que é mostrado ao avaliador no card contextual:
 *   sinopse canônica · tags após `selectContextualTags` · tipo de contexto de reviews ·
 *   digest sanitizado (ou ausência) · versão da rúbrica/target construct ·
 *   versões das políticas de seleção de tags e de sanitização.
 *
 * NÃO inclui: label humano · status de leitura · split · stratum · saída de candidato ·
 * previsão · work_id como conteúdo semântico. Independente da ORDEM das tags.
 */

import { createHash } from "node:crypto"
import type { SanitizedDigest } from "./contextual-package"
import { TAG_SELECTION_POLICY_VERSION, DIGEST_SANITIZATION_POLICY_VERSION } from "./contextual-package"
import type { EnrichedReviewContext } from "./enriched"
import { TARGET_CONSTRUCT } from "./enriched"
import { CONTEXTUAL_RUBRIC_VERSION } from "./contextual-html"

/** Namespacing da assinatura (bump se a FÓRMULA de canonicalização mudar). */
export const LABEL_DISPLAY_SIGNATURE_VERSION = "label-display-v1"

function sha256(obj: unknown): string {
  return createHash("sha256").update(typeof obj === "string" ? obj : JSON.stringify(obj)).digest("hex")
}

/** Conteúdo EXIBIDO ao avaliador no card contextual de uma obra. */
export interface LabelDisplayContent {
  /** Sinopse canônica, como exibida (verbatim). */
  synopsis: string
  /** Tags após `selectContextualTags` (nomes exibidos). A ordem NÃO importa. */
  contextualTags: string[]
  /** Tipo de contexto de reviews exibido. */
  reviewContextType: EnrichedReviewContext
  /** Digest sanitizado exibido, ou `null` quando `no_reviews_available`. */
  sanitizedDigest: SanitizedDigest | null
  /** Versão da rúbrica exibida. */
  rubricVersion: string
  /** Construto-alvo da rotulagem. */
  targetConstruct: string
  /** Versão da política de seleção de tags. */
  tagSelectionPolicyVersion: string
  /** Versão da política de sanitização do digest. */
  sanitizationPolicyVersion: string
}

/** Projeta o digest para forma canônica (preserva a ORDEM exibida dos traços). */
function canonicalDigest(d: SanitizedDigest | null): unknown {
  if (!d) return null
  return {
    traits: d.traits.map((t) => ({ trait: t.trait, polarity: t.polarity, axis: t.axis })),
    consensus: d.consensus,
    divergence: d.divergence,
    execution: d.execution,
    contentWarnings: [...d.contentWarnings],
  }
}

/**
 * Assinatura determinística do conteúdo exibido. Independente da ordem das tags
 * (ordena os nomes exibidos, sem alterar caixa — caixa diferente = display diferente).
 * NÃO lê label, status de leitura, split, stratum, candidato, previsão nem work_id.
 */
export function computeLabelDisplaySignature(c: LabelDisplayContent): string {
  const tags = [...c.contextualTags].map((t) => t.trim()).filter(Boolean).sort()
  return sha256({
    construct: LABEL_DISPLAY_SIGNATURE_VERSION,
    synopsis: c.synopsis,
    tags,
    reviewContextType: c.reviewContextType,
    digest: canonicalDigest(c.sanitizedDigest),
    rubricVersion: c.rubricVersion,
    targetConstruct: c.targetConstruct,
    tagSelectionPolicyVersion: c.tagSelectionPolicyVersion,
    sanitizationPolicyVersion: c.sanitizationPolicyVersion,
  })
}

/**
 * Monta o `LabelDisplayContent` injetando as versões CORRENTES de rúbrica/construto/
 * políticas (constantes do código). Use no loader para amarrar a assinatura ao estado
 * atual das políticas — mudar qualquer política muda a assinatura automaticamente.
 */
export function labelDisplayContentFromWork(p: {
  synopsis: string
  contextualTags: string[]
  reviewContextType: EnrichedReviewContext
  sanitizedDigest: SanitizedDigest | null
}): LabelDisplayContent {
  return {
    synopsis: p.synopsis,
    contextualTags: p.contextualTags,
    reviewContextType: p.reviewContextType,
    sanitizedDigest: p.sanitizedDigest,
    rubricVersion: CONTEXTUAL_RUBRIC_VERSION,
    targetConstruct: TARGET_CONSTRUCT,
    tagSelectionPolicyVersion: TAG_SELECTION_POLICY_VERSION,
    sanitizationPolicyVersion: DIGEST_SANITIZATION_POLICY_VERSION,
  }
}

/**
 * `true` ⇔ o avaliador veria conteúdo idêntico nos dois displays ⇒ o label de uma
 * obra **não lida** pode ser reaproveitado. Comparação puramente de display.
 */
export function isLabelReusable(a: LabelDisplayContent, b: LabelDisplayContent): boolean {
  return computeLabelDisplaySignature(a) === computeLabelDisplaySignature(b)
}

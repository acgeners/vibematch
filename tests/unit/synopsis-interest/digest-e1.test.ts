import { describe, it, expect } from "vitest"
import {
  formatDigestForPrompt,
  formatSanitizedDigestForPrompt,
} from "@/lib/synopsis-interest/contextual-package"
import {
  buildSynopsisQualityUserPrompt,
  E1_SYSTEM_ADDENDUM,
  PROMPT_VERSION,
  type PredictWorkInput,
} from "@/lib/ai-evaluation/synopsis-quality-predictor"
import { computeInterestInputSignature } from "@/lib/orchestration/integrations/synopsis-interest"
import type { ReviewDigest, TasteProfilePayload } from "@/lib/ai-recommendation/types"

const PROFILE: TasteProfilePayload = {
  loved_tags: [], avoided_tags: [], loved_themes: [], avoided_themes: [],
  criterion_preferences: {}, narrative_patterns: [], summary: "",
}

const DIGEST: ReviewDigest = {
  consensus: "protagonista carismatica e mundo bem construido",
  divergence: "alguns acham o ritmo do meio arrastado",
  salient_traits: [
    { trait: "protagonista calculista", polarity: "positive", axis: "personagens" },
    { trait: "ritmo lento no meio", polarity: "negative", axis: "ritmo" },
  ],
  content_warnings: ["violencia grafica"],
  execution: "arte consistente",
}

describe("Frente 3 — contrato e1 (digest no Interesse)", () => {
  it("PROMPT_VERSION foi bumpado para v3", () => {
    expect(PROMPT_VERSION).toBe("v3")
  })

  it("formatDigestForPrompt monta o bloco neutro com polaridade em PT", () => {
    const text = formatDigestForPrompt(DIGEST)!
    expect(text).toContain("Consenso: protagonista carismatica")
    expect(text).toContain("Divergências: alguns acham")
    expect(text).toContain("Traços recorrentes:")
    expect(text).toContain("protagonista calculista (positivo)")
    expect(text).toContain("ritmo lento no meio (negativo)")
    expect(text).toContain("Execução: arte consistente")
    expect(text).toContain("Avisos: violencia grafica")
  })

  it("formatDigestForPrompt = null sem digest ou digest vazio", () => {
    expect(formatDigestForPrompt(null)).toBeNull()
    expect(formatSanitizedDigestForPrompt({ traits: [], consensus: "", divergence: "", execution: "", contentWarnings: [] })).toBeNull()
  })

  it("buildSynopsisQualityUserPrompt: digestBlock presente só com reviewDigest (contrato CONTEXTO DE LEITORES)", () => {
    const base: PredictWorkInput = { id: "w1", title: "T", synopsis: "uma sinopse", tags: [] }
    const b1 = buildSynopsisQualityUserPrompt(PROFILE, base)
    expect(b1.digestBlock).toBeNull()

    const e1 = buildSynopsisQualityUserPrompt(PROFILE, { ...base, reviewDigest: formatDigestForPrompt(DIGEST) })
    expect(e1.digestBlock).toContain("CONTEXTO DE LEITORES (resumo agregado de reviews):")
    expect(e1.digestBlock).toContain("ritmo lento no meio (negativo)")
    // profileBlock/tailBlock idênticos entre b1 e e1 (digest é aditivo, não muda o resto)
    expect(e1.profileBlock).toBe(b1.profileBlock)
    expect(e1.tailBlock).toBe(b1.tailBlock)
  })

  it("E1_SYSTEM_ADDENDUM mantém a sinopse dominante", () => {
    expect(E1_SYSTEM_ADDENDUM).toContain("SINOPSE segue dominante")
    expect(E1_SYSTEM_ADDENDUM).toContain("COMPLEMENTAR")
  })

  it("assinatura de Interesse muda quando o digest entra/muda (extraSources)", () => {
    const common = {
      workId: "w1", profileSignature: "p", title: "T", synopsis: "uma sinopse",
      synopsisSource: "canonical" as const, tags: ["a"], model: "m", promptVersion: "v3", schemaVersion: "v1",
    }
    const noDigest = computeInterestInputSignature(common)
    const withA = computeInterestInputSignature({ ...common, extraSources: { reviewDigest: "AAA" } })
    const withB = computeInterestInputSignature({ ...common, extraSources: { reviewDigest: "BBB" } })
    expect(withA).not.toBe(noDigest)
    expect(withA).not.toBe(withB)
    // mesmo digest ⇒ assinatura estável
    expect(computeInterestInputSignature({ ...common, extraSources: { reviewDigest: "AAA" } })).toBe(withA)
  })
})

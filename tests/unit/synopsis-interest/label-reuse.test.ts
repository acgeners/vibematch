import { describe, it, expect } from "vitest"
import {
  computeLabelDisplaySignature,
  labelDisplayContentFromWork,
  isLabelReusable,
  type LabelDisplayContent,
} from "@/lib/synopsis-interest/label-reuse"
import type { SanitizedDigest } from "@/lib/synopsis-interest/contextual-package"

const digest: SanitizedDigest = {
  traits: [{ trait: "slow burn", polarity: "positive", axis: "pacing" }],
  consensus: "leitores acham envolvente",
  divergence: "alguns acham lento",
  execution: "arte consistente",
  contentWarnings: ["violência"],
}

function base(): LabelDisplayContent {
  return labelDisplayContentFromWork({
    synopsis: "uma duquesa e um lobo",
    contextualTags: ["Romance", "Strong Female Lead", "Fantasy"],
    reviewContextType: "digest_available",
    sanitizedDigest: digest,
  })
}

describe("label-reuse — assinatura de equivalência de display", () => {
  it("11. é independente da ORDEM das tags", () => {
    const a = base()
    const b: LabelDisplayContent = { ...base(), contextualTags: ["Fantasy", "Romance", "Strong Female Lead"] }
    expect(computeLabelDisplaySignature(a)).toBe(computeLabelDisplaySignature(b))
    expect(isLabelReusable(a, b)).toBe(true)
  })

  it("12a. muda quando a SINOPSE muda", () => {
    expect(computeLabelDisplaySignature(base())).not.toBe(
      computeLabelDisplaySignature({ ...base(), synopsis: "outra sinopse" }),
    )
  })
  it("12b. muda quando o CONJUNTO de tags muda", () => {
    expect(computeLabelDisplaySignature(base())).not.toBe(
      computeLabelDisplaySignature({ ...base(), contextualTags: ["Romance"] }),
    )
  })
  it("12c. muda quando o CONTEXTO de reviews muda (digest → no_reviews)", () => {
    expect(computeLabelDisplaySignature(base())).not.toBe(
      computeLabelDisplaySignature({ ...base(), reviewContextType: "no_reviews_available", sanitizedDigest: null }),
    )
  })
  it("12d. muda quando o DIGEST sanitizado muda", () => {
    expect(computeLabelDisplaySignature(base())).not.toBe(
      computeLabelDisplaySignature({ ...base(), sanitizedDigest: { ...digest, consensus: "outro consenso" } }),
    )
  })
  it("12e. muda quando a RÚBRICA muda", () => {
    expect(computeLabelDisplaySignature(base())).not.toBe(
      computeLabelDisplaySignature({ ...base(), rubricVersion: "rubric-contextual-v2" }),
    )
  })
  it("12f. muda quando a política de tags ou de sanitização muda", () => {
    expect(computeLabelDisplaySignature(base())).not.toBe(
      computeLabelDisplaySignature({ ...base(), tagSelectionPolicyVersion: "tag-select-v2" }),
    )
    expect(computeLabelDisplaySignature(base())).not.toBe(
      computeLabelDisplaySignature({ ...base(), sanitizationPolicyVersion: "digest-sanitize-v2" }),
    )
  })

  it("13. o LABEL humano (e status/split/stratum) NÃO participa da assinatura", () => {
    const a = base()
    const contaminated = {
      ...base(),
      humanLabel: "♥♥♥♥",
      readingStatus: "fully_read",
      split: "development",
      stratum: "♥♥♥♥",
      workId: "deadbeef",
      prediction: 9.9,
    } as unknown as LabelDisplayContent
    expect(computeLabelDisplaySignature(contaminated)).toBe(computeLabelDisplaySignature(a))
  })

  it("é determinística (mesma entrada → mesma saída) e injeta versões correntes", () => {
    expect(computeLabelDisplaySignature(base())).toBe(computeLabelDisplaySignature(base()))
    const c = base()
    expect(c.rubricVersion).toBeTruthy()
    expect(c.targetConstruct).toBeTruthy()
    expect(c.tagSelectionPolicyVersion).toBeTruthy()
    expect(c.sanitizationPolicyVersion).toBeTruthy()
  })
})

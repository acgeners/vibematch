import { describe, it, expect } from "vitest"
import {
  DIGEST_PLAN_VERSION,
  computeDigestPlanSignature,
  type DigestPlanEntry,
  type DigestPlanVersions,
} from "@/lib/synopsis-interest/digest-plan"

const versions: DigestPlanVersions = {
  planVersion: DIGEST_PLAN_VERSION,
  base2Signature: "B2",
  base2r1Signature: "B2R1",
  reviewCorpusAggregateSignature: "RCAGG",
  digestSelectionAggregateSignature: "DSAGG",
  digestContractSignature: "CT",
  digestImplementationSignature: "IMPL",
  pricingVersion: "anthropic-sonnet-4-6-pricing-v1",
  model: "claude-sonnet-4-6",
  maxTokens: 2000,
  temperaturePolicy: "explicit-0.2",
}
const caps = { softCapUsd: 3.22, hardCapUsd: 4.82 }
const entry = (workId: string, inputSig: string, promptSig: string): DigestPlanEntry => ({
  workId,
  reviewCorpusSignature: "rc-" + workId,
  digestSelectionSignature: "ds-" + workId,
  digestPromptCorpusSignature: promptSig,
  digestInputSignature: inputSig,
  digestContractSignature: "CT",
  digestImplementationSignature: "IMPL",
  reviewCountCanonical: 5,
  reviewCountSelected: 5,
  estimatedInputTokens: 1500 + 350 * 5,
  maxOutputTokens: 2000,
  status: "planned",
})
const base: DigestPlanEntry[] = [entry("w1", "in1", "pc1"), entry("w2", "in2", "pc2"), entry("w3", "in3", "pc3")]

describe("digest-plan — planSignature determinística (B2.2S §16)", () => {
  it("mesmos inputs ⇒ mesma planSignature (independe da ordem das entradas)", () => {
    const a = computeDigestPlanSignature(versions, base, caps)
    const b = computeDigestPlanSignature(versions, [...base].reverse(), caps)
    expect(a).toBe(b)
  })
  it("mudar UMA digestInputSignature ⇒ planSignature diferente", () => {
    const a = computeDigestPlanSignature(versions, base, caps)
    const mutated = base.map((e) => (e.workId === "w2" ? { ...e, digestInputSignature: "in2-CHANGED" } : e))
    expect(computeDigestPlanSignature(versions, mutated, caps)).not.toBe(a)
  })
  it("mudar UMA digestPromptCorpusSignature ⇒ planSignature diferente", () => {
    const a = computeDigestPlanSignature(versions, base, caps)
    const mutated = base.map((e) => (e.workId === "w1" ? { ...e, digestPromptCorpusSignature: "pc1-X" } : e))
    expect(computeDigestPlanSignature(versions, mutated, caps)).not.toBe(a)
  })
  it("mudar base2r1Signature / contrato / impl / caps ⇒ planSignature diferente", () => {
    const a = computeDigestPlanSignature(versions, base, caps)
    expect(computeDigestPlanSignature({ ...versions, base2r1Signature: "X" }, base, caps)).not.toBe(a)
    expect(computeDigestPlanSignature({ ...versions, digestContractSignature: "X" }, base, caps)).not.toBe(a)
    expect(computeDigestPlanSignature({ ...versions, digestImplementationSignature: "X" }, base, caps)).not.toBe(a)
    expect(computeDigestPlanSignature(versions, base, { softCapUsd: 9.99, hardCapUsd: 4.82 })).not.toBe(a)
  })
  it("NÃO depende de campos operacionais/estimativos por obra (só workId+inputSig+promptSig)", () => {
    const a = computeDigestPlanSignature(versions, base, caps)
    const noisy = base.map((e) => ({ ...e, reviewCountCanonical: 999, estimatedInputTokens: 1, maxOutputTokens: 1, reviewCountSelected: 1 }))
    expect(computeDigestPlanSignature(versions, noisy, caps)).toBe(a)
  })
})

import { describe, it, expect } from "vitest"
import {
  EXPERIMENT_DIGEST_VERSION,
  EXPERIMENT_DIGEST_PROMPT_VERSION,
  EXPERIMENT_DIGEST_SCHEMA_VERSION,
  EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION,
  EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION,
  EXPERIMENT_DIGEST_MODEL,
  EXPERIMENT_DIGEST_MAX_TOKENS,
  EXPERIMENT_DIGEST_TEMPERATURE,
  PROMPT_TEXT_CANONICALIZATION_VERSION,
  TEXT_ONLY_DIGEST_TOOL,
  canonicalizeReviewPromptText,
  buildTextOnlyDigestPromptBody,
  buildTextOnlyDigestPrompt,
  buildDigestModelRequest,
  extractDigestToolInput,
  selectTextOnly,
  parseDigestOutput,
  checkFrozenInput,
  canonicalizeDigest,
  computeDigestContractSignature,
  computeDigestImplementationSignature,
  computeDigestInputSignature,
  computeDigestOutputSignature,
  computeDigestPromptCorpusSignature,
  type TextOnlyDigest,
  type DigestInputSignatureArgs,
} from "@/lib/synopsis-interest/digest-text-only"
import { computeNormalizedTextHash, normalizeReviewText, compareCanonicalText } from "@/lib/synopsis-interest/canonical-review-corpus"

const PAD = " — texto sintético longo o suficiente para ser útil."
const goodDigest: TextOnlyDigest = {
  consensus: "c", divergence: "d", recurring_positives: ["p"], recurring_negatives: ["n"], narrative_traits: ["t"], content_warnings: [],
}
const inArgs = (over: Partial<DigestInputSignatureArgs> = {}): DigestInputSignatureArgs => ({
  workId: "w1", base2r1Signature: "B2R1", reviewCorpusSignature: "RC", digestSelectionSignature: "DS",
  digestPromptCorpusSignature: "PC", digestContractSignature: "CT", ...over,
})

describe("digest-text-only — versões congeladas", () => {
  it("valores explícitos e ≠ digest-v1", () => {
    expect(EXPERIMENT_DIGEST_VERSION).toBe("digest-text-only-v1")
    expect(EXPERIMENT_DIGEST_PROMPT_VERSION).toBe("digest-prompt-text-only-v1")
    expect(EXPERIMENT_DIGEST_SCHEMA_VERSION).toBe("review-digest-schema-v1")
    expect(EXPERIMENT_DIGEST_SELECTION_POLICY_VERSION).toBe("normalized-text-js-code-unit-order-cap40-v1")
    expect(EXPERIMENT_DIGEST_CORPUS_POLICY_VERSION).toBe("text-only-v1")
    expect(PROMPT_TEXT_CANONICALIZATION_VERSION).toBe("prompt-text-nfc-whitespace-preserve-case-v1")
    expect(EXPERIMENT_DIGEST_MODEL).toBe("claude-sonnet-4-6")
    expect(EXPERIMENT_DIGEST_MAX_TOKENS).toBe(2000)
  })
})

describe("digest-text-only — canonicalização preserva caixa (§3)", () => {
  it("preserva maiúsculas/pontuação; só colapsa whitespace; NFC; determinística", () => {
    const out = canonicalizeReviewPromptText("  Maria  encontrou\n\tJoão.  ")
    expect(out).toBe("Maria encontrou João.")
    expect(out).toBe(canonicalizeReviewPromptText("Maria encontrou João.")) // idempotente
  })
  it("normalizeReviewText (dedupe) lowercaseia; canonicalize NÃO", () => {
    expect(normalizeReviewText("Maria")).toBe("maria")
    expect(canonicalizeReviewPromptText("Maria")).toBe("Maria")
  })
})

describe("digest-text-only — prompt [Review N] sem metadados (§7)", () => {
  const body = buildTextOnlyDigestPromptBody(["Alpha review" + PAD, "Beta review" + PAD])
  it("usa [Review N] e NÃO usa source/origin/rating/IDs/#N", () => {
    expect(body).toContain("[Review 1]")
    expect(body).toContain("[Review 2]")
    expect(body).not.toMatch(/\[source|source:|origin:|rating|userRating|reviewId|external_review_id|http/i)
    expect(body).not.toMatch(/#\d/)
  })
  it("caixa preservada: 'Maria encontrou João.' mantém M e J maiúsculos", () => {
    const sel = selectTextOnly([{ text: "Maria encontrou João." + PAD }])
    const b = buildTextOnlyDigestPromptBody(sel.map((s) => s.promptText))
    expect(b).toContain("Maria encontrou João.")
  })
})

describe("digest-text-only — seleção + representante determinístico (§6/§7)", () => {
  it("dedup por normalizado, ordem por texto, cap 40", () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ text: `r${String(i).padStart(2, "0")}` + PAD }))
    const sel = selectTextOnly(many)
    expect(sel.length).toBe(40)
    const norms = sel.map((s) => normalizeReviewText(s.promptText))
    expect([...norms].sort(compareCanonicalText)).toEqual(norms) // ordem code-unit (locale-independente)
  })
  it("representante de duplicata = MENOR texto canônico (sem fonte/ID)", () => {
    // mesmo texto normalizado, caixas diferentes → representante é o menor lexicográfico
    const sel = selectTextOnly([{ text: "maria" + PAD }, { text: "Maria" + PAD }])
    expect(sel.length).toBe(1)
    expect(sel[0].promptText).toBe("Maria" + PAD) // 'M'(77) < 'm'(109)
  })
  it("mesma identidade normalizada (dedupe) MAS prompt corpus signature difere quando o display difere (§7)", () => {
    const upper = selectTextOnly([{ text: "Maria encontrou João." + PAD }])
    const lower = selectTextOnly([{ text: "maria encontrou joão." + PAD }])
    expect(upper[0].normalizedHash).toBe(lower[0].normalizedHash) // mesma identidade de dedupe
    const sUpper = computeDigestPromptCorpusSignature(upper.map((s) => s.promptText))
    const sLower = computeDigestPromptCorpusSignature(lower.map((s) => s.promptText))
    expect(sUpper).not.toBe(sLower) // bytes efetivos diferentes
  })
  it("normalizedHash bate com computeNormalizedTextHash", () => {
    const sel = selectTextOnly([{ text: "Texto MISTO" + PAD }])
    expect(sel[0].normalizedHash).toBe(computeNormalizedTextHash(sel[0].promptText))
  })
})

describe("digest-text-only — digestPromptCorpusSignature (§4)", () => {
  it("muda com caixa/bytes efetivos e com a ordem", () => {
    const a = computeDigestPromptCorpusSignature(["Alpha", "Beta"])
    expect(computeDigestPromptCorpusSignature(["alpha", "Beta"])).not.toBe(a) // caixa
    expect(computeDigestPromptCorpusSignature(["Beta", "Alpha"])).not.toBe(a) // ordem
    expect(computeDigestPromptCorpusSignature(["Alpha"])).not.toBe(a) // quantidade
  })
  it("independe de metadados (só os textos importam)", () => {
    // a função só recebe textos ⇒ source/id por construção não entram
    expect(computeDigestPromptCorpusSignature(["Alpha", "Beta"])).toBe(computeDigestPromptCorpusSignature(["Alpha", "Beta"]))
  })
})

describe("digest-text-only — schema (§8)", () => {
  it("output válido passa; canonicalização determinística", () => {
    expect(parseDigestOutput(goodDigest).ok).toBe(true)
    expect(canonicalizeDigest(goodDigest)).toBe(canonicalizeDigest({ ...goodDigest }))
  })
  it("output inválido falha (sem output parcial)", () => {
    expect(parseDigestOutput({ consensus: 1 }).ok).toBe(false)
    expect(parseDigestOutput({}).ok).toBe(false)
    expect(parseDigestOutput(null).ok).toBe(false)
  })
})

describe("digest-text-only — assinaturas (§9/§10)", () => {
  it("inputSignature inclui digestPromptCorpusSignature e digestContractSignature", () => {
    const base = computeDigestInputSignature(inArgs())
    expect(computeDigestInputSignature(inArgs({ digestPromptCorpusSignature: "OUTRO" }))).not.toBe(base)
    expect(computeDigestInputSignature(inArgs({ digestContractSignature: "OUTRO" }))).not.toBe(base)
    expect(computeDigestInputSignature(inArgs({ workId: "w2" }))).not.toBe(base)
    expect(computeDigestInputSignature(inArgs())).toBe(base) // determinística, sem timestamp/id
  })
  it("outputSignature vincula inputSignature + output canonicalizado", () => {
    const inSig = computeDigestInputSignature(inArgs())
    const o1 = computeDigestOutputSignature(inSig, goodDigest)
    expect(computeDigestOutputSignature(inSig, { ...goodDigest, consensus: "x" })).not.toBe(o1)
    expect(computeDigestOutputSignature("OUTRO", goodDigest)).not.toBe(o1)
  })
  it("contractSignature e implementationSignature são estáveis e distintos", () => {
    expect(computeDigestContractSignature()).toBe(computeDigestContractSignature())
    expect(computeDigestImplementationSignature()).toBe(computeDigestImplementationSignature())
    expect(computeDigestImplementationSignature()).not.toBe(computeDigestContractSignature())
  })
})

describe("digest-text-only — request builder (§8/§9 adapter)", () => {
  it("monta request com model/maxTokens/temperature/tool congelados", () => {
    const req = buildDigestModelRequest({ system: "S", user: "U", model: EXPERIMENT_DIGEST_MODEL })
    expect(req.model).toBe(EXPERIMENT_DIGEST_MODEL)
    expect(req.max_tokens).toBe(EXPERIMENT_DIGEST_MAX_TOKENS)
    expect(req.temperature).toBe(EXPERIMENT_DIGEST_TEMPERATURE)
    expect(req.system).toBe("S")
    expect(req.messages[0].content).toBe("U")
    expect(req.tools[0].name).toBe(TEXT_ONLY_DIGEST_TOOL.name)
    expect(req.tool_choice).toEqual({ type: "tool", name: TEXT_ONLY_DIGEST_TOOL.name })
  })
  it("extractDigestToolInput pega o input da tool; null se ausente", () => {
    const msg = { content: [{ type: "tool_use", name: TEXT_ONLY_DIGEST_TOOL.name, input: goodDigest }] }
    expect(extractDigestToolInput(msg)).toEqual(goodDigest)
    expect(extractDigestToolInput({ content: [{ type: "text" }] })).toBeNull()
    expect(extractDigestToolInput(null)).toBeNull()
  })
})

describe("digest-text-only — checkFrozenInput (§5/§6)", () => {
  const frozen = { reviewCorpusSignature: "RC", digestSelectionSignature: "DS", digestSelectionNormalizedHashes: ["h1", "h2"] }
  it("igual ⇒ ok; divergência ⇒ input_changed", () => {
    expect(checkFrozenInput(frozen, { reviewCorpusSignature: "RC", digestSelectionSignature: "DS", selectedNormalizedHashes: ["h1", "h2"] }).ok).toBe(true)
    expect(checkFrozenInput(frozen, { reviewCorpusSignature: "X", digestSelectionSignature: "DS", selectedNormalizedHashes: ["h1", "h2"] }).ok).toBe(false)
    expect(checkFrozenInput(frozen, { reviewCorpusSignature: "RC", digestSelectionSignature: "DS", selectedNormalizedHashes: ["h1", "X"] }).ok).toBe(false)
  })
})

describe("buildTextOnlyDigestPrompt — system text-only", () => {
  it("system instrui sem fonte/nota/recomendação", () => {
    const { system, user } = buildTextOnlyDigestPrompt(["A" + PAD])
    expect(system.length).toBeGreaterThan(0)
    expect(user).toContain("[Review 1]")
  })
})

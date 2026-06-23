import { describe, it, expect } from "vitest"
import {
  externalReviewInputSchema,
  EXTERNAL_REVIEW_SOURCES,
} from "@/lib/validations/external-review.schema"
import { prepareExternalReviewRow } from "@/lib/validations/external-review-row"
import { computeNormalizedTextHash, normalizeReviewText } from "@/lib/synopsis-interest/canonical-review-corpus"

const TXT = "Uma review externa razoavelmente longa para o teste de cobertura mínima."
const base = { source: "mangaupdates", text: TXT }

describe("external-review schema — text-only (só source + text)", () => {
  it("source obrigatório e dentro da lista; text obrigatório", () => {
    expect(externalReviewInputSchema.safeParse({ text: TXT }).success).toBe(false) // sem source
    expect(externalReviewInputSchema.safeParse({ source: "facebook", text: TXT }).success).toBe(false) // fonte inválida
    expect(externalReviewInputSchema.safeParse({ source: "anilist", text: "" }).success).toBe(false) // texto vazio
    expect(externalReviewInputSchema.safeParse(base).success).toBe(true)
    expect(EXTERNAL_REVIEW_SOURCES).toContain("anilist")
  })

  it("strictObject rejeita QUALQUER campo extra (metadados dropados na 114 + pessoais/calculados)", () => {
    for (const extra of [
      { sourceUrl: "https://x" }, { externalReviewId: "x" }, { reviewerName: "x" }, { language: "pt" }, { publishedAt: "2026-01-01" },
      { id: "x" }, { workId: "w" }, { normalizedTextHash: "h" }, { createdBy: "alguém" }, { createdAt: "2026-01-01" }, { updatedAt: "2026-01-01" },
      { origin: "manual_external" }, { userRating: 9 }, { note: "x" }, { interestLabel: "♥♥♥♥" }, { score: 8 }, { prediction: 7 },
    ]) {
      expect(externalReviewInputSchema.safeParse({ ...base, ...extra }).success, JSON.stringify(extra)).toBe(false)
    }
  })
})

describe("external-review schema — campos server-side e hash", () => {
  it("servidor calcula hash; createdBy default null; linha só com os campos restantes", () => {
    const { data } = prepareExternalReviewRow("w1", base)
    expect(data?.normalized_text_hash).toBe(computeNormalizedTextHash(TXT))
    expect(data?.created_by).toBeNull()
    expect(prepareExternalReviewRow("w1", base, { createdBy: "admin-session-id" }).data?.created_by).toBe("admin-session-id")
    expect(Object.keys(data ?? {}).sort()).toEqual(["created_by", "normalized_text_hash", "source", "text", "work_id"])
    // campo extra do client é rejeitado (strict) ⇒ data null
    expect(prepareExternalReviewRow("w1", { ...base, normalizedTextHash: "deadbeef" }).data).toBeNull()
  })
  it("hash tem exatamente 64 hex minúsculos", () => {
    expect(computeNormalizedTextHash(TXT)).toMatch(/^[0-9a-f]{64}$/)
  })
  it("texto < 40 chars é PERSISTÍVEL no schema (utilidade ≥40 fica no banco/isUsefulReviewText)", () => {
    const { data, error } = prepareExternalReviewRow("w1", { source: "comix", text: "curto" })
    expect(error).toBeNull()
    expect(data?.text).toBe("curto")
  })
})

describe("external-review schema — normalização do texto/hash", () => {
  it("espaços múltiplos / quebras de linha / maiúsculas → mesmo hash", () => {
    const a = "  Texto   COM\n\nESPAÇOS   e quebras  "
    const b = "texto com espaços e quebras"
    expect(normalizeReviewText(a)).toBe(normalizeReviewText(b))
    expect(computeNormalizedTextHash(a)).toBe(computeNormalizedTextHash(b))
  })
  it("Unicode equivalente (NFC vs NFD) → mesmo hash", () => {
    const nfc = "caf\u00e9 conteudo longo o suficiente para utilidade do digest e teste"
    const nfd = "cafe\u0301 conteudo longo o suficiente para utilidade do digest e teste"
    expect(nfc).not.toBe(nfd)
    expect(computeNormalizedTextHash(nfc)).toBe(computeNormalizedTextHash(nfd))
  })
  it("texto realmente diferente → hash diferente", () => {
    expect(computeNormalizedTextHash("alpha distinto")).not.toBe(computeNormalizedTextHash("beta distinto"))
  })
})

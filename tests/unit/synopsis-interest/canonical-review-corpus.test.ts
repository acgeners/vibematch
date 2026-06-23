import { describe, it, expect } from "vitest"
import {
  buildCanonicalReviewCorpus,
  workReviewsToCanonicalInput,
  computeDigestSelectionSignature,
  CANONICAL_REVIEW_CAP,
  REVIEW_CORPUS_POLICY_VERSION,
  type CanonicalReviewInput,
} from "@/lib/synopsis-interest/canonical-review-corpus"

const T = (n: number) => "x".repeat(Math.max(n, 0)) // texto de n chars
const ext = (id: string, source: string, text: string): CanonicalReviewInput => ({ reviewId: id, origin: "external_scraped", source, text })
const man = (id: string, source: string, text: string, url = "http://e/x"): CanonicalReviewInput => ({ reviewId: id, origin: "manual_external", source, sourceUrl: url, text })

describe("canonical-review-corpus", () => {
  it("1. só work_reviews (external_scraped)", () => {
    const c = buildCanonicalReviewCorpus([ext("a", "mangaupdates", T(50)), ext("b", "anilist", T(60))])
    expect(c.usefulCount).toBe(2)
    expect(c.reviews.every((r) => r.origin === "external_scraped")).toBe(true)
  })
  it("2. só manual_external", () => {
    const c = buildCanonicalReviewCorpus([man("a", "comix", T(50))])
    expect(c.usefulCount).toBe(1)
    expect(c.reviews[0].origin).toBe("manual_external")
    expect(c.reviews[0].sourceUrl).toBe("http://e/x")
  })
  it("3. combinação das duas", () => {
    const c = buildCanonicalReviewCorpus([ext("a", "anilist", T(50)), man("b", "comix", T(60))])
    expect(c.usefulCount).toBe(2)
  })
  it("4. texto < 40 chars é excluído", () => {
    const c = buildCanonicalReviewCorpus([ext("a", "x", T(39)), ext("b", "y", T(40))])
    expect(c.usefulCount).toBe(1)
    expect(c.reviews[0].reviewId).toBe("b")
  })
  it("5+6+14. duplicata entre tabelas é deduplicada e preserva TODA a proveniência", () => {
    const same = T(50)
    const c = buildCanonicalReviewCorpus([ext("a", "anilist", same), man("b", "comix", same)])
    expect(c.usefulCount).toBe(1)
    expect(c.reviews[0].provenance).toHaveLength(2)
    expect(c.reviews[0].provenance.map((p) => p.origin).sort()).toEqual(["external_scraped", "manual_external"])
  })
  it("7+8. ordem de entrada não altera corpus nem assinatura", () => {
    const a = [ext("a", "s1", T(50)), ext("b", "s2", T(60)), man("c", "s3", T(70))]
    const c1 = buildCanonicalReviewCorpus(a)
    const c2 = buildCanonicalReviewCorpus([...a].reverse())
    expect(c2.reviews.map((r) => r.reviewId)).toEqual(c1.reviews.map((r) => r.reviewId))
    expect(c2.corpusSignature).toBe(c1.corpusSignature)
  })
  it("9. alteração de texto altera a assinatura", () => {
    const s1 = buildCanonicalReviewCorpus([ext("a", "s", T(50))]).corpusSignature
    const s2 = buildCanonicalReviewCorpus([ext("a", "s", T(50) + " mais conteúdo distinto")]).corpusSignature
    expect(s2).not.toBe(s1)
  })
  it("text-only (B2.2N): fonte/origin/URL NÃO entram na assinatura — só o texto", () => {
    const txt = T(50)
    const base = buildCanonicalReviewCorpus([ext("a", "anilist", txt)]).corpusSignature
    // mesma review, fonte diferente → mesma assinatura
    expect(buildCanonicalReviewCorpus([ext("a", "mangaupdates", txt)]).corpusSignature).toBe(base)
    // mesma review, origin manual_external + URL → mesma assinatura
    expect(buildCanonicalReviewCorpus([man("a", "comix", txt, "http://outra/url")]).corpusSignature).toBe(base)
  })
  it("B2.2N: versão da política entra na assinatura — versões diferentes NÃO reutilizam", () => {
    const txt = T(50)
    const cur = buildCanonicalReviewCorpus([ext("a", "s", txt)]).corpusSignature // policy default
    const v1 = buildCanonicalReviewCorpus([ext("a", "s", txt)], { policyVersion: REVIEW_CORPUS_POLICY_VERSION }).corpusSignature
    const v2 = buildCanonicalReviewCorpus([ext("a", "s", txt)], { policyVersion: "text-only-v2" }).corpusSignature
    expect(cur).toBe(v1) // default == versão atual
    expect(v2).not.toBe(v1) // política diferente ⇒ assinatura diferente
  })
  it("text-only (B2.2N): a seleção das 40 (amostra) independe da fonte — ordenada por texto", () => {
    // mesmas reviews (mesmos textos), fontes embaralhadas → mesma amostra/ordem
    const texts = Array.from({ length: 5 }, (_, i) => `review distinta ${i} ` + T(40))
    const s1 = buildCanonicalReviewCorpus(texts.map((t, i) => ext(`id${i}`, `srcA${i}`, t)))
    const s2 = buildCanonicalReviewCorpus(texts.map((t, i) => ext(`id${i}`, `zzz${4 - i}`, t)))
    expect(s2.sample.map((r) => r.text)).toEqual(s1.sample.map((r) => r.text))
  })
  it("B2.2O-fix: reviewId NÃO altera a seleção/ordem (só o texto manda)", () => {
    const texts = Array.from({ length: 6 }, (_, i) => `review distinta ${i} ` + T(40))
    const s1 = buildCanonicalReviewCorpus(texts.map((t, i) => ext(`aaa${i}`, "s", t)))
    // mesmos textos, reviewIds em ordem inversa → mesma amostra e mesma assinatura de seleção
    const s2 = buildCanonicalReviewCorpus(texts.map((t, i) => ext(`zzz${9 - i}`, "s", t)))
    expect(s2.sample.map((r) => r.text)).toEqual(s1.sample.map((r) => r.text))
    expect(s2.digestSelectionSignature).toBe(s1.digestSelectionSignature)
  })
  it("B2.2O-fix: digestSelectionSignature = só policy + textos normalizados selecionados", () => {
    const txt = T(50)
    const a = buildCanonicalReviewCorpus([ext("a", "anilist", txt)])
    // fonte/origin/URL/id diferentes, MESMO texto → mesma digestSelectionSignature
    const b = buildCanonicalReviewCorpus([man("OUTRO_ID", "comix", txt, "http://outra/url")])
    expect(b.digestSelectionSignature).toBe(a.digestSelectionSignature)
    // bate com o helper puro
    expect(a.digestSelectionSignature).toBe(computeDigestSelectionSignature([txt.toLowerCase()]))
    // texto diferente → assinatura diferente
    const c = buildCanonicalReviewCorpus([ext("a", "anilist", txt + " distinto")])
    expect(c.digestSelectionSignature).not.toBe(a.digestSelectionSignature)
  })
  it("B2.2O-fix: digestSelectionSignature muda com a política do corpus", () => {
    const txt = T(50)
    const v1 = buildCanonicalReviewCorpus([ext("a", "s", txt)], { policyVersion: REVIEW_CORPUS_POLICY_VERSION }).digestSelectionSignature
    const v2 = buildCanonicalReviewCorpus([ext("a", "s", txt)], { policyVersion: "text-only-v2" }).digestSelectionSignature
    expect(v1).not.toBe(v2)
  })
  it("10. inclusão de review útil altera a assinatura; não-útil/excluída não", () => {
    const base = buildCanonicalReviewCorpus([ext("a", "s", T(50))])
    const added = buildCanonicalReviewCorpus([ext("a", "s", T(50)), ext("b", "s2", T(55))])
    expect(added.corpusSignature).not.toBe(base.corpusSignature)
    // adicionar uma review NÃO útil (curta) não muda a assinatura
    const withShort = buildCanonicalReviewCorpus([ext("a", "s", T(50)), ext("c", "s", T(10))])
    expect(withShort.corpusSignature).toBe(base.corpusSignature)
  })
  it("11. campos de opinião/label/status NÃO entram (type-safe; extras ignorados)", () => {
    const contaminated = { ...ext("a", "s", T(50)), userRating: 9, personalStatus: "reading", humanLabel: "♥♥♥♥", score: 8 } as unknown as CanonicalReviewInput
    const c = buildCanonicalReviewCorpus([contaminated])
    const json = JSON.stringify(c)
    expect(json).not.toMatch(/userRating|personalStatus|humanLabel|"score"|♥/)
    expect(c.reviews[0]).not.toHaveProperty("userRating")
  })
  it("13. teto máximo respeitado na amostra; reviews mantém todas", () => {
    const many = Array.from({ length: CANONICAL_REVIEW_CAP + 12 }, (_, i) => ext(`id${i}`, "s", T(45) + ` ${i}`))
    const c = buildCanonicalReviewCorpus(many)
    expect(c.usefulCount).toBe(CANONICAL_REVIEW_CAP + 12)
    expect(c.sample).toHaveLength(CANONICAL_REVIEW_CAP)
    expect(c.reviews).toHaveLength(CANONICAL_REVIEW_CAP + 12)
  })
  it("14b. corpus vazio → no_reviews_available", () => {
    expect(buildCanonicalReviewCorpus([]).state).toBe("no_reviews_available")
    expect(buildCanonicalReviewCorpus([ext("a", "s", T(10))]).state).toBe("no_reviews_available")
  })
  it("15. duas reviews não duplicadas satisfazem a cobertura mínima (>=2)", () => {
    const c = buildCanonicalReviewCorpus([ext("a", "s1", T(50)), ext("b", "s2", T(50) + " distinto")])
    expect(c.usefulCount).toBeGreaterThanOrEqual(2)
    expect(c.state).toBe("available")
  })
  it("texto exibido NÃO é normalizado (preserva original do representativo)", () => {
    const c = buildCanonicalReviewCorpus([ext("a", "s", "  Texto COM Maiúsculas e   espaços  " + T(40))])
    expect(c.reviews[0].text).toMatch(/Texto COM Maiúsculas/)
  })
  it("workReviewsToCanonicalInput mapeia origin=external_scraped", () => {
    const c = buildCanonicalReviewCorpus(workReviewsToCanonicalInput([{ id: "a", source: "MangaUpdates", text: T(50) }]))
    expect(c.reviews[0].origin).toBe("external_scraped")
    expect(c.reviews[0].source).toBe("mangaupdates")
  })
})

import { describe, it, expect } from "vitest"
import {
  buildEnrichedWork,
  buildEnrichedSnapshot,
  type BaseWorkRef,
} from "@/lib/synopsis-interest/enriched"
import {
  buildContextualHtml,
  buildContextualLabelsTemplateCsv,
  assertContextualHtmlOffline,
  computeContextualPackageSignature,
  contextualSha256Hex,
  NO_REVIEWS_MESSAGE,
  NO_TAGS_MESSAGE,
  type ContextualCard,
} from "@/lib/synopsis-interest/contextual-html"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"

const tagGroup = (name: string): string | null => {
  if (name === "Long Strip" || name === "Full Color") return "format"
  if (name === "misc") return "other"
  if (name === "Romance" || name === "romance") return "romance"
  return "themes"
}

function digest(over: Partial<ReviewDigest> = {}): ReviewDigest {
  return {
    consensus: "Leitores destacam o ritmo lento.",
    divergence: "Alguns acham o final fraco.",
    execution: "Arte consistente.",
    salient_traits: [{ trait: "Protagonista decidida", polarity: "positive", axis: "personagens" }],
    content_warnings: ["violência"],
    ...over,
  }
}

function base(over: Partial<BaseWorkRef> = {}): BaseWorkRef {
  return {
    workId: "w-1",
    slots: [{ slotKey: "S001", isRepeat: false, repeatOf: null }],
    split: "development",
    stratum: "♥♥♥",
    title: "Frozen Title",
    canonicalSynopsis: "A heroine navigates a slow burn romance.",
    tags: ["Romance", "Long Strip", "misc"], // Long Strip(format)/misc(other) excluídos
    tagContextType: "tags_present",
    titleSignature: "t", synopsisSignature: "s", tagsSignature: "g", tasteProfileSignature: "p",
    reviewCorpusSignature: "corpus", baseInputSignature: "binp", reviewState: "frozen_current",
    ...over,
  }
}

describe("enriched — buildEnrichedWork (deriva de base-1)", () => {
  it("digest_available: sanitiza, calcula assinaturas, tags contextuais filtradas", () => {
    const w = buildEnrichedWork(base(), digest(), tagGroup)
    expect(w.reviewContext).toBe("digest_available")
    expect(w.contextualTags).toEqual(["Romance"]) // format/other excluídos
    expect(w.sanitizedDigest).not.toBeNull()
    expect(w.sanitizedDigestSignature).toBeTruthy()
    expect(w.rawDigestSignature).toBeTruthy()
    // carrega congelados de base-1
    expect(w.baseInputSignature).toBe("binp")
    expect(w.tasteProfileSignature).toBe("p")
  })
  it("no_reviews_available: sem digest, contexto explícito", () => {
    const w = buildEnrichedWork(base({ reviewState: "no_reviews", tags: ["Romance"] }), null, tagGroup)
    expect(w.reviewContext).toBe("no_reviews_available")
    expect(w.sanitizedDigest).toBeNull()
    expect(w.reviewContextSignature).toBe("no_reviews_available")
  })
  it("digest_available SEM digest LANÇA (não usa summary fallback)", () => {
    expect(() => buildEnrichedWork(base(), null, tagGroup)).toThrow(/digest_available mas digest/)
  })
  it("S078: tag_context preservado, tags=[] → contextualTags vazio", () => {
    const w = buildEnrichedWork(base({ tagContextType: "missing_recoverable_frozen_empty", tags: [] }), digest(), tagGroup)
    expect(w.tagContextType).toBe("missing_recoverable_frozen_empty")
    expect(w.contextualTags).toEqual([])
  })
  it("mudança do digest bruto muda a assinatura sanitizada e a enriquecida", () => {
    const a = buildEnrichedWork(base(), digest(), tagGroup)
    const b = buildEnrichedWork(base(), digest({ consensus: "Outro consenso." }), tagGroup)
    expect(a.sanitizedDigestSignature).not.toBe(b.sanitizedDigestSignature)
    expect(a.enrichedInputSignature).not.toBe(b.enrichedInputSignature)
  })
})

describe("enriched — buildEnrichedSnapshot", () => {
  const works = [base({ workId: "w-2", slots: [{ slotKey: "S002", isRepeat: false, repeatOf: null }] }), base({ workId: "w-1" })]
  const digestByWork = new Map<string, ReviewDigest | null>([["w-1", digest()], ["w-2", digest()]])
  const baseSig = { snapshotBaseSignature: "BASE634571", reviewCorpusSignature: "CORPUS8776" }

  it("ordena por workId; determinístico e order-independent", () => {
    const a = buildEnrichedSnapshot(works, digestByWork, tagGroup, baseSig, "t1")
    const b = buildEnrichedSnapshot([...works].reverse(), digestByWork, tagGroup, baseSig, "t2")
    expect(a.works.map((w) => w.workId)).toEqual(["w-1", "w-2"])
    expect(a.enrichedSnapshotSignature).toBe(b.enrichedSnapshotSignature) // capturedAt não entra
  })
  it("carrega baseSnapshotSignature/reviewCorpusSignature de base-1", () => {
    const e = buildEnrichedSnapshot(works, digestByWork, tagGroup, baseSig, "t")
    expect(e.baseSnapshotSignature).toBe("BASE634571")
    expect(e.reviewCorpusSignature).toBe("CORPUS8776")
  })
  it("mudança no review corpus (base) muda a assinatura enriquecida", () => {
    const a = buildEnrichedSnapshot(works, digestByWork, tagGroup, baseSig, "t").enrichedSnapshotSignature
    const b = buildEnrichedSnapshot(works, digestByWork, tagGroup, { ...baseSig, reviewCorpusSignature: "CHANGED" }, "t").enrichedSnapshotSignature
    expect(a).not.toBe(b)
  })
})

describe("contextual-html — pacote cego", () => {
  function card(over: Partial<ContextualCard> = {}): ContextualCard {
    return { slotKey: "S001", shuffleOrder: 1, synopsis: "Uma heroína corajosa.", tagContextType: "tags_present", contextualTags: ["Romance"], reviewContext: "digest_available", sanitizedDigest: { traits: [{ trait: "FL forte", polarity: "positive", axis: "personagens" }], consensus: "Ritmo lento.", divergence: "Final divide.", execution: "Arte boa.", contentWarnings: ["violência"] }, ...over }
  }
  const meta = { experimentVersion: "digest-exp-1", goldenVersion: "pilot-1", enrichedVersion: "enriched-1" }

  it("mostra SINOPSE/ELEMENTOS/CONTEXTO; NÃO mostra título nem work_id", () => {
    const html = buildContextualHtml([card()], meta)
    expect(html).toMatch(/SINOPSE/)
    expect(html).toMatch(/ELEMENTOS DA OBRA/)
    expect(html).toMatch(/CONTEXTO DE LEITORES/)
    expect(html).not.toContain("Frozen Title")
    expect(html).not.toContain("w-1")
    expect(html).toContain("Romance")
  })
  it("offline + sem leakage (work_ids/script/url)", () => {
    const html = buildContextualHtml([card()], meta)
    const v = assertContextualHtmlOffline(html, { workIds: ["1a8ec6b3-ad81-49f6-adb2-11e5ea9cb57f"] })
    expect(v.ok).toBe(true)
  })
  it("digest bruto NÃO aparece (só sanitizado); rúbrica contextual presente", () => {
    const html = buildContextualHtml([card()], meta)
    expect(html).toMatch(/Potencial de Interesse na Obra/)
    expect(html).toMatch(/Ritmo lento/) // sanitizado
  })
  it("no_reviews_available → mensagem neutra padronizada", () => {
    const html = buildContextualHtml([card({ reviewContext: "no_reviews_available", sanitizedDigest: null })], meta)
    expect(html).toContain(NO_REVIEWS_MESSAGE)
  })
  it("S078 → mensagem de elementos indisponíveis (não no_tags_legitimate)", () => {
    const html = buildContextualHtml([card({ tagContextType: "missing_recoverable_frozen_empty", contextualTags: [] })], meta)
    expect(html).toContain(NO_TAGS_MESSAGE)
  })
  it("ordem congelada (shuffleOrder); repetições com conteúdo idêntico", () => {
    const cards = [card({ slotKey: "S001", shuffleOrder: 2 }), card({ slotKey: "R001", shuffleOrder: 1 })]
    const html = buildContextualHtml(cards, meta)
    expect(html.indexOf("R001")).toBeLessThan(html.indexOf("S001"))
    expect(html).not.toMatch(/repeti|repeat/i)
  })
  it("detecta leakage: work_id injetado", () => {
    const bad = buildContextualHtml([card()], meta) + "<!-- 1a8ec6b3-ad81-49f6-adb2-11e5ea9cb57f -->"
    expect(assertContextualHtmlOffline(bad, { workIds: ["1a8ec6b3-ad81-49f6-adb2-11e5ea9cb57f"] }).ok).toBe(false)
  })
  it("NÃO falsa-positiva com termo técnico DENTRO da sinopse", () => {
    const html = buildContextualHtml([card({ synopsis: "A prediction model with alignment and personal_fit." })], meta)
    expect(assertContextualHtmlOffline(html, { workIds: [] }).ok).toBe(true)
  })
  it("CSV template vazio (slot_key,label)", () => {
    const csv = buildContextualLabelsTemplateCsv([card({ slotKey: "S001", shuffleOrder: 1 })])
    expect(csv.split("\n")[0]).toBe("slot_key,label")
    expect(csv).toContain("S001,")
    expect(csv).not.toMatch(/♥/)
  })
  it("packageSignature determinístico, order-independent nos slotKeys", () => {
    const html = buildContextualHtml([card()], meta)
    const csv = buildContextualLabelsTemplateCsv([card()])
    const a = computeContextualPackageSignature({ experimentVersion: "x", goldenVersion: "g", enrichedSnapshotVersion: "e1", contextualPackageVersion: "c1", enrichedSnapshotSignature: "snap", sanitizedDigestCorpusSignature: "sd", slotKeys: ["S001", "R001"], contextualHtmlSha256: contextualSha256Hex(html), contextualLabelsTemplateSha256: contextualSha256Hex(csv) })
    const b = computeContextualPackageSignature({ experimentVersion: "x", goldenVersion: "g", enrichedSnapshotVersion: "e1", contextualPackageVersion: "c1", enrichedSnapshotSignature: "snap", sanitizedDigestCorpusSignature: "sd", slotKeys: ["R001", "S001"], contextualHtmlSha256: contextualSha256Hex(html), contextualLabelsTemplateSha256: contextualSha256Hex(csv) })
    expect(a).toBe(b)
  })
})

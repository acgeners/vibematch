import { describe, it, expect } from "vitest"
import {
  selectContextualTags,
  selectContextualTagsByPriority,
  isLooksLeadTag,
  sanitizeDigestForLabeling,
  sanitizeTextOnlyDigestForLabeling,
  DEFAULT_EXCLUDED_TAG_GROUPS,
  MAX_CONTEXTUAL_TAGS,
  type ContextualTag,
} from "@/lib/synopsis-interest/contextual-package"
import type { TextOnlyDigest } from "@/lib/synopsis-interest/digest-text-only"
import {
  CANDIDATES,
  computeCandidateInputSignature,
  type WorkSnapshotInput,
} from "@/lib/synopsis-interest/experiment"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"

describe("contextual-package — selectContextualTags", () => {
  const tags: ContextualTag[] = [
    { name: "Romance", group: "romance" },
    { name: "Strong Female Lead", group: "female_lead" },
    { name: "Long Strip", group: "format" }, // excluído (estrutural)
    { name: "misc thing", group: "other" }, // excluído (ruído)
    { name: "romance", group: "romance" }, // duplicata semântica de "Romance"
  ]
  it("exclui grupos administrativos/estruturais (format, other)", () => {
    expect(DEFAULT_EXCLUDED_TAG_GROUPS.has("format")).toBe(true)
    const r = selectContextualTags(tags)
    expect(r.find((t) => t.group === "format")).toBeUndefined()
    expect(r.find((t) => t.group === "other")).toBeUndefined()
  })
  it("remove duplicatas semânticas (mesma chave normalizada)", () => {
    const r = selectContextualTags(tags)
    expect(r.filter((t) => t.name.toLowerCase() === "romance")).toHaveLength(1)
  })
  it("ordena canonicamente (grupo → nome) e é determinístico", () => {
    const a = selectContextualTags(tags)
    const b = selectContextualTags([...tags].reverse())
    expect(a).toEqual(b)
  })
  it("limita a MAX_CONTEXTUAL_TAGS", () => {
    const many: ContextualTag[] = Array.from({ length: 50 }, (_, i) => ({ name: `tag${i}`, group: "themes" }))
    expect(selectContextualTags(many).length).toBe(MAX_CONTEXTUAL_TAGS)
    expect(selectContextualTags(many, { maxTags: 5 }).length).toBe(5)
  })
  it("S078: [] → [] (display mostra mensagem neutra, não finge ausência legítima)", () => {
    expect(selectContextualTags([])).toEqual([])
  })
  it("não inventa tags (só normaliza/filtra)", () => {
    expect(selectContextualTags([{ name: "  ", group: "themes" }])).toEqual([])
  })
})

describe("contextual-package — sanitizeDigestForLabeling", () => {
  const digest: ReviewDigest = {
    consensus: "Leitores destacam o ritmo lento. Você vai amar! 9/10.",
    divergence: "Alguns acham o final fraco; recomendo mesmo assim.",
    execution: "Arte consistente, ★★★★ pela maioria.",
    salient_traits: [
      { trait: "Protagonista decidida (must-read)", polarity: "positive", axis: "personagens" },
      { trait: "Vilão raso", polarity: "negative", axis: "personagens" },
    ],
    content_warnings: ["violência gráfica"],
  }
  it("remove linguagem de recomendação e notas/estrelas", () => {
    const s = sanitizeDigestForLabeling(digest)
    expect(s.consensus).not.toMatch(/você vai amar/i)
    expect(s.consensus).not.toMatch(/9\/10/)
    expect(s.divergence).not.toMatch(/recomendo/i)
    expect(s.execution).not.toMatch(/★/)
    expect(s.traits[0]!.trait).not.toMatch(/must-read/i)
  })
  it("remove recomendação ACENTUADA (recomendável/recomendação) — fix B2.2C", () => {
    const d: ReviewDigest = {
      consensus: "Obra genuinamente boa e recomendável.",
      divergence: "Há recomendação ampla; alguns divergem.",
      execution: "Bem executada.",
      salient_traits: [{ trait: "Final recomendadíssimo", polarity: "positive", axis: "geral" }],
      content_warnings: [],
    }
    const s = sanitizeDigestForLabeling(d)
    expect(s.consensus).not.toMatch(/recomend/i)
    expect(s.divergence).not.toMatch(/recomend/i)
    expect(s.traits[0]!.trait).not.toMatch(/recomend/i)
    // mantém o conteúdo descritivo restante
    expect(s.consensus).toMatch(/genuinamente boa/)
  })
  it("preserva traços (positivos e negativos), polaridade, eixo e content_warnings", () => {
    const s = sanitizeDigestForLabeling(digest)
    expect(s.traits.map((t) => t.polarity)).toEqual(["positive", "negative"])
    expect(s.traits[1]!.axis).toBe("personagens")
    expect(s.contentWarnings).toEqual(["violência gráfica"])
    expect(s.consensus).toMatch(/ritmo lento/)
  })
})

describe("experiment — candidatos estendidos (S0/S1/D1/D2/b1/e1)", () => {
  function work(over: Partial<WorkSnapshotInput> = {}): WorkSnapshotInput {
    return {
      workId: "w", titleSig: "t", synopsisSig: "s", tagsSig: "g", profileSig: "p",
      reviewContextType: "digest", reviewContextSig: "rc", ...over,
    }
  }
  it("S0 (só sinopse) ignora perfil/tags/título", () => {
    const w = work()
    expect(computeCandidateInputSignature(CANDIDATES.s0, w)).toBe(computeCandidateInputSignature(CANDIDATES.s0, work({ profileSig: "OTHER", tagsSig: "OTHER", titleSig: "OTHER" })))
    // mas muda com a sinopse
    expect(computeCandidateInputSignature(CANDIDATES.s0, w)).not.toBe(computeCandidateInputSignature(CANDIDATES.s0, work({ synopsisSig: "OTHER" })))
  })
  it("S1 (perfil+sinopse) depende do perfil; S0 não", () => {
    const w = work()
    expect(computeCandidateInputSignature(CANDIDATES.s1, w)).not.toBe(computeCandidateInputSignature(CANDIDATES.s1, work({ profileSig: "OTHER" })))
    expect(computeCandidateInputSignature(CANDIDATES.s0, w)).toBe(computeCandidateInputSignature(CANDIDATES.s0, work({ profileSig: "OTHER" })))
  })
  it("D1 (perfil+tags) ignora sinopse; D2 (perfil+sinopse+tags) depende", () => {
    const w = work()
    expect(computeCandidateInputSignature(CANDIDATES.d1, w)).toBe(computeCandidateInputSignature(CANDIDATES.d1, work({ synopsisSig: "OTHER" })))
    expect(computeCandidateInputSignature(CANDIDATES.d2, w)).not.toBe(computeCandidateInputSignature(CANDIDATES.d2, work({ synopsisSig: "OTHER" })))
  })
  it("todos os 6 candidatos têm assinaturas distintas na mesma obra", () => {
    const w = work()
    const sigs = (["s0", "s1", "d1", "d2", "b1", "e1"] as const).map((id) => computeCandidateInputSignature(CANDIDATES[id], w))
    expect(new Set(sigs).size).toBe(6)
  })
  it("e1 depende do contexto de review; b1 não", () => {
    const w = work()
    expect(computeCandidateInputSignature(CANDIDATES.e1, w)).not.toBe(computeCandidateInputSignature(CANDIDATES.e1, work({ reviewContextSig: "OTHER" })))
    expect(computeCandidateInputSignature(CANDIDATES.b1, w)).toBe(computeCandidateInputSignature(CANDIDATES.b1, work({ reviewContextSig: "OTHER" })))
  })
})

describe("contextual-package — sanitizeTextOnlyDigestForLabeling (B2.2T)", () => {
  const base: TextOnlyDigest = {
    consensus: "Obra elogiada pela ambientação. Nota 9/10 segundo leitores.",
    divergence: "Alguns acham o ritmo lento.",
    recurring_positives: ["arte expressiva", "Você vai amar os personagens"],
    recurring_negatives: ["vilão raso"],
    narrative_traits: ["narrativa em flashbacks", "  "],
    content_warnings: ["violência", "★★★★★ recomendadíssimo"],
  }
  it("mapeia o schema text-only para SanitizedDigest (positives/negatives → traits; narrative → execution)", () => {
    const s = sanitizeTextOnlyDigestForLabeling(base)
    expect(s.traits.map((t) => t.polarity)).toEqual(["positive", "positive", "negative"])
    expect(s.traits.every((t) => t.axis === "")).toBe(true)
    expect(s.execution).toContain("flashbacks")
    expect(s.execution).not.toMatch(/\s\s/) // entradas vazias removidas/colapsadas
  })
  it("escruba notas/estrelas/recomendação (mesma política scrub) de TODOS os campos exibidos", () => {
    const s = sanitizeTextOnlyDigestForLabeling(base)
    const all = [s.consensus, s.divergence, s.execution, ...s.traits.map((t) => t.trait), ...s.contentWarnings].join(" || ")
    expect(all).not.toMatch(/9\s*\/\s*10|★|você vai amar|recomendad/i)
    expect(s.consensus).toContain("ambientação") // conteúdo neutro preservado
    expect(s.contentWarnings.some((c) => c.includes("violência"))).toBe(true) // aviso legítimo mantido
  })
  it("não vaza fonte/nota/rating; traços vazios após scrub são descartados", () => {
    const s = sanitizeTextOnlyDigestForLabeling({ ...base, recurring_positives: ["10/10", "trama coesa"] })
    expect(s.traits.map((t) => t.trait)).toContain("trama coesa")
    expect(s.traits.some((t) => /10\s*\/\s*10/.test(t.trait))).toBe(false)
  })
})

describe("contextual-package — selectContextualTagsByPriority (B2.2U)", () => {
  it("isLooksLeadTag: aparência = true; traço/papel/condição = false", () => {
    for (const t of ["Handsome Male Lead", "Black-Haired Female Lead", "Blue-Eyed Male Lead", "Dark/Tan Skin Female Lead", "Tall Male Lead", "Fat Female Lead", "Glasses-Wearing Male Lead"]) expect(isLooksLeadTag(t)).toBe(true)
    for (const t of ["Kind Male Lead", "Knight Female Lead", "Blind Male Lead", "Blushing Female Lead", "Arrogant Male Lead", "Strong Female Lead"]) expect(isLooksLeadTag(t)).toBe(false)
  })
  it("prioriza grupos de alta prioridade no corte (tone_mood/romance > LOW)", () => {
    const tags: ContextualTag[] = [
      { name: "Slow Burn", group: "romance" }, // prio 3
      { name: "Dark Ambience", group: "tone_mood" }, // prio 1
      { name: "Medieval", group: "setting" }, // LOW
      { name: "Some Element", group: "elements" }, // LOW
    ]
    expect(selectContextualTagsByPriority(tags, { maxTags: 2 }).map((t) => t.name)).toEqual(["Dark Ambience", "Slow Burn"])
  })
  it("rebaixa Looks dos leads abaixo de traço/papel do mesmo grupo", () => {
    const tags: ContextualTag[] = [
      { name: "Handsome Male Lead", group: "male_lead" }, // Looks → LOW
      { name: "Kind Male Lead", group: "male_lead" }, // prio 4
    ]
    expect(selectContextualTagsByPriority(tags, { maxTags: 1 }).map((t) => t.name)).toEqual(["Kind Male Lead"])
  })
  it("exclui format/other e é determinístico (independe da ordem de entrada)", () => {
    const tags: ContextualTag[] = [
      { name: "Long Strip", group: "format" },
      { name: "noise", group: "other" },
      { name: "Romance", group: "romance" },
    ]
    const a = selectContextualTagsByPriority(tags)
    expect(a.map((t) => t.name)).toEqual(["Romance"])
    expect(selectContextualTagsByPriority([...tags].reverse())).toEqual(a)
  })
})

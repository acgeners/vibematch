import { describe, expect, it } from "vitest"

import { buildUserPrompt, canonicalInputHash, canonicalInputHashV2 } from "@/lib/ai-evaluation/service"
import type { AiEvaluationRequest } from "@/lib/ai-evaluation/service"
import { splitSynopsesForEvaluation } from "@/lib/work-derived"

const NO_REVIEWS = { sourcedReviews: null, legacyReviews: null, ids: [] }

const baseReq: AiEvaluationRequest = {
  workId: "w1",
  title: "Obra Teste",
  synopsis: "Uma vilã reencarnada tenta escapar do destino escrito no romance original.",
  synopsisIsManual: false,
  genres: ["Romance"],
  tags: [],
}

describe("splitSynopsesForEvaluation", () => {
  it("separa a primária das adicionais preservando ordem e procedência", () => {
    const result = splitSynopsesForEvaluation([
      { source: "anilist", text: "Sinopse vinda do AniList sobre a vilã reencarnada.", is_primary: false, position: 1 },
      { source: "manual", text: "Versão manual escrita pela curadora com os detalhes que importam.", is_primary: false, position: 2 },
      { source: "mangaupdates", text: "Sinopse principal escolhida pelo usuário na criação.", is_primary: true, position: 0 },
    ])

    expect(result.primary).toBe("Sinopse principal escolhida pelo usuário na criação.")
    expect(result.primaryIsManual).toBe(false)
    expect(result.additional).toEqual([
      { text: "Sinopse vinda do AniList sobre a vilã reencarnada.", source: "anilist", isManual: false },
      { text: "Versão manual escrita pela curadora com os detalhes que importam.", source: "manual", isManual: true },
    ])
  })

  it("marca primaryIsManual quando a primária tem source manual", () => {
    const result = splitSynopsesForEvaluation([
      { source: "manual", text: "Sinopse escrita à mão.", is_primary: true, position: 0 },
    ])
    expect(result.primaryIsManual).toBe(true)
    expect(result.additional).toEqual([])
  })

  it("absorve duplicata quase idêntica da primária em vez de repeti-la como adicional", () => {
    const result = splitSynopsesForEvaluation([
      { source: "mangaupdates", text: "Sinopse principal escolhida pelo usuário na criação.", is_primary: true, position: 0 },
      { source: "comick", text: "  Sinopse principal escolhida pelo usuário na criação.  ", is_primary: false, position: 1 },
    ])
    expect(result.additional).toEqual([])
  })
})

describe("buildUserPrompt com sinopses adicionais", () => {
  it("inclui os blocos [S] rotulando manuais com autoridade alta e as demais pela fonte", () => {
    const prompt = buildUserPrompt(
      {
        ...baseReq,
        additionalSynopses: [
          { text: "Versão manual escrita pela curadora.", source: "manual", isManual: true },
          { text: "Sinopse vinda do AniList.", source: "anilist", isManual: false },
        ],
      },
      NO_REVIEWS
    )

    expect(prompt).toContain("Sinopses adicionais salvas na obra")
    expect(prompt).toContain("[S1] (MANUAL — escrita/editada pelo usuário) Versão manual escrita pela curadora.")
    expect(prompt).toContain("[S2] (fonte: anilist) Sinopse vinda do AniList.")
  })

  it("não emite o bloco quando não há adicionais (prompt idêntico ao anterior)", () => {
    const without = buildUserPrompt(baseReq, NO_REVIEWS)
    const withEmpty = buildUserPrompt({ ...baseReq, additionalSynopses: [] }, NO_REVIEWS)

    expect(without).not.toContain("Sinopses adicionais")
    expect(withEmpty).toBe(without)
  })

  it("ignora entradas de texto vazio", () => {
    const prompt = buildUserPrompt(
      { ...baseReq, additionalSynopses: [{ text: "   ", source: "anilist", isManual: false }] },
      NO_REVIEWS
    )
    expect(prompt).not.toContain("Sinopses adicionais")
  })
})

describe("input_hash com sinopses adicionais", () => {
  it("obra sem adicionais mantém o hash antigo (campo ausente e lista vazia são idênticos)", () => {
    const legacy = canonicalInputHash(baseReq)
    const legacyV2 = canonicalInputHashV2(baseReq)

    expect(canonicalInputHash({ ...baseReq, additionalSynopses: [] })).toBe(legacy)
    expect(canonicalInputHashV2({ ...baseReq, additionalSynopses: [] })).toBe(legacyV2)
  })

  it("adicionais presentes mudam o hash (V1 e V2)", () => {
    const withExtra: AiEvaluationRequest = {
      ...baseReq,
      additionalSynopses: [{ text: "Versão manual da curadora.", source: "manual", isManual: true }],
    }
    expect(canonicalInputHash(withExtra)).not.toBe(canonicalInputHash(baseReq))
    expect(canonicalInputHashV2(withExtra)).not.toBe(canonicalInputHashV2(baseReq))
  })
})

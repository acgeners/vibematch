import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

import {
  containmentReviews,
  CONTENCAO_MIN_TERMOS,
  deduplicateReviews,
  jaccardReviews,
  mesmaManifestacao,
  reviewTextFingerprint,
} from "@/lib/ai-evaluation/review-dedup"
import type { SourcedReview } from "@/lib/external/types"

/**
 * A dedup elimina CÓPIAS da mesma manifestação (a mesma review em duas plataformas, a versão longa e a
 * resumida), nunca opiniões parecidas de leitores diferentes — essas são consenso.
 * Os textos são reais (`work_reviews` do backup de 19/10/2026), dos pares medidos em
 * `Auditoria/qualidade-avaliacoes-ia-2026-10/CONSENSO-DIAGNOSTICO-2026-10-22.md`.
 */

type Fx = { source: SourcedReview["source"]; text: string; userRating?: number }
const fx = JSON.parse(readFileSync("tests/fixtures/ai-evaluation/reviews-duplicadas-reais.json", "utf8")) as Record<string, Fx[]>
const comoReview = (x: Fx): SourcedReview => ({ source: x.source, sourceTitle: `título em ${x.source}`, matchScore: 0.97, text: x.text, textLength: x.text.length, ...(x.userRating != null ? { userRating: x.userRating } : {}) })
const fp = (t: string) => reviewTextFingerprint(t)

describe("cópias da mesma manifestação viram uma", () => {
  it("a mesma review em duas plataformas — o caso que o Jaccard deixava passar", () => {
    const [comick, comix] = fx.mesmaReviewEmDuasPlataformas.map(comoReview)
    expect(jaccardReviews(fp(comick.text), fp(comix.text))).toBeLessThan(0.75)
    expect(containmentReviews(fp(comick.text), fp(comix.text))).toBeGreaterThanOrEqual(0.8)
    expect(deduplicateReviews([comix, comick])).toHaveLength(1)
  })

  it("a mesma review em três plataformas, com formatação e cortes diferentes", () => {
    const tres = fx.mesmaReviewEmTresPlataformas.map(comoReview)
    expect(deduplicateReviews(tres)).toHaveLength(1)
    expect(deduplicateReviews([...tres].reverse())).toHaveLength(1)
  })

  it("a versão longa e a resumida", () => {
    const [longa, resumida] = fx.versaoLongaEResumida.map(comoReview)
    expect(jaccardReviews(fp(longa.text), fp(resumida.text))).toBeLessThan(0.3)
    expect(deduplicateReviews([resumida, longa])).toHaveLength(1)
  })

  it("a régua original (Jaccard ≥ 0,75) continua valendo", () => {
    const a = "The female lead is smart and strong, the male lead is a green flag and the pacing never drags at all"
    const b = `${a}!!`
    expect(deduplicateReviews([{ text: a }, { text: b }])).toHaveLength(1)
  })
})

describe("opiniões parecidas de leitores diferentes NÃO são cópia", () => {
  it("duas reviews independentes que dizem o mesmo (comunicação, FL esperta, ML green flag) ficam as duas", () => {
    const [ap, comix] = fx.opinioesParecidasIndependentes.map(comoReview)
    expect(mesmaManifestacao(fp(ap.text), fp(comix.text))).toBe(false)
    expect(deduplicateReviews([ap, comix], { preferirVersaoMaisCompleta: true })).toHaveLength(2)
  })

  it("um comentário curto que divide palavras com uma review longa fica (piso de termos)", () => {
    const [curto, longo] = fx.comentarioCurtoEReviewLonga.map(comoReview)
    expect(fp(curto.text).size).toBeLessThan(CONTENCAO_MIN_TERMOS)
    expect(deduplicateReviews([longo, curto], { preferirVersaoMaisCompleta: true })).toHaveLength(2)
  })

  it("concordância curta e parecida de duas pessoas não vira uma", () => {
    const a = "Totally agree, the ending was so sad and I cried a lot"
    const b = "Agree, that sad ending made me cry so much honestly"
    expect(deduplicateReviews([{ text: a }, { text: b }])).toHaveLength(2)
  })
})

describe("qual versão sobrevive", () => {
  it("com `preferirVersaoMaisCompleta`, fica a mais completa — o registro INTEIRO dela, com a fonte dela", () => {
    const tres = fx.mesmaReviewEmTresPlataformas.map(comoReview)
    const [animeplanet] = tres
    for (const ordem of [tres, [...tres].reverse(), [tres[1], tres[0], tres[2]]]) {
      const [sobrevivente] = deduplicateReviews(ordem, { preferirVersaoMaisCompleta: true })
      expect(sobrevivente).toBe(animeplanet)
      expect(sobrevivente.source).toBe("animeplanet")
      expect(sobrevivente.sourceTitle).toBe("título em animeplanet")
      // detalhe que só a versão inteira tem (as outras foram cortadas em 900 caracteres)
      expect(sobrevivente.text).toContain("tolerate the misunderstandings in the first part")
    }
  })

  it("a sobrevivente ocupa a POSIÇÃO da primeira cópia e o texto não é combinado", () => {
    const [comick, comix] = fx.mesmaReviewEmDuasPlataformas.map(comoReview)
    const outra = comoReview({ source: "mangaupdates", text: fx.opinioesParecidasIndependentes[0].text })
    const out = deduplicateReviews([comix, outra, comick], { preferirVersaoMaisCompleta: true })
    expect(out).toEqual([comick, outra])
    expect(out[0].text).toBe(fx.mesmaReviewEmDuasPlataformas.find((x) => x.source === "comick")!.text)
  })

  it("a versão longa vence a resumida mesmo vindo depois", () => {
    const [longa, resumida] = fx.versaoLongaEResumida.map(comoReview)
    expect(deduplicateReviews([resumida, longa], { preferirVersaoMaisCompleta: true })).toEqual([longa])
  })

  it("SEM a opção, a primeira vence — a review manual nunca é trocada por uma raspada mais longa", () => {
    const [longa, resumida] = fx.versaoLongaEResumida.map(comoReview)
    const manual = { ...resumida, isManual: true }
    expect(deduplicateReviews([manual, longa])).toEqual([manual])
  })

  it("review dividida em duas postagens numa plataforma e inteira noutra: a inteira absorve as duas partes", () => {
    // Caso real (The Grand Duke's Bride Is a Warrior From Hell): na ComicK a review veio em 2 postagens
    // (a 2ª como resposta "@chureito …"); na Comix, inteira. As duas partes NÃO são cópia uma da outra.
    const [parte1, parte2, inteira] = fx.reviewDivididaEmDuasPostagens.map(comoReview)
    expect(mesmaManifestacao(fp(parte1.text), fp(parte2.text))).toBe(false)
    const out = deduplicateReviews([parte1, parte2, inteira], { preferirVersaoMaisCompleta: true })
    expect(out).toEqual([inteira])
    // e a saída já não tem cópia para a dedup seguinte (a do prompt) tirar
    expect(deduplicateReviews(out)).toEqual(out)
  })

  it("empate em completude mantém a primeira", () => {
    const [comix] = fx.mesmaReviewEmDuasPlataformas.filter((x) => x.source === "comix").map(comoReview)
    const copia = { ...comix, source: "mangago" as const }
    expect(deduplicateReviews([comix, copia], { preferirVersaoMaisCompleta: true })).toEqual([comix])
  })
})

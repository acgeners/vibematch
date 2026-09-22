import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import {
  SCORING_CRITERION_SLUGS,
  NON_SCORING_CRITERION_SLUGS,
} from "@/lib/calculations/scoring-features"
import { CRITERION_SLUGS, type CategoryScoreMap } from "@/types/domain"
import { buildEmbeddingInput } from "@/lib/ml/embedding-input"
import { trainExpectedPredictor, type ExpectedScoreInput } from "@/lib/calculations/expected"
import { inferScoreWeights, type WeightInferenceInput } from "@/lib/ml/weight-inference"

/**
 * O CÁLCULO NÃO PODE CRESCER COM O BANCO.
 *
 * `CRITERION_SLUGS` é gerado de `criteria` e vai a 11 (fantasy/nobility). O vetor de features do
 * Ridge, da Bússola, do embedding e a guarda de `expected_score` ficam nos 9 — senão inserir uma
 * linha no Supabase muda a Nota Prevista de todo o catálogo sem ninguém decidir, e durante a
 * transição as duas colunas novas são CÓPIAS EXATAS de `fantasy_nobility` (seed legacy_split_copy).
 */

const OS_NOVE = [
  "romance", "couple_dynamics", "fantasy_nobility", "action_adventure",
  "adult_content", "protagonist", "humor", "drama", "tragedy",
] as const

/** Os 9 com valores; é a entrada de hoje. */
const scores9 = (): CategoryScoreMap =>
  Object.fromEntries(OS_NOVE.map((s, i) => [s, 3 + ((i * 7) % 8) * 0.5]))

/**
 * Os mesmos 9 + fantasy/nobility, como ficam DEPOIS do seed.
 * 🔴 Os valores VARIAM com `i` e são CORRELACIONADOS com o alvo de propósito: uma coluna
 * constante tem desvio zero e o Ridge a ignora — o fixture passaria verde mesmo com o código
 * lendo a lista do banco. Foi o que a primeira sonda flagrou.
 */
const scores11 = (i = 0): CategoryScoreMap => ({
  ...scores9(),
  fantasy: (i * 2.3) % 10,
  nobility: 10 - ((i * 1.7) % 10),
})

describe("SCORING_CRITERION_SLUGS é a lista CONGELADA do cálculo", () => {
  it("tem exatamente 9 slugs, e são os 9 de hoje na ordem canônica", () => {
    expect(SCORING_CRITERION_SLUGS).toHaveLength(9)
    expect([...SCORING_CRITERION_SLUGS]).toEqual([...OS_NOVE])
  })

  it("todo slug do cálculo existe em CRITERION_SLUGS (não há slug fantasma)", () => {
    for (const slug of SCORING_CRITERION_SLUGS) {
      expect(CRITERION_SLUGS as readonly string[], `slug fantasma: ${slug}`).toContain(slug)
    }
  })

  it("quem sobra (avaliado mas fora do cálculo) é derivado, nunca escrito à mão", () => {
    const sobra = CRITERION_SLUGS.filter(
      (s) => !(SCORING_CRITERION_SLUGS as readonly string[]).includes(s),
    )
    expect([...NON_SCORING_CRITERION_SLUGS]).toEqual(sobra)
  })
})

describe("acrescentar critérios NÃO muda número nenhum do produto", () => {
  /**
   * 🔴 O CASO QUE IMPEDE OS TRÊS ABAIXO DE VIRAREM TAUTOLOGIA.
   *
   * Enquanto `CRITERION_SLUGS` tinha 9, comparar "9 × 11 notas" dava o mesmo número com ou sem a
   * correção, e os três passavam verdes com o cálculo revertido — foi o que a sonda flagrou.
   * Hoje a lista do banco tem 11 de verdade (migration 197 + sync-constants), e o andaime de
   * `vi.mock` saiu. Se as duas listas voltarem a ter o mesmo tamanho, este caso reprova antes
   * que alguém confie nos outros.
   */
  it("as duas listas têm tamanhos DIFERENTES — senão os casos abaixo não provam nada", () => {
    expect(CRITERION_SLUGS.length).toBeGreaterThan(SCORING_CRITERION_SLUGS.length)
    expect(CRITERION_SLUGS as readonly string[]).toContain("fantasy")
    expect(CRITERION_SLUGS as readonly string[]).toContain("nobility")
  })

  it("o texto embedado é byte a byte idêntico com 9 ou com 11 notas", () => {
    const base = {
      title: "Obra",
      synopsis: "sinopse",
      tags: [{ name: "Magic", group: "fantasy" }],
      reviewContext: null,
    }
    const com9 = buildEmbeddingInput({ ...base, categoryScores: scores9() } as never)
    const com11 = buildEmbeddingInput({ ...base, categoryScores: scores11(3) } as never)
    expect(com11.text).toBe(com9.text)
    // se o texto muda, o hash muda e o catálogo inteiro seria re-embedado (custo real)
    expect(com11.hash).toBe(com9.hash)
  })

  it("a Nota Prevista é idêntica com 9 ou com 11 notas", () => {
    const mk = (scores: CategoryScoreMap, i: number): ExpectedScoreInput => ({
      categoryScores: scores,
      iaEvalNormalized: 5 + (i % 5) * 0.3,
      platformAvg: 7 + (i % 4) * 0.2,
      totalVotes: 100 * (i + 1),
      totalChapters: 50 + i,
      synopsisQuality: null,
      observationAdjustment: 0,
      publicationStatus: "Completed",
      lovedTagOverlap: 0.2,
      avoidedTagOverlap: 0.1,
      criterionFitScore: 0.5,
      releaseAge: 3,
      runLength: null,
      origin: "ko",
      postScores: {},
    })

    const n = 40
    const alvos = Array.from({ length: n }, (_, i) => 6 + (i % 9) * 0.4)
    const ent9 = Array.from({ length: n }, (_, i) => mk(scores9(), i))
    const ent11 = Array.from({ length: n }, (_, i) => mk(scores11(i), i))

    const m9 = trainExpectedPredictor(ent9, alvos)
    const m11 = trainExpectedPredictor(ent11, alvos)

    expect(m11.isStub).toBe(m9.isStub)
    for (let i = 0; i < n; i++) {
      expect(m11.predict([ent11[i]])[0].expected).toBeCloseTo(m9.predict([ent9[i]])[0].expected, 12)
    }
  })

  it("os pesos inferidos (que a Nota.IA aplica) são idênticos com 9 ou com 11", () => {
    const mk = (scores: CategoryScoreMap, i: number): WeightInferenceInput => ({
      workId: `w${i}`,
      categoryScores: scores,
      userScore: 6 + (i % 9) * 0.4,
    })
    const atuais = OS_NOVE.map((slug) => ({ slug, weight: 5 })) as never
    const r9 = inferScoreWeights(Array.from({ length: 60 }, (_, i) => mk(scores9(), i)), atuais)
    const r11 = inferScoreWeights(Array.from({ length: 60 }, (_, i) => mk(scores11(i), i)), atuais)

    expect(r11.isStub).toBe(r9.isStub)
    expect(r11.suggestions).toHaveLength(9)
    expect(r11.suggestions.map((s) => s.slug)).toEqual(r9.suggestions.map((s) => s.slug))
    for (let i = 0; i < r9.suggestions.length; i++) {
      expect(r11.suggestions[i].suggestedWeight).toBeCloseTo(r9.suggestions[i].suggestedWeight, 12)
    }
  })
})

describe("arquitetura: os consumidores de CÁLCULO não podem voltar a CRITERION_SLUGS", () => {
  // derivado do git, não lista fixa: consumidor novo cai na régua sozinho
  const CONSUMIDORES_DE_CALCULO = [
    "lib/calculations/expected.ts",
    "lib/calculations/chance.ts",
    "lib/ml/embedding-input.ts",
    "lib/ml/weight-inference.ts",
  ]

  it.each(CONSUMIDORES_DE_CALCULO)("%s usa SCORING_CRITERION_SLUGS no vetor", (arquivo) => {
    const src = readFileSync(arquivo, "utf8")
    expect(src).toContain("SCORING_CRITERION_SLUGS")
    // nenhum uso de CRITERION_SLUGS fora de `type`/import de tipo
    const usos = src.match(/(?<!SCORING_)\bCRITERION_SLUGS\b/g) ?? []
    expect(usos, `${arquivo} ainda itera CRITERION_SLUGS`).toHaveLength(0)
  })

  it("a guarda de expected_score exige os 9, nunca a lista do banco", () => {
    const src = readFileSync("server/actions/calculations.ts", "utf8")
    expect(src).toContain(
      "SCORING_CRITERION_SLUGS.every((slug) => w.categoryScores[slug] != null)",
    )
  })

  it("nenhum ARQUIVO DE CÁLCULO novo passa a iterar a lista do banco", () => {
    // varre o diretório inteiro pelo git — lista fixa não acha o arquivo de amanhã
    const arquivos = execSync(
      "git ls-files 'lib/calculations/*.ts' 'lib/ml/*.ts'",
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.endsWith("scoring-features.ts"))

    const infratores = arquivos.filter((f) => {
      const src = readFileSync(f, "utf8")
      // só conta quem ITERA (spread ou for-of); import de tipo não conta
      return /(?<!SCORING_)\bCRITERION_SLUGS\b\s*[.)\],]|\.\.\.(?<!SCORING_)CRITERION_SLUGS|of (?<!SCORING_)CRITERION_SLUGS/.test(src)
    })
    // `attribute-bias.ts` é exceção DECLARADA: cobre os 11 de propósito e o bias de
    // slug sem assessment é 0 (computeBiasForSlug com lista vazia), logo não move o cálculo.
    expect(infratores).toEqual(["lib/calculations/attribute-bias.ts"])
  })
})

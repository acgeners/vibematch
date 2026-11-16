import { describe, it, expect } from "vitest"
import { buildEmbeddingInput } from "@/lib/ml/embedding-input"

/**
 * O título NÃO entra no texto do embedding (v3, 2026-11-16).
 *
 * Com ele, 25% das 8 obras mais parecidas de cada obra dividiam uma palavra do título com ela
 * (ao acaso, 2%): as 8 de "The Villainess Is a Marionette" eram todas "The Villainess …".
 * O nome não diz nada sobre a obra. Se um consumidor voltar a passar `title`, ele é ignorado.
 */
describe("texto do embedding", () => {
  const base = {
    synopsis: "Uma vilã acorda dentro do próprio livro.",
    tags: [{ name: "Regression", group: "trope" }],
    categoryScores: { romance: 7.5 },
    reviewContext: null,
  }

  it("não contém o título, nem o rótulo dele", () => {
    const { text } = buildEmbeddingInput({ ...base, title: "The Villainess Is a Marionette" } as never)
    expect(text).not.toMatch(/Villainess Is a Marionette/)
    expect(text).not.toMatch(/Título:/)
    expect(text.startsWith("Sinopse:")).toBe(true)
  })

  it("trocar o título não muda o hash (senão renomear obra re-embedaria à toa)", () => {
    const a = buildEmbeddingInput({ ...base, title: "Nome A" } as never)
    const b = buildEmbeddingInput({ ...base, title: "Outro nome" } as never)
    expect(a.hash).toBe(b.hash)
  })
})

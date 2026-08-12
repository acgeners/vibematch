import { describe, expect, it } from "vitest"
import { mapStatus } from "@/lib/external/mangaupdates"

/**
 * Todos os textos são REAIS, colhidos de `works.publication_status_note` (os 97 que o backfill
 * do hiato persistiu). O campo do MangaUpdates é markdown escrito à mão por voluntários: o
 * estado da publicação fica no cabeçalho e a quebra por temporada vem abaixo — então procurar
 * a palavra no texto inteiro faz nome de capítulo virar status.
 */

describe("mapStatus: nome de capítulo não é estado de publicação", () => {
  /**
   * 🔴 O caso que motivou a correção. `hiatus` é testado antes de `ongoing`, então o erro só
   * acontece numa direção — obra viva marcada como pausada — e some do radar: ninguém procura
   * uma obra em publicação na lista de pausadas.
   */
  it('"Hiatus Special" no título de um extra não pausa a obra', () => {
    expect(mapStatus("44 Chapters + Hiatus Special + AU Special (Ongoing)")).toBe("Ongoing")
  })

  it("ignora qualquer <algo> Special, não só o do caso conhecido", () => {
    expect(mapStatus("30 Chapters + Cancelled Special (Ongoing)")).toBe("Ongoing")
    expect(mapStatus("12 Chapters + Complete Specials (Ongoing)")).toBe("Ongoing")
  })
})

describe("mapStatus: o cabeçalho é tudo antes da primeira temporada", () => {
  /**
   * ⚠️ A CONTRAPROVA da versão que reprovei. Ler só a primeira linha classificava isto como
   * `Unknown` — o estado mora na SEGUNDA. Medido: essa versão ingênua acertava 1 caso e
   * regredia este.
   */
  it("acha o estado na segunda linha quando a primeira só conta capítulos", () => {
    expect(
      mapStatus("62 Chapters + 3 Specials +  \n9 Hiatus Specials (*Hiatus*)\n\n**S1:** 62 Chapters (1\\~62)  \n**S2:** *TBA*"),
    ).toBe("Hiatus")
  })

  /**
   * 🔴 O segundo viés, e o motivo de o cabeçalho parar na primeira temporada: `complete` é
   * testado primeiro, então uma linha de temporada encerrada arrastaria a obra INTEIRA para
   * `Completed` — silenciosamente, e no sentido mais caro (a obra some das listas de quem
   * acompanha).
   */
  it("temporada encerrada não conclui a obra", () => {
    expect(
      mapStatus("80 Chapters (Ongoing)\n\nS1: 40 Chapters (Complete) (1-40)\nS2: 40 Chapters (Ongoing) 41~"),
    ).toBe("Ongoing")
  })

  it("anotação de hiato no cabeçalho vence o campo entre parênteses", () => {
    // Aqui os dois convivem e o MU está dizendo as duas coisas; "hiatus" é a informação nova.
    expect(mapStatus("61 Chapters  (Ongoing)  hiatus since 2-2026")).toBe("Hiatus")
  })
})

describe("mapStatus: o que já funcionava continua funcionando", () => {
  it.each([
    ["111 Chapters (Hiatus) since 06.2026\n\nS1: 40 Chapters (01-40)\nS4: TBA", "Hiatus"],
    ["69 Chapters + Prologue (Artist Hiatus) as of Jan 19, 2025\n\n S2: 30 Chapters (Ongoing) 40~", "Hiatus"],
    ["215 Chapters + Prologue (Ongoing)\n\nS1: 43 Chapters (1-43)", "Ongoing"],
    ["142 Chapters (Hiatus as of Dec 2024)   \n4 Volumes (Ongoing)\n\nS1: 40 Chapters (1-40)", "Hiatus"],
    ["50 Chapters (Complete)", "Completed"],
    ["30 Chapters (Cancelled)", "Cancelled"],
    ["27 Chapters (Hiatus)", "Hiatus"],
  ])("%s → %s", (texto, esperado) => {
    expect(mapStatus(texto)).toBe(esperado)
  })

  it("sem texto continua Unknown", () => {
    expect(mapStatus(undefined)).toBe("Unknown")
    expect(mapStatus("")).toBe("Unknown")
    expect(mapStatus("120 Chapters")).toBe("Unknown")
  })
})

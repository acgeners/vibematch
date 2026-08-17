import { describe, expect, it } from "vitest"
import { bandCoherence, bandBounds, parseJustification } from "@/lib/criteria/justification"

/**
 * A régua de "a prosa contradiz o número?".
 *
 * Cada bloco abaixo é uma frase REAL do catálogo (2026-08-16). Os dois primeiros são os
 * falsos positivos que uma varredura ingênua produz — foi assim que um regex meu acusou
 * 483 incoerências das quais 6 de 6 amostradas eram inofensivas. Um teste com faixa simples
 * só ("Faixa 4-6" contra nota 7,0) passaria verde com o bug nos dois casos.
 */
describe("bandCoherence", () => {
  describe("faixa composta não é contradição", () => {
    const compostas: Array<[string, number]> = [
      ["Faixa 7-8/9 (Estrutural): ambientação de corte imperial, política de nobreza…", 8.5],
      ["Faixa 7-8/9-10 (Forte a Icônica): Vivian é descrita como 'Cunning Female Lead'…", 8.5],
      ["Faixa 4-6 a 7-8 (limite superior): dinâmica inicial de rejeição fria…", 6.5],
      ["Faixa 7-8 / limiar 9-10 (Core Romance): A sinopse posiciona o romance como eixo…", 8.5],
      // Conector de DUAS palavras. Era a última acusação da régua no catálogo, e era inócua.
      ["Faixa 9-10 aproximando de 7-8 (Estrutural): a corte e a magia estruturam o conflito.", 8.5],
    ]
    it.each(compostas)("%s ⇒ coerente com nota %s", (texto, nota) => {
      expect(bandCoherence(nota, texto)).toBe("coerente")
    })
  })

  describe("meio ponto na borda é a grade da rubrica, não erro de julgamento", () => {
    // Os bins são de inteiros e não se tocam: nenhum contém 3,5 · 6,5 · 8,5. São 226 notas
    // no catálogo — reprová-las afogaria as 71 divergências que importam.
    it.each([
      [8.5, "Faixa 7-8 (Intenso): gêneros Drama/Tragedy e tags de abuso físico…"],
      [6.5, "Faixa 4-6 (Ritmo agitado mas sem eventos extremos): tags como 'On the Run'…"],
      [3.5, "Faixa 0-3 (Ausente): nem sinopse nem tags mencionam elementos cômicos…"],
    ])("nota %s na borda de %s ⇒ coerente", (nota, texto) => {
      expect(bandCoherence(nota as number, texto as string)).toBe("coerente")
    })

    it("10,0 cabe em 9-10 — o topo da régua não é semiaberto", () => {
      expect(bandCoherence(10, "Faixa 9-10 (Explícito): cenas gráficas recorrentes.")).toBe("coerente")
    })
  })

  describe("divergência real sobrevive", () => {
    it.each([
      [4.0, "Faixa 0-3 (Ausente): gênero Comedy está listado, mas nenhuma review menciona humor."],
      [7.0, "Faixa 4-6 (Presente mas secundário): tags como 'Haunted House' constroem ambientação."],
      [3.0, "Faixa 4-6: há menções de consenso a personagens secundários trazendo alívio leve."],
    ])("nota %s contra %s ⇒ divergente", (nota, texto) => {
      expect(bandCoherence(nota as number, texto as string)).toBe("divergente")
    })

    it("um ponto inteiro fora da borda não é fresta", () => {
      // 9,0 contra "7-8" passa do teto semiaberto (9) — é divergência, não meio ponto.
      expect(bandCoherence(9.0, "Faixa 7-8 (Intenso): conflitos emocionais profundos.")).toBe("divergente")
    })
  })

  describe("sem faixa citada não afirma nada", () => {
    it.each([
      [7.0, "Karina é reincarnada, regressora e protetora, com tags como 'Strong Female Lead'."],
      [7.0, null],
      [7.0, ""],
    ])("nota %s sem faixa ⇒ sem-faixa", (nota, texto) => {
      expect(bandCoherence(nota as number, texto as string | null)).toBe("sem-faixa")
    })
  })
})

describe("bandBounds lê a citação inteira", () => {
  it.each([
    ["7-8", [7, 8]],
    ["9-10", [9, 10]],
    ["7-8/9-10", [7, 10]],
    ["7-8/9", [7, 9]],
    ["4-6 a 7-8", [4, 8]],
  ])("%s → %s", (band, esperado) => {
    expect(bandBounds(band as string)).toEqual(esperado)
  })
})

describe("parseJustification preserva o texto da obra", () => {
  it("tira só a legenda, mesmo com faixa composta", () => {
    const { band, label, detail } = parseJustification(
      "Faixa 7-8/9 (Estrutural): ambientação de corte imperial moldam os conflitos.",
    )
    expect(band).toBe("7-8/9")
    expect(label).toBe("Estrutural")
    expect(detail).toBe("ambientação de corte imperial moldam os conflitos.")
  })

  it("qualificador depois da vírgula fica no detalhe — nada do argumento se perde", () => {
    const { band, detail } = parseJustification(
      "Faixa 7-8 (Core Romance), tendendo ao limite superior: o romance é o eixo central.",
    )
    expect(band).toBe("7-8")
    expect(detail).toContain("o romance é o eixo central")
  })
})

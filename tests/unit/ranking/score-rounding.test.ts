import { describe, it, expect } from "vitest"
import { roundToDisplayScore } from "@/lib/score-rounding"

/**
 * A invariante: quem ORDENA/COLORE por nota tem que enxergar o MESMO número que a
 * tela mostra. O atalho `Math.round(v * 10) / 10` parece equivalente ao
 * `toFixed(1)` do display e não é — e a divergência não dá erro, dá uma obra
 * plausível na posição errada.
 */
describe("roundToDisplayScore", () => {
  it("concorda com toFixed(1) em TODOS os valores de 2 casas entre 0 e 10", () => {
    const divergentes: number[] = []
    for (let k = 0; k <= 1000; k++) {
      const v = k / 100
      if (roundToDisplayScore(v) !== Number(v.toFixed(1))) divergentes.push(v)
    }
    expect(divergentes).toEqual([])
  })

  it("o atalho `Math.round(v * 10) / 10` DIVERGE em 40 desses valores — é por isso que ele não pode ser usado", () => {
    const divergentes: number[] = []
    for (let k = 0; k <= 1000; k++) {
      const v = k / 100
      if (Math.round(v * 10) / 10 !== Number(v.toFixed(1))) divergentes.push(v)
    }
    // Guarda o motivo do módulo existir: se um dia isto virar [] o atalho passou a
    // ser seguro, e o teste deve cair pra alguém reavaliar (não é o caso hoje).
    expect(divergentes.length).toBe(40)
    expect(divergentes).toContain(8.35)
  })

  it("8,35 arredonda pra 8,3 (o que a tela mostra), não pra 8,4", () => {
    expect(roundToDisplayScore(8.35)).toBe(8.3)
    expect((8.35).toFixed(1)).toBe("8.3")
    expect(Math.round(8.35 * 10) / 10).toBe(8.4) // o bug, documentado
  })

  it("não inverte a ordem exibida do /ranking (caso medido em 2026-08-06)", () => {
    // As 6 primeiras obras do ranking do dono, com o segundo nível de ordenação
    // (Veredito) desempatando dentro de cada nota exibida.
    const obras = [
      { titulo: "A Dream Escape", expected: 8.49, veredito: 27 },
      { titulo: "The Spark in Your Eyes", expected: 8.35, veredito: 62 },
      { titulo: "The Villainess Turns the Hourglass", expected: 8.39, veredito: 62 },
      { titulo: "The Siren: Becoming the Villain's Family", expected: 8.43, veredito: 42 },
      { titulo: "What Do You Want to Be, Prince", expected: 8.27, veredito: 88 },
      { titulo: "Solitary Lady", expected: 8.29, veredito: 80 },
    ]
    const ordenar = (round: (v: number) => number) =>
      [...obras]
        .sort(
          (a, b) =>
            round(b.expected) - round(a.expected) ||
            b.veredito - a.veredito ||
            a.titulo.localeCompare(b.titulo),
        )
        .map((o) => o.expected.toFixed(1))

    // Com o arredondamento certo, a nota exibida é monotônica decrescente.
    expect(ordenar(roundToDisplayScore)).toEqual(["8.5", "8.4", "8.4", "8.3", "8.3", "8.3"])

    // Com o atalho, o 8,35 ordena como 8,4 e aparece como 8,3 na 2ª posição —
    // exatamente o que o /ranking exibia.
    expect(ordenar((v) => Math.round(v * 10) / 10)).toEqual(["8.5", "8.3", "8.4", "8.4", "8.3", "8.3"])
  })
})

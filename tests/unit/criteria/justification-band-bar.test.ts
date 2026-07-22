import { describe, it, expect } from "vitest"
import { bandBounds, bandBarBounds, bandForScore, collapseBand } from "@/lib/criteria/justification"

/** As 4 faixas canônicas de toda rubrica (lib/constants/criteria.ts). */
const CANONICAL = ["0-3", "4-6", "7-8", "9-10"]

describe("bandBarBounds — geometria da barra de fit", () => {
  it("abre o topo do bin (hi + 1), com teto em 10", () => {
    expect(bandBarBounds("0-3")).toEqual([0, 4])
    expect(bandBarBounds("4-6")).toEqual([4, 7])
    expect(bandBarBounds("7-8")).toEqual([7, 9])
    expect(bandBarBounds("9-10")).toEqual([9, 10])
  })

  it("faixa dupla colapsa e não estoura o teto", () => {
    expect(bandBarBounds("7-8/9-10")).toEqual([7, 10])
  })

  it("os bins ficam CONTÍGUOS — o topo de um é o piso do próximo", () => {
    for (let i = 0; i < CANONICAL.length - 1; i++) {
      expect(bandBarBounds(CANONICAL[i])[1]).toBe(bandBarBounds(CANONICAL[i + 1])[0])
    }
  })

  // A regressão que motivou a função: 3,5 · 6,5 · 8,5 não cabiam em faixa nenhuma, então o
  // marcador da nota era desenhado FORA do próprio segmento colorido.
  it("toda nota de meio ponto cai em exatamente um bin", () => {
    for (let s = 0.5; s < 10; s += 1) {
      const inside = CANONICAL.filter((band) => {
        const [lo, hi] = bandBarBounds(band)
        return s >= lo && s <= hi
      })
      expect(inside, `nota ${s}`).toHaveLength(1)
    }
  })

  it("não mexe no RÓTULO nem em bandBounds", () => {
    expect(collapseBand("7-8")).toBe("7-8")
    expect(bandBounds("7-8")).toEqual([7, 8])
  })
})

describe("bandForScore — faixa derivada da nota", () => {
  it("mapeia as bordas e os buracos", () => {
    expect(bandForScore(0)).toBe("0-3")
    expect(bandForScore(3.5)).toBe("0-3") // buraco: pertence ao bin [0,4)
    expect(bandForScore(4)).toBe("4-6")
    expect(bandForScore(6.5)).toBe("4-6") // buraco
    expect(bandForScore(7)).toBe("7-8")
    expect(bandForScore(8.5)).toBe("7-8") // buraco — o card que originou tudo isto
    expect(bandForScore(9)).toBe("9-10")
    expect(bandForScore(10)).toBe("9-10")
  })

  // A INVARIANTE. Antes valia só pra notas inteiras; agora vale pra toda nota possível, o que
  // significa que o marcador não tem mais como ser desenhado fora do próprio segmento.
  it("toda nota de 0 a 10 cai dentro do segmento da sua própria faixa", () => {
    for (let d = 0; d <= 100; d++) {
      const s = d / 10
      const [lo, hi] = bandBarBounds(bandForScore(s))
      expect(s >= lo && s <= hi, `nota ${s} → faixa ${bandForScore(s)} = [${lo},${hi}]`).toBe(true)
    }
  })

  it("é monotônica — nota maior nunca cai numa faixa menor", () => {
    const ordem = ["0-3", "4-6", "7-8", "9-10"]
    let anterior = 0
    for (let d = 0; d <= 100; d++) {
      const i = ordem.indexOf(bandForScore(d / 10))
      expect(i).toBeGreaterThanOrEqual(anterior)
      anterior = i
    }
  })
})

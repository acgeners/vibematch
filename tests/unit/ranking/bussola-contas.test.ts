import { describe, it, expect } from "vitest"
import {
  BUSSOLA_FACES,
  BUSSOLA_MEASURES,
  estimateLabelWidth,
  nearestOnFace,
  percentileFn,
  placeLabels,
  quantileOf,
} from "@/lib/ranking/bussola-map"
import { ARCHETYPE_LABEL } from "@/lib/ranking/tier-composition"
import { CORNER_ARCHETYPE } from "@/lib/ranking/archetype-style"
import { computeWorkForces } from "@/lib/calculations/forces"

/** As contas do mapa de capas da Bússola que não dependem de layout. */

describe("posição e marcas dos eixos", () => {
  it("percentil midrank: a mediana divide em duas metades e empate fica no meio do degrau", () => {
    const pct = percentileFn([10, 20, 20, 30])
    expect(pct(10)).toBe(12.5)
    expect(pct(20)).toBe(50)
    expect(pct(30)).toBe(87.5)
  })

  it("a marca do eixo imprime o VALOR real na posição, não o percentil", () => {
    const vals = [21, 55, 70, 78]
    expect(quantileOf(vals, 0)).toBe(21)
    expect(quantileOf(vals, 100)).toBe(78)
    expect(quantileOf([], 50)).toBeNull()
  })

  it("posiciona pelo número IMPRESSO: 8,35 é 8,3 na tela e no mapa", () => {
    // toFixed(1) de 8,35 dá 8,3 (o binário é 8,3499…); Math.round(83,5) daria 84.
    expect(BUSSOLA_MEASURES.crit.value({ chanceScore: 50, platformAvg: 8.35, totalVotes: 0 })).toBe(8.3)
    expect(BUSSOLA_MEASURES.chance.value({ chanceScore: 61.6, platformAvg: 8, totalVotes: 0 })).toBe(62)
  })

  it("🔴 o tipo de aposta usa a MESMA nota da tela: computeWorkForces não arredonda por conta própria", () => {
    for (const v of [8.35, 7.45, 6.05, 9.95, 8.25]) {
      const tela = BUSSOLA_MEASURES.crit.value({ chanceScore: 50, platformAvg: v, totalVotes: 0 })!
      expect(computeWorkForces({ chanceScore: 50, platformAvg: v, totalVotes: 0 }).avaliacao).toBe(Math.round(tela * 10))
    }
  })

  it("no par principal, os cantos são os tipos de aposta da view Cards (mesmo vocabulário)", () => {
    const q = BUSSOLA_FACES.cc.quad
    for (const corner of ["tr", "tl", "br", "bl"] as const) {
      expect(q[corner].toLowerCase()).toBe(ARCHETYPE_LABEL[CORNER_ARCHETYPE[corner]])
    }
  })
})

describe("nomes ao lado das capas", () => {
  const W = 600
  const H = 400
  const covers = [
    { id: "a", x: 100, y: 100, size: 40 },
    { id: "b", x: 300, y: 200, size: 40 },
    { id: "c", x: 320, y: 210, size: 40 },
  ]
  const boxOf = (l: { x: number; y: number; w: number }) => ({ x1: l.x, x2: l.x + l.w, y1: l.y, y2: l.y + 14 })
  const overlaps = (a: ReturnType<typeof boxOf>, b: ReturnType<typeof boxOf>) =>
    a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1

  it("nenhum nome cobre outro nome nem outra capa, e todos ficam dentro do mapa", () => {
    const placed = placeLabels(
      covers.map((c) => ({ id: c.id, title: `Obra ${c.id} com nome`, rank: 2 as const, size: c.size })),
      covers,
      W,
      H,
    )
    for (const l of placed) {
      const box = boxOf(l)
      expect(box.x1).toBeGreaterThanOrEqual(0)
      expect(box.x2).toBeLessThanOrEqual(W)
      for (const c of covers) {
        if (c.id === l.id) continue
        const r = c.size / 2 + 1
        expect(overlaps(box, { x1: c.x - r, x2: c.x + r, y1: c.y - r, y2: c.y + r })).toBe(false)
      }
      for (const o of placed) if (o !== l) expect(overlaps(box, boxOf(o))).toBe(false)
    }
  })

  it("a obra clicada e as ligadas vêm com o nome inteiro; as demais, cortadas em 24", () => {
    const longo = "The Villainess Wants to Live a Quiet Life in the Countryside"
    const sel = placeLabels([{ id: "a", title: longo, rank: 0, size: 52 }], [covers[0]], W, H)
    expect(sel[0].text).toBe(longo)
    const outra = placeLabels([{ id: "a", title: longo, rank: 2, size: 40 }], [covers[0]], W, H)
    expect(outra[0].text.length).toBeLessThanOrEqual(24)
    expect(outra[0].text.endsWith("…")).toBe(true)
  })

  it("quando não cabe, o nome fica de fora em vez de cobrir o vizinho", () => {
    // capa espremida no canto, sem espaço livre em nenhum dos quatro lados
    const apertado = [
      { id: "x", x: 21, y: 21, size: 40 },
      { id: "n1", x: 61, y: 21, size: 40 },
      { id: "n2", x: 21, y: 61, size: 40 },
    ]
    const placed = placeLabels([{ id: "x", title: "Nome comprido demais aqui", rank: 2, size: 40 }], apertado, 100, 100)
    expect(placed).toHaveLength(0)
  })

  it("a largura estimada cresce com o texto (a medida não depende de canvas)", () => {
    expect(estimateLabelWidth("abcdef")).toBeGreaterThan(estimateLabelWidth("abc"))
  })
})

describe("vizinhas no mapa", () => {
  it("as k mais próximas no par atual, sem a própria obra, em ordem de distância", () => {
    const pos = new Map([
      ["a", { x: 50, y: 50 }],
      ["b", { x: 52, y: 50 }],
      ["c", { x: 90, y: 90 }],
      ["d", { x: 45, y: 55 }],
    ])
    expect(nearestOnFace("a", pos, 2)).toEqual(["b", "d"])
    expect(nearestOnFace("zz", pos)).toEqual([])
  })
})

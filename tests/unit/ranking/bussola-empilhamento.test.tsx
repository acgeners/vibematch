import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/server/actions/bussola", () => ({ getBussolaLinks: vi.fn(async () => null) }))

import { render } from "@testing-library/react"
import { BussolaPlane } from "@/components/ranking/bussola-plane"
import type { BussolaDatum } from "@/components/ranking/bussola-plane"
import { separateCovers, type CoverPoint } from "@/lib/ranking/bussola-map"

/**
 * Capas que caem no MESMO lugar.
 *
 * A nota da crítica tem poucos valores distintos e a chance é inteira, então obras diferentes
 * caem no mesmo ponto (medido em 2026-08-08: dois pares nas 40 do topo). Empilhadas, uma capa
 * some atrás da outra. A separação:
 *   1. afasta até a sobreposição ficar em no máximo METADE da capa (pedido da Ana: separar por
 *      inteiro espalhava os grupos e apagava a diferença entre eles);
 *   2. nunca cruza a mediana — o canto (no par principal, o tipo de aposta) não muda;
 *   3. mantém a capa inteira dentro da área do mapa;
 *   4. é determinística.
 */

const W = 800
const H = 440
const SIZE = 42

/** Sobreposição relativa de dois quadrados de lado `s` com centros a (dx, dy). */
const overlapFrac = (dx: number, dy: number, s: number) =>
  (Math.max(0, s - Math.abs(dx)) * Math.max(0, s - Math.abs(dy))) / (s * s)

describe("separateCovers", () => {
  it("afasta obras empatadas até a sobreposição ficar em no máximo metade", () => {
    const pts: CoverPoint[] = [
      { id: "a", x: 70, y: 70 },
      { id: "b", x: 70, y: 70 },
      { id: "c", x: 70, y: 70 },
    ]
    const out = separateCovers(pts, W, H, SIZE)
    const ids = ["a", "b", "c"]
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const A = out.get(ids[i])!
        const B = out.get(ids[j])!
        expect(overlapFrac(B.x - A.x, B.y - A.y, SIZE)).toBeLessThanOrEqual(0.5 + 0.005)
      }
    }
  })

  it("NÃO separa por inteiro: capas empatadas continuam encostadas (o grupo fica junto)", () => {
    const out = separateCovers([{ id: "a", x: 70, y: 70 }, { id: "b", x: 70, y: 70 }], W, H, SIZE)
    const A = out.get("a")!
    const B = out.get("b")!
    expect(Math.hypot(B.x - A.x, B.y - A.y)).toBeLessThan(SIZE)
  })

  it("nunca cruza a mediana, nem com um aglomerado em cima da cruz", () => {
    const pts: CoverPoint[] = Array.from({ length: 12 }, (_, i) => ({
      id: `p${i}`,
      x: i % 2 ? 50 : 49,
      y: i % 3 ? 50 : 49.5,
    }))
    const out = separateCovers(pts, W, H, SIZE)
    for (const p of pts) {
      const q = out.get(p.id)!
      if (p.x >= 50) expect(q.x).toBeGreaterThanOrEqual(W / 2)
      else expect(q.x).toBeLessThanOrEqual(W / 2)
      // y cresce para baixo: em cima da mediana (percentil ≥ 50) = y ≤ H/2
      if (p.y >= 50) expect(q.y).toBeLessThanOrEqual(H / 2)
      else expect(q.y).toBeGreaterThanOrEqual(H / 2)
    }
  })

  it("mantém a capa inteira dentro da área, inclusive nos extremos", () => {
    const out = separateCovers([{ id: "a", x: 0, y: 0 }, { id: "b", x: 100, y: 100 }], W, H, SIZE)
    for (const q of out.values()) {
      expect(q.x).toBeGreaterThanOrEqual(SIZE / 2)
      expect(q.x).toBeLessThanOrEqual(W - SIZE / 2)
      expect(q.y).toBeGreaterThanOrEqual(SIZE / 2)
      expect(q.y).toBeLessThanOrEqual(H - SIZE / 2)
    }
  })

  it("quem não encosta em ninguém fica no lugar real", () => {
    const out = separateCovers([{ id: "a", x: 20, y: 30 }, { id: "b", x: 80, y: 75 }], W, H, SIZE)
    for (const q of out.values()) {
      expect(Math.abs(q.x - q.ox)).toBeLessThan(0.1)
      expect(Math.abs(q.y - q.oy)).toBeLessThan(0.1)
    }
  })

  it("é determinística: o mesmo conjunto dá o mesmo desenho", () => {
    const pts: CoverPoint[] = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, x: 60 + (i % 3), y: 60 + (i % 2) }))
    const a = separateCovers(pts, W, H, SIZE)
    const b = separateCovers(pts, W, H, SIZE)
    expect([...a.entries()]).toEqual([...b.entries()])
  })
})

beforeEach(() => window.localStorage.clear())

describe("Bússola do /ranking — empate desenhado", () => {
  it("duas obras que caem no mesmo ponto saem em lugares diferentes, do mesmo lado da mediana", () => {
    // 68,0/68,4 → 68% e 8,50/8,54 → 8,5: mesmo ponto na tela.
    const EMPATE: BussolaDatum[] = [
      { workId: "grande", title: "Empatada A", coverUrls: [], isAdult: false, isMixed: false, year: 2021, chanceScore: 68.0, platformAvg: 8.5, totalVotes: 30000, expectedScore: 8.5 },
      { workId: "pequena", title: "Empatada B", coverUrls: [], isAdult: false, isMixed: false, year: 2022, chanceScore: 68.4, platformAvg: 8.54, totalVotes: 900, expectedScore: 8.4 },
      { workId: "outra", title: "Sozinha", coverUrls: [], isAdult: false, isMixed: false, year: 2020, chanceScore: 30, platformAvg: 7.2, totalVotes: 5000, expectedScore: 7.0 },
    ]
    const { container, unmount } = render(<BussolaPlane entries={EMPATE} />)
    const pos = (id: string) => {
      const el = container.querySelector<HTMLElement>(`[data-point="${id}"]`)!
      return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) }
    }
    const a = pos("grande")
    const b = pos("pequena")
    expect(a.left !== b.left || a.top !== b.top).toBe(true)
    for (const p of [a, b]) {
      expect(p.left).toBeGreaterThanOrEqual(50)
      expect(p.top).toBeLessThanOrEqual(50)
    }
    unmount()
  })
})

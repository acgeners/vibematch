import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/server/actions/bussola", () => ({ getBussolaLinks: vi.fn(async () => null) }))

import { render } from "@testing-library/react"
import { BussolaPlane } from "@/components/ranking/bussola-plane"
import type { BussolaDatum } from "@/components/ranking/bussola-plane"
import { coverSizeFor } from "@/lib/ranking/bussola-map"

/**
 * Tamanho do ponto.
 *
 * No /ranking o ponto é a CAPA, e todas têm o mesmo tamanho, proporcional ao mapa (pedido da
 * Ana, 16/11/2026): o tamanho por alcance não tinha legenda e brigava com a capa. Na comparação
 * (modo absoluto) o tamanho continua sendo a 3ª força, em magnitude real.
 */

const VOTES = [28442, 13134, 18712, 2321, 9429, 13870, 19654, 11776, 1768, 7993, 2886, 15888, 836, 50958]

const entries: BussolaDatum[] = VOTES.map((votes, i) => ({
  workId: `w${i}`,
  title: `Obra ${i}`,
  coverUrls: [], isAdult: false, isMixed: false,
  year: 2020,
  chanceScore: 40 + ((i * 7) % 55),
  platformAvg: 7 + ((i * 3) % 25) / 10,
  totalVotes: votes,
  expectedScore: 8,
}))

beforeEach(() => window.localStorage.clear())

describe("Bússola — tamanho do ponto", () => {
  it("no /ranking toda capa tem o MESMO tamanho, qualquer que seja o alcance", () => {
    const { container, unmount } = render(<BussolaPlane entries={entries} />)
    const sizes = [...container.querySelectorAll<HTMLElement>("[data-point]")].map((d) => parseFloat(d.style.width))
    expect(sizes).toHaveLength(VOTES.length)
    expect(new Set(sizes).size).toBe(1)
    unmount()
  })

  it("a capa acompanha o mapa: ~42px no normal, ~72px na tela inteira, entre 32 e 78", () => {
    expect(coverSizeFor(560 - 122, 900)).toBe(42)
    expect(coverSizeFor(1000 - 122, 1000)).toBeGreaterThanOrEqual(70)
    expect(coverSizeFor(50, 900)).toBe(32)
    expect(coverSizeFor(5000, 5000)).toBe(78)
  })

  it("no celular a LARGURA manda: a área estreita encolhe a capa em vez de empilhar tudo", () => {
    expect(coverSizeFor(438, 232)).toBeLessThan(coverSizeFor(438, 900))
    expect(coverSizeFor(438, 232)).toBeGreaterThanOrEqual(32)
  })

  it("no modo absoluto o tamanho é magnitude: 2 obras quase empatadas ficam quase do mesmo tamanho", () => {
    const par: BussolaDatum[] = [
      { ...entries[0], workId: "a", totalVotes: 10000 },
      { ...entries[1], workId: "b", totalVotes: 11000 },
    ]
    const { container, unmount } = render(<BussolaPlane entries={par} mode="absolute" />)
    const [a, b] = [...container.querySelectorAll<HTMLElement>("a[aria-label*='alcance']")].map((d) =>
      parseFloat(d.style.width),
    )
    expect(Math.abs(a - b)).toBeLessThan(1)
    unmount()
  })
})

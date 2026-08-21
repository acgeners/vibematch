import { vi, describe, it, expect } from "vitest"

vi.mock("server-only", () => ({}))

import { render } from "@testing-library/react"
import { BussolaPlane } from "@/components/ranking/bussola-plane"
import type { BussolaDatum } from "@/components/ranking/bussola-plane"

/**
 * O tamanho do ponto é a 3ª força da bússola. A escala antiga era ABSOLUTA
 * (`10 + v/100 * 18`) e, como Alcance é log de votos, ela colapsava: nas 42 obras
 * do topo do ranking a metade central do acervo cabia em 2,4 px de diâmetro — a
 * 3ª força ocupava espaço na tela sem informar nada.
 *
 * Estes testes montam o componente de verdade e MEDEM o que ele renderiza (o
 * diâmetro vai no style inline, que o jsdom expõe), em vez de reimplementar a
 * fórmula e testar a cópia.
 */

// Votos reais das obras do topo do /ranking (2026-08-06) — log-distribuídos, que é
// exatamente o formato que fazia a escala absoluta colapsar.
const VOTES = [
  28442, 13134, 18712, 2321, 9429, 13870, 19654, 11776, 1768, 7993, 2886, 15888, 16247, 4393,
  7771, 3707, 8743, 50958, 1341, 11446, 8631, 12300, 4622, 5984, 1494, 13376, 13532, 836, 5135,
  4605, 718, 2750, 12068, 1801, 7092, 1481, 11394, 8090, 2835, 10945, 7528, 3862,
]

const entries: BussolaDatum[] = VOTES.map((votes, i) => ({
  workId: `w${i}`,
  title: `Obra ${i}`,
  coverUrls: [], isAdult: false,
  year: 2020,
  chanceScore: 40 + ((i * 7) % 55),
  platformAvg: 7 + ((i * 3) % 25) / 10,
  totalVotes: votes,
  expectedScore: 8,
}))

/** Diâmetros dos pontos do plano, em px, na ordem do DOM. */
function renderedDotSizes(mode?: "absolute" | "percentile"): number[] {
  const { container, unmount } = render(<BussolaPlane entries={entries} mode={mode} />)
  const dots = container.querySelectorAll<HTMLElement>("a[aria-label*='alcance']")
  const sizes = [...dots].map((d) => parseFloat(d.style.width))
  unmount()
  return sizes
}

const quantile = (arr: number[], p: number) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) * p)]
}

describe("BussolaPlane — tamanho do ponto", () => {
  it("usa praticamente a faixa INTEIRA de diâmetro no acervo exibido (⌀ 9–34 px)", () => {
    const sizes = renderedDotSizes()
    expect(sizes).toHaveLength(VOTES.length)
    // O percentil é midrank (mesma convenção da posição): o menor cai em 0,5/N e o
    // maior em (N−0,5)/N, então os extremos chegam PERTO das pontas, não nelas.
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(9)
    expect(Math.min(...sizes)).toBeLessThan(10.5)
    expect(Math.max(...sizes)).toBeGreaterThan(32)
    expect(Math.max(...sizes)).toBeLessThanOrEqual(34)
  })

  it("diferencia a METADE CENTRAL do acervo — onde a escala antiga dava 2,4 px", () => {
    const sizes = renderedDotSizes()
    const spanNovo = quantile(sizes, 0.75) - quantile(sizes, 0.25)

    // A escala antiga, para o MESMO conjunto, sobre o Alcance absoluto.
    const REF = 50000
    const alcance = VOTES.map((v) =>
      Math.round(Math.min(100, (Math.log1p(v) / Math.log1p(REF)) * 100)),
    )
    const antigos = alcance.map((v) => 10 + (v / 100) * 18)
    const spanAntigo = quantile(antigos, 0.75) - quantile(antigos, 0.25)

    expect(spanAntigo).toBeLessThan(3) // o bug: 2,4 px
    expect(spanNovo).toBeGreaterThan(3 * spanAntigo)
  })

  it("no modo absoluto NÃO usa percentil — 2 obras quase empatadas ficam quase do mesmo tamanho", () => {
    // Neste modo a posição é magnitude real de propósito (percentil sobre 2 obras
    // exagera os cantos); o tamanho acompanha, senão inventaria uma diferença.
    const par: BussolaDatum[] = [
      { ...entries[0], workId: "a", totalVotes: 10000 },
      { ...entries[1], workId: "b", totalVotes: 11000 },
    ]
    const render2 = (mode: "absolute" | "percentile") => {
      const { container, unmount } = render(<BussolaPlane entries={par} mode={mode} />)
      const sizes = [...container.querySelectorAll<HTMLElement>("a[aria-label*='alcance']")].map(
        (d) => parseFloat(d.style.width),
      )
      unmount()
      return sizes
    }
    const [aAbs, bAbs] = render2("absolute")
    expect(Math.abs(aAbs - bAbs)).toBeLessThan(1)

    // No modo percentil (o do /ranking) as mesmas duas obras se separam bem — é o
    // preço aceito: o tamanho ORDENA o que está na tela, não mede magnitude.
    const [aPct, bPct] = render2("percentile")
    expect(Math.abs(aPct - bPct)).toBeGreaterThan(10)
  })
})

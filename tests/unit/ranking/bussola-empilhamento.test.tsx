import { vi, describe, it, expect } from "vitest"

vi.mock("server-only", () => ({}))

import { render } from "@testing-library/react"
import { BussolaPlane } from "@/components/ranking/bussola-plane"
import type { BussolaDatum } from "@/components/ranking/bussola-plane"

/**
 * Obras EMPILHADAS no plano.
 *
 * `computeWorkForces` arredonda as duas forças pra inteiro (chance =
 * `round(chance_score)`, avaliação = `round(platform_avg × 10)`) antes do
 * percentil, então obras com valores diferentes caem na MESMA coordenada.
 * Medido em 2026-08-08 nas 40 obras do topo do acervo: dois pares assim.
 *
 * Empilhados sem tratamento, os dois desenhavam um anel — a mesma imagem do
 * ponto ACESO, que foi lida como estado — e o menor podia sumir inteiro atrás do
 * maior, sem hover e sem rastro. Duas defesas, testadas aqui:
 *   1. os empatados se afastam num círculo pequeno em volta do ponto real
 *   2. a pintura vai do maior pro menor, então o pequeno nunca fica escondido
 */

const dotsOf = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>("a[aria-label*='alcance']")]

const posOf = (el: HTMLElement) => ({ left: parseFloat(el.style.left), bottom: parseFloat(el.style.bottom) })

/** Duas obras que caem no MESMO ponto: 68,0/68,4 → 68 e 8,50/8,54 → 85. */
const EMPATE: BussolaDatum[] = [
  { workId: "grande", title: "Empatada com muitos votos", coverUrl: null, isAdult: false, year: 2021, chanceScore: 68.0, platformAvg: 8.5, totalVotes: 30000, expectedScore: 8.5 },
  { workId: "pequena", title: "Empatada com poucos votos", coverUrl: null, isAdult: false, year: 2022, chanceScore: 68.4, platformAvg: 8.54, totalVotes: 900, expectedScore: 8.4 },
  { workId: "outra", title: "Sozinha", coverUrl: null, isAdult: false, year: 2020, chanceScore: 30, platformAvg: 7.2, totalVotes: 5000, expectedScore: 7.0 },
]

describe("BussolaPlane — obras empilhadas", () => {
  it("separa duas obras que caem no mesmo ponto", () => {
    const { container, unmount } = render(<BussolaPlane entries={EMPATE} />)
    const [a, b] = ["grande", "pequena"].map(
      (id) => dotsOf(container).find((el) => (el.getAttribute("aria-label") ?? "").startsWith(id === "grande" ? "Empatada com muitos" : "Empatada com poucos"))!,
    )
    const pa = posOf(a)
    const pb = posOf(b)
    expect(pa.left).not.toBe(pb.left)
    expect(pa.bottom).not.toBe(pb.bottom)
    unmount()
  })

  it("afasta no MÁXIMO 40% de um passo de percentil — o empate se resolve dentro da célula dele", () => {
    // Passo de percentil = 100/n. Afastar mais que isso empurraria o par pra
    // dentro da vizinhança, e aí a posição passaria a mentir sobre o valor.
    const { container, unmount } = render(<BussolaPlane entries={EMPATE} />)
    const passo = 100 / EMPATE.length
    const [a, b] = dotsOf(container)
      .filter((el) => (el.getAttribute("aria-label") ?? "").startsWith("Empatada"))
      .map(posOf)
    const dist = Math.hypot(a.left - b.left, a.bottom - b.bottom)
    expect(dist).toBeGreaterThan(0)
    expect(dist).toBeLessThanOrEqual(passo * 0.8 + 1e-9) // 2 × raio máximo
    unmount()
  })

  it("nunca atravessa a mediana — o quadrante dá a COR, e cor e posição não podem discordar", () => {
    // 20/55/55/90: o par empatado cai EXATAMENTE em 50% (midrank), em cima da
    // cruz. É o único caso em que o afastamento poderia jogar um ponto pro
    // quadrante errado — com a cor do quadrante certo.
    const naMediana: BussolaDatum[] = [
      { workId: "1", title: "Baixa", coverUrl: null, isAdult: false, year: 2020, chanceScore: 20, platformAvg: 6.0, totalVotes: 100, expectedScore: 6 },
      { workId: "2", title: "Empate A", coverUrl: null, isAdult: false, year: 2021, chanceScore: 55, platformAvg: 8.0, totalVotes: 9000, expectedScore: 8 },
      { workId: "3", title: "Empate B", coverUrl: null, isAdult: false, year: 2022, chanceScore: 55, platformAvg: 8.0, totalVotes: 300, expectedScore: 8 },
      { workId: "4", title: "Alta", coverUrl: null, isAdult: false, year: 2023, chanceScore: 90, platformAvg: 9.2, totalVotes: 40000, expectedScore: 9 },
    ]
    const { container, unmount } = render(<BussolaPlane entries={naMediana} />)
    const empatados = dotsOf(container).filter((el) => (el.getAttribute("aria-label") ?? "").startsWith("Empate"))
    expect(empatados).toHaveLength(2)
    for (const el of empatados) {
      const { left, bottom } = posOf(el)
      // `classifyArchetypeByPercentile` usa >= 50 pros dois eixos: quem estava em
      // 50 é "safe", e tem que CONTINUAR do lado direito e de cima.
      expect(left).toBeGreaterThanOrEqual(50)
      expect(bottom).toBeGreaterThanOrEqual(50)
    }
    unmount()
  })

  it("pinta do maior pro menor, pra ponto pequeno nunca sumir atrás de ponto grande", () => {
    const { container, unmount } = render(<BussolaPlane entries={EMPATE} />)
    const larguras = dotsOf(container).map((el) => parseFloat(el.style.width))
    expect(larguras).toEqual([...larguras].sort((a, b) => b - a))
    unmount()
  })

  it("não mexe em nada quando não há empate", () => {
    const semEmpate: BussolaDatum[] = [
      { workId: "a", title: "A", coverUrl: null, isAdult: false, year: 2020, chanceScore: 20, platformAvg: 7.0, totalVotes: 100, expectedScore: 7 },
      { workId: "b", title: "B", coverUrl: null, isAdult: false, year: 2021, chanceScore: 50, platformAvg: 8.0, totalVotes: 200, expectedScore: 8 },
      { workId: "c", title: "C", coverUrl: null, isAdult: false, year: 2022, chanceScore: 80, platformAvg: 9.0, totalVotes: 300, expectedScore: 9 },
    ]
    const { container, unmount } = render(<BussolaPlane entries={semEmpate} />)
    // percentis de 3 obras distintas: 16,67 / 50 / 83,33 — redondos, sem sobra
    // de deslocamento nenhum.
    const lefts = dotsOf(container).map((el) => parseFloat(el.style.left)).sort((a, b) => a - b)
    expect(lefts.map((v) => Number(v.toFixed(4)))).toEqual([16.6667, 50, 83.3333])
    unmount()
  })
})

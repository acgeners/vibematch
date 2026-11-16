import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/server/actions/bussola", () => ({ getBussolaLinks: vi.fn(async () => null) }))

import { render, within } from "@testing-library/react"
import { BussolaPlane } from "@/components/ranking/bussola-plane"
import type { BussolaDatum } from "@/components/ranking/bussola-plane"

/**
 * O teto de capas da Bússola (`MAX_PLOT`).
 *
 * O mapa fica legível enquanto as capas não se empilham, e a degradação NÃO é gradual — medido
 * em 2026-08-06 sobre o catálogo real: 40 obras → 10,0% colidindo; 100 → 12,0%; 965 (catálogo
 * inteiro) → 52,6%, uma mancha. Sem teto, afrouxar o filtro vira mancha SEM AVISO.
 */

function makeEntries(n: number): BussolaDatum[] {
  return Array.from({ length: n }, (_, i) => ({
    workId: `w${i}`,
    title: `Obra ${i}`,
    coverUrls: [], isAdult: false, isMixed: false,
    year: 2020,
    chanceScore: 20 + ((i * 7) % 70),
    platformAvg: 7 + ((i * 3) % 25) / 10,
    totalVotes: 500 + i * 37,
    expectedScore: 8,
  }))
}

const pointsOf = (container: HTMLElement) => container.querySelectorAll("[data-point]")
const absoluteDotsOf = (container: HTMLElement) => container.querySelectorAll("a[aria-label*='alcance']")

beforeEach(() => window.localStorage.clear())

describe("Bússola do /ranking — teto de capas", () => {
  it("desenha todas as obras quando o conjunto cabe no mapa", () => {
    const { container, unmount } = render(<BussolaPlane entries={makeEntries(40)} />)
    expect(pointsOf(container)).toHaveLength(40)
    unmount()
  })

  it("corta em 100 e AVISA quando o conjunto passa do teto", () => {
    const { container, unmount } = render(<BussolaPlane entries={makeEntries(965)} />)
    expect(pointsOf(container)).toHaveLength(100)
    // O aviso é o que separa "recorte deliberado" de "bug silencioso": sem ele o mapa é lido
    // como se fosse o ranking inteiro.
    expect(container.textContent).toMatch(/mostrando as/i)
    expect(container.textContent).toContain("965")
    unmount()
  })

  it("não aplica teto na comparação (modo absoluto)", () => {
    const { container, unmount } = render(<BussolaPlane entries={makeEntries(10)} mode="absolute" />)
    expect(absoluteDotsOf(container)).toHaveLength(10)
    unmount()
  })
})

describe("Bússola do /ranking — tipos de aposta e lista", () => {
  it("o filtro de tipo de aposta usa o vocabulário compartilhado e conta cada tipo", () => {
    const { container, unmount } = render(<BussolaPlane entries={makeEntries(40)} />)
    const grupo = within(container).getByRole("group", { name: "Tipo de aposta" })
    const chips = [...grupo.querySelectorAll("button")]
    const nomes = chips.map((c) => (c.textContent ?? "").toLowerCase())
    for (const esperado of ["pode ir sem medo", "vale o risco", "só teu gosto", "fica pra depois"]) {
      expect(nomes.some((n) => n.includes(esperado))).toBe(true)
    }
    // "Todas" + os quatro tipos: a soma dos tipos é o total, ninguém fica fora nem conta duas vezes.
    const n = (c: Element) => Number((c.textContent ?? "").match(/(\d+)\s*$/)?.[1] ?? 0)
    const [todas, ...tipos] = chips
    expect(n(todas)).toBe(40)
    expect(tipos.reduce((s, c) => s + n(c), 0)).toBe(pointsOf(container).length)
    unmount()
  })

  it("lista cada obra do mapa no painel — a capa deixa de ser anônima", () => {
    const { container, unmount } = render(<BussolaPlane entries={makeEntries(40)} />)
    expect(container.querySelectorAll("[data-work]")).toHaveLength(40)
    unmount()
  })

  it("agrupa a lista em prateleiras quando Agrupar está ligado, sem mexer no mapa", () => {
    const semGrupo = render(<BussolaPlane entries={makeEntries(40)} />)
    const pontosAntes = pointsOf(semGrupo.container).length
    const linhasAntes = semGrupo.container.querySelectorAll("[data-work]").length
    semGrupo.unmount()

    const comGrupo = render(<BussolaPlane entries={makeEntries(40)} grouped />)
    expect(pointsOf(comGrupo.container)).toHaveLength(pontosAntes)
    expect(comGrupo.container.querySelectorAll("[data-work]")).toHaveLength(linhasAntes)
    expect(comGrupo.container.querySelectorAll("button[aria-expanded]").length).toBeGreaterThan(0)
    comGrupo.unmount()
  })
})

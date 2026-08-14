import { vi, describe, it, expect } from "vitest"

vi.mock("server-only", () => ({}))

import { render } from "@testing-library/react"
import { BussolaPlane } from "@/components/ranking/bussola-plane"
import type { BussolaDatum } from "@/components/ranking/bussola-plane"

/**
 * O teto de pontos da Bússola (`MAX_PLOT`).
 *
 * O plano fica legível enquanto os pontos não se empilham, e a degradação NÃO é
 * gradual — medido em 2026-08-06 sobre o catálogo real, num plano de 820×615:
 *
 *    40 obras (o `top_n` padrão) → 10,0% dos pontos a menos de 9px de outro
 *   100 obras                    → 12,0%
 *   965 obras (catálogo inteiro) → 52,6%   ← mancha listrada
 *
 * O eixo Y é `platform_avg × 10` arredondado, e num acervo curado isso dá só ~23
 * alturas distintas. Sem teto, afrouxar o filtro vira mancha SEM AVISO.
 */

function makeEntries(n: number): BussolaDatum[] {
  return Array.from({ length: n }, (_, i) => ({
    workId: `w${i}`,
    title: `Obra ${i}`,
    coverUrl: null, isAdult: false,
    year: 2020,
    chanceScore: 20 + ((i * 7) % 70),
    platformAvg: 7 + ((i * 3) % 25) / 10,
    totalVotes: 500 + i * 37,
    expectedScore: 8,
  }))
}

const dotsOf = (container: HTMLElement) => container.querySelectorAll("a[aria-label*='alcance']")

describe("BussolaPlane — teto de pontos", () => {
  it("desenha todas as obras quando o conjunto cabe no plano", () => {
    const { container, unmount } = render(<BussolaPlane entries={makeEntries(40)} />)
    expect(dotsOf(container)).toHaveLength(40)
    unmount()
  })

  it("corta em 100 e AVISA quando o conjunto passa do teto", () => {
    const { container, unmount } = render(<BussolaPlane entries={makeEntries(965)} />)
    expect(dotsOf(container)).toHaveLength(100)
    // O aviso é o que separa "recorte deliberado" de "bug silencioso": sem ele o
    // usuário lê o plano como se fosse o ranking inteiro.
    expect(container.textContent).toMatch(/mostrando as/i)
    expect(container.textContent).toContain("965")
    unmount()
  })

  it("não aplica teto na comparação (modo absoluto)", () => {
    // O drawer compara no máximo 10 obras; o teto nunca deveria interferir ali.
    const { container, unmount } = render(<BussolaPlane entries={makeEntries(10)} mode="absolute" />)
    expect(dotsOf(container)).toHaveLength(10)
    unmount()
  })
})

describe("BussolaPlane — cantos e lista pareada", () => {
  it("nomeia os quatro cantos com o vocabulário compartilhado e conta cada um", () => {
    const { container, unmount } = render(<BussolaPlane entries={makeEntries(40)} />)
    const corners = [...container.querySelectorAll("button[aria-pressed]")]
    const nomes = corners.map((c) => c.textContent ?? "")
    for (const esperado of ["pode ir sem medo", "vale o risco", "só teu gosto", "fica pra depois"]) {
      expect(nomes.some((n) => n.includes(esperado))).toBe(true)
    }
    // a soma das contagens dos cantos é o total de pontos: nenhuma obra fica
    // fora de um canto, e nenhuma é contada duas vezes
    const total = corners.reduce((sum, c) => {
      const m = (c.textContent ?? "").match(/(\d+)/)
      return sum + (m ? Number(m[1]) : 0)
    }, 0)
    expect(total).toBe(dotsOf(container).length)
    unmount()
  })

  it("lista cada obra do plano ao lado dele — o ponto deixa de ser anônimo", () => {
    const { container, unmount } = render(<BussolaPlane entries={makeEntries(40)} />)
    // A lista pareada marca cada linha com data-work; uma por obra plotada.
    expect(container.querySelectorAll("[data-work]")).toHaveLength(40)
    unmount()
  })

  it("agrupa a lista em prateleiras quando Agrupar está ligado, sem mexer no plano", () => {
    const semGrupo = render(<BussolaPlane entries={makeEntries(40)} />)
    const pontosAntes = dotsOf(semGrupo.container).length
    const linhasAntes = semGrupo.container.querySelectorAll("[data-work]").length
    semGrupo.unmount()

    const comGrupo = render(<BussolaPlane entries={makeEntries(40)} grouped />)
    // o plano é o mesmo — agrupar organiza a lista, não filtra o mapa
    expect(dotsOf(comGrupo.container)).toHaveLength(pontosAntes)
    expect(comGrupo.container.querySelectorAll("[data-work]")).toHaveLength(linhasAntes)
    // e surgem os cabeçalhos colapsáveis das prateleiras
    expect(comGrupo.container.querySelectorAll("button[aria-expanded]").length).toBeGreaterThan(0)
    comGrupo.unmount()
  })
})

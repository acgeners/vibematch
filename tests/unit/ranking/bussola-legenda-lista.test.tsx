import { vi, describe, it, expect } from "vitest"

vi.mock("server-only", () => ({}))

import { render, fireEvent } from "@testing-library/react"
import { BussolaPlane } from "@/components/ranking/bussola-plane"
import type { BussolaDatum } from "@/components/ranking/bussola-plane"
import { getScoreTextColor } from "@/components/ui/score-badge"

/**
 * O que a Bússola PROMETE em texto, e a ordem da lista pareada.
 *
 * As três coisas guardadas aqui têm o mesmo modo de falha: some sem quebrar
 * nada. Um eixo sem régua continua desenhando pontos, um tooltip sem o número
 * cru continua abrindo, e uma lista fora de ordem continua listando — em todos
 * os casos o plano segue "funcionando" e mentindo por omissão.
 */

// O hover do ponto rola a lista até a linha pareada, e pra isso usa
// `CSS.escape` — que o jsdom não implementa (o app roda em browser, onde ela
// existe desde sempre). Sem este stub o teste morre com "reading 'escape'" numa
// pilha do next/link, que não parece ter nada a ver com o tooltip.
if (typeof CSS === "undefined") {
  ;(globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = { escape: (s) => s }
}

const OBRAS: BussolaDatum[] = [
  { workId: "a", title: "Chance média", coverUrls: [], isAdult: false, year: 2021, chanceScore: 55, platformAvg: 8.2, totalVotes: 1200, expectedScore: 8.1 },
  { workId: "b", title: "Chance alta", coverUrls: [], isAdult: false, year: 2022, chanceScore: 78, platformAvg: 8.8, totalVotes: 23879, expectedScore: 8.4 },
  { workId: "c", title: "Chance baixa", coverUrls: [], isAdult: false, year: 2023, chanceScore: 21, platformAvg: 7.1, totalVotes: 90, expectedScore: 6.9 },
  { workId: "d", title: "Sem chance", coverUrls: [], isAdult: false, year: 2024, chanceScore: null, platformAvg: 7.6, totalVotes: 400, expectedScore: 7.2 },
  { workId: "e", title: "Chance quase alta", coverUrls: [], isAdult: false, year: 2020, chanceScore: 70, platformAvg: 7.9, totalVotes: 5000, expectedScore: 8.0 },
]

const linhas = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-work]")].map((el) => el.getAttribute("data-work"))

describe("BussolaPlane — réguas dos dois eixos", () => {
  it("diz o que significam os DOIS extremos de cada eixo, não só do horizontal", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    const texto = container.textContent ?? ""
    // eixo X
    expect(texto).toMatch(/menos chance de você gostar/i)
    expect(texto).toMatch(/mais chance/i)
    // eixo Y — a metade da decisão que ficava sem legenda nenhuma
    expect(texto).toMatch(/pior avaliada pela crítica/i)
    expect(texto).toMatch(/melhor avaliada/i)
    unmount()
  })

  it("mantém a régua do Y comparativa (mediana), nunca um juízo absoluto", () => {
    // O corte é a mediana do conjunto EXIBIDO: afirmar "bem avaliada" seria
    // falso pra metade do catálogo curado, onde 99,9% passam do limiar absoluto.
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    expect(container.textContent).toMatch(/mediana/i)
    unmount()
  })
})

describe("BussolaPlane — tooltip: Nota Prevista no topo", () => {
  const abrir = (container: HTMLElement, titulo: string) => {
    const alvo = [...container.querySelectorAll("a[aria-label*='alcance']")].find((el) =>
      (el.getAttribute("aria-label") ?? "").startsWith(titulo),
    )!
    fireEvent.mouseOver(alvo)
  }
  const notaDe = (container: HTMLElement, texto: string) =>
    [...container.querySelectorAll("span")].find((s) => s.textContent === texto)!

  it("abre o card com a Nota Prevista, em vírgula como o resto do card", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    abrir(container, "Chance alta")
    expect(container.textContent).toMatch(/prevista/i)
    expect(notaDe(container, "8,4")).toBeTruthy()
    unmount()
  })

  it("usa a MESMA régua de cor da nota no resto do app, com as faixas configuradas", () => {
    // Cor própria aqui seria uma 2ª régua pro mesmo número — é assim que duas
    // telas passam a discordar sobre a mesma obra.
    const semFaixas = render(<BussolaPlane entries={OBRAS} />)
    abrir(semFaixas.container, "Chance alta")
    expect(notaDe(semFaixas.container, "8,4").className).toContain(getScoreTextColor(8.4, undefined))
    semFaixas.unmount()

    // As faixas de /preferences mudam o tier da MESMA nota — se a prop fosse
    // ignorada, a cor ficaria parada no fallback fixo e ninguém perceberia.
    const faixas = { p_top: 8.0, p_high: 7.0, p_mid: 6.0, p_low: 5.0 }
    const comFaixas = render(<BussolaPlane entries={OBRAS} thresholds={faixas} />)
    abrir(comFaixas.container, "Chance alta")
    const classe = notaDe(comFaixas.container, "8,4").className
    expect(classe).toContain(getScoreTextColor(8.4, faixas))
    expect(classe).not.toContain(getScoreTextColor(8.4, undefined))
    comFaixas.unmount()
  })
})

describe("BussolaPlane — tooltip com o número cru", () => {
  it("mostra a nota externa e o volume de votos, além das forças normalizadas", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    const alvo = [...container.querySelectorAll("a[aria-label*='alcance']")].find((el) =>
      (el.getAttribute("aria-label") ?? "").startsWith("Chance alta"),
    )!
    fireEvent.mouseOver(alvo)

    const texto = container.textContent ?? ""
    // 88 (a força) não é uma nota e 96 (o alcance) não é um número de votos —
    // sem o cru, o tooltip não diz nada que a pessoa possa comparar com a
    // plataforma de onde o dado veio.
    expect(texto).toMatch(/Nota externa/i)
    expect(texto).toContain("8,8")
    expect(texto).toContain("23.879")
    expect(texto).toMatch(/votos/i)
    unmount()
  })

  it("não inventa votos quando a obra não tem nenhum", () => {
    const semVotos: BussolaDatum[] = [
      { ...OBRAS[0], workId: "z", title: "Zero votos", totalVotes: 0 },
      OBRAS[1],
    ]
    const { container, unmount } = render(<BussolaPlane entries={semVotos} />)
    const alvo = [...container.querySelectorAll("a[aria-label*='alcance']")].find((el) =>
      (el.getAttribute("aria-label") ?? "").startsWith("Zero votos"),
    )!
    fireEvent.mouseOver(alvo)
    expect(container.textContent).toMatch(/sem votos/i)
    expect(container.textContent).not.toMatch(/\b0 votos\b/)
    unmount()
  })
})

describe("BussolaPlane — selo 18+", () => {
  // A Bússola tem DUAS leituras, e o selo precisa das duas: o cartão de hover (a
  // lupa) e a lista pareada, que é a única forma de ler as obras sem passar o mouse
  // ponto a ponto. Só no cartão, a classificação existiria apenas sob o cursor.
  const COM_ADULTA: BussolaDatum[] = [{ ...OBRAS[0], isAdult: true }, OBRAS[1], OBRAS[2]]
  const selos = (container: HTMLElement) => [...container.querySelectorAll("[title='Conteúdo adulto (18+)']")]

  it("marca a obra 18+ na lista pareada, e só ela", () => {
    const { container, unmount } = render(<BussolaPlane entries={COM_ADULTA} />)
    const naLista = selos(container).filter((el) => el.closest("[data-work]"))
    expect(naLista).toHaveLength(1)
    expect(naLista[0].closest("[data-work]")?.getAttribute("data-work")).toBe("a")
    unmount()
  })

  it("marca também no cartão de hover, junto de ano e status", () => {
    const { container, unmount } = render(<BussolaPlane entries={COM_ADULTA} />)
    expect(selos(container).filter((el) => !el.closest("[data-work]"))).toHaveLength(0)

    const alvo = [...container.querySelectorAll("a[aria-label*='alcance']")].find((el) =>
      (el.getAttribute("aria-label") ?? "").startsWith("Chance média"),
    )!
    fireEvent.mouseOver(alvo)
    expect(selos(container).filter((el) => !el.closest("[data-work]"))).toHaveLength(1)
    unmount()
  })
})

describe("BussolaPlane — ordem da lista pareada", () => {
  it("ordena por chance, do maior pro menor — a mesma grandeza do eixo X", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    // entrada: 55, 78, 21, (sem chance), 70 → saída: 78, 70, 55, 21.
    // "Sem chance" não aparece porque sequer é plotada: sem as duas forças do
    // par Chance × Avaliação não há posição, e a lista é a legenda do plano.
    expect(linhas(container)).toEqual(["b", "e", "a", "c"])
    unmount()
  })

  it("ordena DENTRO de cada prateleira também", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} grouped />)
    const ordem = linhas(container)
    // as prateleiras reagrupam, mas dentro de cada uma a chance segue caindo
    const chances = ordem.map((id) => OBRAS.find((o) => o.workId === id)!.chanceScore)
    const porPrateleira: number[][] = []
    for (const c of chances) {
      if (c == null) continue
      const ultima = porPrateleira.at(-1)
      if (ultima && ultima.at(-1)! >= c) ultima.push(c)
      else porPrateleira.push([c])
    }
    for (const grupo of porPrateleira) {
      expect([...grupo].sort((x, y) => y - x)).toEqual(grupo)
    }
    unmount()
  })

  it("anuncia a ordem no cabeçalho da lista — ordem invisível é ordem que ninguém usa", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    expect(container.textContent).toMatch(/maior chance primeiro/i)
    unmount()
  })
})

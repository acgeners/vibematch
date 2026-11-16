import { vi, describe, it, expect, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))
const getBussolaLinks = vi.fn()
vi.mock("@/server/actions/bussola", () => ({ getBussolaLinks: (id: string) => getBussolaLinks(id) }))

import { render, fireEvent, within, act } from "@testing-library/react"
import { BussolaPlane } from "@/components/ranking/bussola-plane"
import type { BussolaDatum } from "@/components/ranking/bussola-plane"
import type { BussolaLinks } from "@/lib/ranking/bussola-links"
import { getScoreTextColor } from "@/components/ui/score-badge"

/**
 * O que o mapa de capas PROMETE na tela: eixos com o valor real, o cartão do mouse, a ordem da
 * lista, o selo 18+, o painel da obra clicada e as ligações. Todos têm o mesmo modo de falha —
 * some sem quebrar nada, e o mapa segue "funcionando" e mentindo por omissão.
 */

// O mouse numa capa rola a lista até a linha, com `CSS.escape` — que o jsdom não tem.
if (typeof CSS === "undefined") {
  ;(globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = { escape: (s) => s }
}

const OBRAS: BussolaDatum[] = [
  { workId: "a", title: "Chance média", coverUrls: [], isAdult: false, isMixed: false, year: 2021, chanceScore: 55, platformAvg: 8.2, totalVotes: 1200, expectedScore: 8.1 },
  { workId: "b", title: "Chance alta", coverUrls: [], isAdult: false, isMixed: false, year: 2022, chanceScore: 78, platformAvg: 8.8, totalVotes: 23879, expectedScore: 8.4 },
  { workId: "c", title: "Chance baixa", coverUrls: [], isAdult: false, isMixed: false, year: 2023, chanceScore: 21, platformAvg: 7.1, totalVotes: 90, expectedScore: 6.9 },
  { workId: "d", title: "Sem chance", coverUrls: [], isAdult: false, isMixed: false, year: 2024, chanceScore: null, platformAvg: 7.6, totalVotes: 400, expectedScore: 7.2 },
  { workId: "e", title: "Chance quase alta", coverUrls: [], isAdult: false, isMixed: false, year: 2020, chanceScore: 70, platformAvg: 7.9, totalVotes: 5000, expectedScore: 8.0 },
]

const LINKS: BussolaLinks = {
  similar: [
    { id: "e", title: "Chance quase alta", isAdult: false, isMixed: false, similarity: 0.34 },
    { id: "fora", title: "Obra fora do filtro", isAdult: true, isMixed: false, similarity: 0.31 },
  ],
  profile: [{ id: "fora2", title: "Outra fora", isAdult: false, isMixed: false, distance: 1.8 }],
  profileTotal: 1,
  groups: null,
}

const linhas = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-work]")].map((el) => el.getAttribute("data-work"))
const ponto = (container: HTMLElement, id: string) => container.querySelector<HTMLElement>(`[data-point="${id}"]`)!

beforeEach(() => {
  window.localStorage.clear()
  getBussolaLinks.mockReset()
  getBussolaLinks.mockResolvedValue(LINKS)
})

describe("Bússola — eixos com o valor real", () => {
  it("as marcas do eixo mostram o valor de verdade, e a do meio é a mediana", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    const texto = container.textContent ?? ""
    // chances no mapa: 21, 55, 70, 78 (a obra sem chance não entra)
    expect(texto).toContain("mediana 70%")
    expect(texto).toContain("21%")
    expect(texto).toContain("78%")
    // eixo vertical em nota da crítica
    expect(texto).toContain("★ 7,1")
    expect(texto).toContain("★ 8,8")
    unmount()
  })

  it("nomeia os dois eixos e os quatro cantos, com quantas obras há em cada um", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    const texto = container.textContent ?? ""
    expect(texto).toMatch(/chance de você gostar →/)
    expect(texto).toMatch(/★ crítica ↑/)
    for (const canto of ["Pode ir sem medo", "Vale o risco", "Só teu gosto", "Fica pra depois"]) {
      expect(texto).toContain(canto)
    }
    unmount()
  })
})

describe("Bússola — cartão do mouse", () => {
  it("mostra o nome e as duas medidas do par de eixos", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    fireEvent.mouseEnter(ponto(container, "b"))
    const tip = within(container).getByRole("tooltip")
    expect(tip.textContent).toContain("Chance alta")
    expect(tip.textContent).toContain("Chance de você gostar: 78%")
    expect(tip.textContent).toContain("Nota da crítica: 8,8")
    unmount()
  })
})

describe("Bússola — lista do painel", () => {
  it("ordena pela medida do eixo horizontal, do maior pro menor, e anuncia isso", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    // entrada 55, 78, 21, (sem chance), 70 → 78, 70, 55, 21. Sem chance não há posição.
    expect(linhas(container)).toEqual(["b", "e", "a", "c"])
    expect(container.textContent).toMatch(/maior chance primeiro/i)
    unmount()
  })

  it("ordena DENTRO de cada prateleira também", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} grouped />)
    const chances = linhas(container).map((id) => OBRAS.find((o) => o.workId === id)!.chanceScore!)
    const porPrateleira: number[][] = []
    for (const c of chances) {
      const ultima = porPrateleira.at(-1)
      if (ultima && ultima.at(-1)! >= c) ultima.push(c)
      else porPrateleira.push([c])
    }
    for (const grupo of porPrateleira) expect([...grupo].sort((x, y) => y - x)).toEqual(grupo)
    unmount()
  })

  it("a busca esmaece no mapa e tira da lista quem não casa", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    fireEvent.change(within(container).getByLabelText("Achar uma obra no mapa"), { target: { value: "baixa" } })
    expect(linhas(container)).toEqual(["c"])
    expect(ponto(container, "b").className).toContain("pointer-events-none")
    expect(ponto(container, "c").className).not.toContain("pointer-events-none")
    unmount()
  })

  it("marca a obra 18+ na lista, e só ela", () => {
    const comAdulta = [{ ...OBRAS[0], isAdult: true }, OBRAS[1], OBRAS[2]]
    const { container, unmount } = render(<BussolaPlane entries={comAdulta} />)
    const naLista = [...container.querySelectorAll("[title='Conteúdo adulto (18+)']")].filter((el) => el.closest("[data-work]"))
    expect(naLista).toHaveLength(1)
    expect(naLista[0].closest("[data-work]")?.getAttribute("data-work")).toBe("a")
    unmount()
  })
})

describe("Bússola — pares de eixos", () => {
  it("trocar para Chance × Alcance muda cantos, colunas e marcas, e a escolha fica salva", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    fireEvent.click(within(container).getByRole("button", { name: /Chance × Alcance/ }))
    const texto = container.textContent ?? ""
    expect(texto).toContain("Joia escondida")
    expect(texto).toContain("Votos")
    expect(texto).toMatch(/votos ↑/)
    expect(JSON.parse(window.localStorage.getItem("bussola_map_prefs_v1") ?? "{}").face).toBe("cv")
    unmount()
  })
})

describe("Bússola — obra clicada", () => {
  it("clicar seleciona (não navega) e o painel mostra as forças e a Nota Prevista na cor do app", async () => {
    const faixas = { p_top: 8.0, p_high: 7.0, p_mid: 6.0, p_low: 5.0 }
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} thresholds={faixas} />)
    await act(async () => fireEvent.click(ponto(container, "b")))
    expect(ponto(container, "b").getAttribute("aria-pressed")).toBe("true")
    const texto = container.textContent ?? ""
    expect(texto).toContain("Voltar à lista")
    expect(texto).toContain("23.879 votos")
    expect(texto).toMatch(/acima de \d+% das obras na tela/)
    const nota = [...container.querySelectorAll("b")].find((b) => b.textContent === "8,4")!
    expect(nota.className).toContain(getScoreTextColor(8.4, faixas))
    expect(nota.className).not.toContain(getScoreTextColor(8.4, undefined))
    unmount()
  })

  it("não inventa votos quando a obra não tem nenhum", async () => {
    const semVotos = [{ ...OBRAS[0], totalVotes: 0 }, OBRAS[1]]
    const { container, unmount } = render(<BussolaPlane entries={semVotos} />)
    await act(async () => fireEvent.click(ponto(container, "a")))
    expect(container.textContent).toMatch(/sem votos/i)
    expect(container.textContent).not.toMatch(/\b0 votos\b/)
    unmount()
  })

  it("lista as ligações no mapa E fora dele; só as do mapa ganham linha e ficam destacadas", async () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    await act(async () => fireEvent.click(ponto(container, "b")))
    expect(getBussolaLinks).toHaveBeenCalledWith("b")
    const chips = within(within(container).getByRole("group", { name: "Critério das ligações" }))
    expect(chips.getByRole("button", { name: /Parecidas/ }).textContent).toContain("1/2")
    expect(container.textContent).toContain("Obra fora do filtro")
    expect(container.textContent).toContain("fora do mapa")
    // a de fora carrega o selo 18+ dela
    const fora = container.querySelector('[data-link="fora"]')!
    expect(fora.querySelector("[title='Conteúdo adulto (18+)']")).not.toBeNull()
    expect(container.querySelectorAll("svg line")).toHaveLength(1)
    // a ligada no mapa ganha o anel azul; a clicada, o branco
    expect(ponto(container, "e").style.boxShadow).toContain("--primary")
    expect(ponto(container, "b").style.boxShadow).toContain("--foreground")
    unmount()
  })

  it("sem nenhuma ligada no mapa, nada esmaece e o painel diz por quê", async () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    await act(async () => fireEvent.click(ponto(container, "b")))
    fireEvent.click(within(container).getByRole("button", { name: /Mesmo perfil/ }))
    expect(container.textContent).toMatch(/Nenhuma está entre as obras do mapa/)
    expect(container.querySelectorAll("svg line")).toHaveLength(0)
    expect([...container.querySelectorAll("[data-point]")].some((el) => el.className.includes("opacity-55"))).toBe(false)
    unmount()
  })

  it("sem sessão, Mesmo grupo diz que os grupos são da conta, em vez de afirmar que não há nenhum", async () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    await act(async () => fireEvent.click(ponto(container, "b")))
    fireEvent.click(within(container).getByRole("button", { name: /Mesmo grupo/ }))
    expect(container.textContent).toMatch(/Entre na sua conta/)
    unmount()
  })

  it("Vizinhas no mapa não precisa do servidor e liga as 3 outras obras do mapa", async () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    await act(async () => fireEvent.click(ponto(container, "b")))
    fireEvent.click(within(container).getByRole("button", { name: /Vizinhas no mapa/ }))
    expect(container.querySelectorAll("svg line")).toHaveLength(3)
    unmount()
  })
})

describe("Bússola — tela inteira e nomes", () => {
  it("o botão de ampliar abre o mapa na tela inteira, com os controles no painel; Esc volta", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    fireEvent.click(within(container).getByRole("button", { name: "Ampliar o mapa" }))
    const full = document.body.querySelector('[aria-label="Bússola em tela inteira"]') as HTMLElement
    expect(full).not.toBeNull()
    // eixos e tipo de aposta viram seções que abrem e fecham
    const secoes = [...full.querySelectorAll("button[aria-expanded]")].map((b) => b.textContent ?? "")
    expect(secoes.some((t) => t.includes("Eixos"))).toBe(true)
    expect(secoes.some((t) => t.includes("Tipo de aposta"))).toBe(true)
    fireEvent.keyDown(window, { key: "Escape" })
    expect(document.body.querySelector('[aria-label="Bússola em tela inteira"]')).toBeNull()
    unmount()
  })

  it("sem obra clicada nenhum nome aparece; com 'Todos os nomes', aparecem", () => {
    const { container, unmount } = render(<BussolaPlane entries={OBRAS} />)
    const nomes = () => [...container.querySelectorAll("span[aria-hidden]")].filter((s) => s.className.includes("leading-[14px]"))
    expect(nomes()).toHaveLength(0)
    fireEvent.click(within(container).getByRole("button", { name: "Todos os nomes" }))
    expect(nomes().length).toBeGreaterThan(0)
    unmount()
  })
})

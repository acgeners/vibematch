import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { DiscoveryView } from "@/components/discovery/discovery-view"
import type { DiscoveryResult, DiscoverySeedInfo } from "@/server/queries/seed-discovery"

/**
 * Teste de RENDER de propósito.
 *
 * O que regride aqui não é a conta — é o que a tela AFIRMA. Um teste que lesse o
 * `DiscoveryResult` passaria verde com a culpada sendo nomeada num caso em que tirá-la não
 * resolve nada, com a anti-semente escondida atrás de um recolhido, e com a estrela oferecida
 * onde ela não significa coisa alguma. Os três dados estariam corretos no objeto.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

vi.mock("@/server/actions/discovery", () => ({
  suggestSeedReplacementsAction: vi.fn(async () => []),
}))

vi.mock("@/server/actions/work-search", () => ({
  searchWorkSuggestions: vi.fn(async () => []),
}))

function semente(id: string, title: string): DiscoverySeedInfo {
  return { id, title, year: 2021, coverUrl: null, hasEmbedding: true }
}

function resultado(over: Partial<DiscoveryResult> = {}): DiscoveryResult {
  return {
    works: [],
    seeds: [semente("a", "Obra A"), semente("b", "Obra B"), semente("c", "Obra C")],
    antiSeeds: [],
    cohesion: 0.093,
    anchoredCohesion: null,
    cohesionLevel: "weak",
    weakest: null,
    primaryId: null,
    primaryEffect: [],
    seedsIgnored: 0,
    candidateCount: 900,
    fitAvailable: true,
    extremesDivergence: 8,
    weight: 0.5,
    simMatrix: [],
    ...over,
  }
}

beforeEach(cleanup)

describe("o card das sementes", () => {
  it("abre com o VEREDITO, não com o número", () => {
    render(<DiscoveryView result={resultado()} onlyUnread />)

    expect(screen.getByText(/não apontam para o mesmo lugar/i)).toBeTruthy()
    // O número sobrevive, mas no rodapé e em corpo pequeno — junto do que ele significa.
    expect(screen.getByText(/o acaso é 0,00/i)).toBeTruthy()
    // 🔴 A escala em fonte mono saiu: ela pedia calibrar uma unidade que não existe fora
    // desta tela, e ficava ANTES da frase que a pessoa precisa ler.
    expect(screen.queryByText("0,15 fraca")).toBeNull()
  })

  it("o caso BOM não vira aula — uma linha, sem o parágrafo sobre centralização", () => {
    render(<DiscoveryView result={resultado({ cohesion: 0.31, cohesionLevel: "strong" })} />)

    expect(screen.getByText(/dividem um eixo claro/i)).toBeTruthy()
    expect(screen.queryByText(/média do catálogo é subtraída/i)).toBeNull()
  })

  it("🔴 nomeia a culpada quando tirá-la MUDA a faixa", () => {
    render(
      <DiscoveryView
        result={resultado({ weakest: { id: "c", before: 0.093, after: 0.22 } })}
        onlyUnread
      />,
    )

    // ⚠️ `getAllByText` porque "Obra C" aparece DUAS vezes de propósito — no chip e na frase
    // que a acusa. A asserção que importa é a frase, então ela é buscada pelo seu texto.
    expect(screen.getByText(/Quem está puxando para fora/i).textContent).toContain("Obra C")
    expect(screen.getByText(/0,09 → 0,22/)).toBeTruthy()
    expect(screen.getByRole("button", { name: /Tirar/i })).toBeTruthy()
  })

  it("🔴 NÃO nomeia culpada quando a remoção não muda a faixa", () => {
    // Sobe de 0,06 para 0,12 e continua "sem eixo em comum": "tire esta" seria um conselho
    // que não se pode seguir, e é exatamente o tipo de sugestão que gasta a confiança da
    // ferramenta. Aqui a tela oferece só as substitutas.
    render(
      <DiscoveryView
        result={resultado({ weakest: { id: "c", before: 0.06, after: 0.12 } })}
        onlyUnread
      />,
    )

    expect(screen.queryByRole("button", { name: /Tirar/i })).toBeNull()
    expect(screen.getByText(/Nenhuma semente sozinha explica/i)).toBeTruthy()
  })

  it("com 2 sementes explica que não dá para apontar a destoante", () => {
    render(
      <DiscoveryView
        result={resultado({ seeds: [semente("a", "Obra A"), semente("b", "Obra B")] })}
        onlyUnread
      />,
    )
    expect(screen.getByText(/abaixo do mínimo/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Tirar/i })).toBeNull()
  })
})

describe("anti-sementes recolhidas", () => {
  it("sem anti-semente, a seção é um link", () => {
    render(<DiscoveryView result={resultado()} onlyUnread />)
    expect(screen.getByRole("button", { name: /Evitar alguma obra\?/i })).toBeTruthy()
    expect(screen.queryByText(/Menos como esta/i)).toBeNull()
  })

  it("🔴 COM anti-semente, ela aparece — o aberto é derivado, não um estado à parte", () => {
    // Quem chega por um link com `anti=` tem que VER o filtro que está agindo. Um recolhido
    // guardado à parte esconderia um corte que a pessoa não pediu e não consegue achar.
    render(
      <DiscoveryView
        result={resultado({ antiSeeds: [semente("z", "Obra Evitada")] })}
        onlyUnread
      />,
    )
    expect(screen.getByText("Obra Evitada")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Evitar alguma obra\?/i })).toBeNull()
  })
})

describe("a estrela da semente principal", () => {
  it("é oferecida em cada semente positiva", () => {
    render(<DiscoveryView result={resultado()} onlyUnread />)
    expect(screen.getAllByRole("button", { name: /Tornar .* a semente principal/i })).toHaveLength(3)
  })

  it("🔴 NÃO aparece nas anti-sementes — ancorar no que se quer evitar não significa nada", () => {
    render(
      <DiscoveryView
        result={resultado({ antiSeeds: [semente("z", "Obra Evitada")] })}
        onlyUnread
      />,
    )
    expect(
      screen.queryByRole("button", { name: /Tornar Obra Evitada a semente principal/i }),
    ).toBeNull()
  })

  it("marca a principal e mostra as DUAS leituras de coesão", () => {
    render(
      <DiscoveryView
        result={resultado({
          primaryId: "a",
          anchoredCohesion: 0.1695,
          cohesionLevel: "fair",
          primaryEffect: Array(11).fill({ enters: 1, moves: 4 }),
        })}
        onlyUnread
      />,
    )

    expect(screen.getByRole("button", { name: /deixa de ser a semente principal/i })).toBeTruthy()
    // ⚠️ Asserção sobre a LINHA inteira, não sobre cada palavra: "ancorado" também aparece
    // no rodapé ("eixo ancorado 0,17"), e um seletor por palavra solta casa os dois. O que
    // importa é que a MESMA linha traga os dois números lado a lado.
    const leituras = screen.getByText(/todos os pares/i).parentElement!
    expect(leituras.textContent).toContain("0,09")
    expect(leituras.textContent).toContain("ancorado")
    expect(leituras.textContent).toContain("0,17")
    // 🔴 A discordância entre as duas é DITA, não escondida atrás do veredito escolhido.
    expect(screen.getByText(/As duas leituras discordam/i)).toBeTruthy()
  })

  it("sem principal, nenhuma das duas leituras é impressa", () => {
    render(<DiscoveryView result={resultado()} onlyUnread />)
    expect(screen.queryByText(/todos os pares/i)).toBeNull()
  })
})

describe("Limpar", () => {
  it("aparece com sementes e some sem elas", () => {
    render(<DiscoveryView result={resultado()} onlyUnread />)
    expect(screen.getByRole("button", { name: "Limpar" })).toBeTruthy()

    cleanup()
    render(<DiscoveryView result={resultado({ seeds: [], cohesion: null })} onlyUnread />)
    expect(screen.queryByRole("button", { name: "Limpar" })).toBeNull()
  })
})

describe("o controle de mistura", () => {
  it("diz o que a posição ATUAL significa e traduz a divergência", () => {
    render(<DiscoveryView result={resultado()} onlyUnread />)

    expect(screen.getByText(/Metade parecença, metade o seu gosto/i)).toBeTruthy()
    expect(screen.getByText(/Este controle importa aqui/i)).toBeTruthy()
    expect(screen.getByText("8 das 10")).toBeTruthy()
  })

  it("quando os eixos concordam, diz isso em vez de deixar arrastar à toa", () => {
    render(<DiscoveryView result={resultado({ extremesDivergence: 0 })} onlyUnread />)
    expect(screen.getByText(/Tanto faz nesta busca/i)).toBeTruthy()
  })
})

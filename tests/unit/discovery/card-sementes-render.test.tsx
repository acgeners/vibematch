import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { DiscoveryView } from "@/components/discovery/discovery-view"
import type { DiscoveryViewMode } from "@/components/discovery/discovery-view"
import type { DiscoveryResult, DiscoverySeedInfo, DiscoveryWork } from "@/server/queries/seed-discovery"

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

/**
 * ⚠️ Helper em vez de `view` opcional com default no componente: a rota já decide o padrão,
 * e um 2º default no componente seria duas fontes para o mesmo fato — mudar uma e esquecer a
 * outra é o defeito que este arquivo inteiro persegue.
 */
function mostrar(result: DiscoveryResult, view: DiscoveryViewMode = "lista") {
  return render(<DiscoveryView result={result} onlyUnread view={view} />)
}

beforeEach(cleanup)

describe("o card das sementes", () => {
  it("abre com o VEREDITO, não com o número", () => {
    mostrar(resultado())

    expect(screen.getByText(/não apontam para o mesmo lugar/i)).toBeTruthy()
    // O número sobrevive, mas no rodapé e em corpo pequeno — junto do que ele significa.
    expect(screen.getByText(/o acaso é 0,00/i)).toBeTruthy()
    // 🔴 A escala em fonte mono saiu: ela pedia calibrar uma unidade que não existe fora
    // desta tela, e ficava ANTES da frase que a pessoa precisa ler.
    expect(screen.queryByText("0,15 fraca")).toBeNull()
  })

  it("o caso BOM não vira aula — uma linha, sem o parágrafo sobre centralização", () => {
    mostrar(resultado({ cohesion: 0.31, cohesionLevel: "strong" }))

    expect(screen.getByText(/dividem um eixo claro/i)).toBeTruthy()
    expect(screen.queryByText(/média do catálogo é subtraída/i)).toBeNull()
  })

  it("🔴 nomeia a culpada quando tirá-la MUDA a faixa", () => {
    mostrar(resultado({ weakest: { id: "c", before: 0.093, after: 0.22 } }))

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
    mostrar(resultado({ weakest: { id: "c", before: 0.06, after: 0.12 } }))

    expect(screen.queryByRole("button", { name: /Tirar/i })).toBeNull()
    expect(screen.getByText(/Nenhuma semente sozinha explica/i)).toBeTruthy()
  })

  it("com 2 sementes explica que não dá para apontar a destoante", () => {
    mostrar(resultado({ seeds: [semente("a", "Obra A"), semente("b", "Obra B")] }))
    expect(screen.getByText(/abaixo do mínimo/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Tirar/i })).toBeNull()
  })
})

describe("anti-sementes recolhidas", () => {
  it("sem anti-semente, a seção é um link", () => {
    mostrar(resultado())
    expect(screen.getByRole("button", { name: /Evitar alguma obra\?/i })).toBeTruthy()
    expect(screen.queryByText(/Menos como esta/i)).toBeNull()
  })

  it("🔴 COM anti-semente, ela aparece — o aberto é derivado, não um estado à parte", () => {
    // Quem chega por um link com `anti=` tem que VER o filtro que está agindo. Um recolhido
    // guardado à parte esconderia um corte que a pessoa não pediu e não consegue achar.
    mostrar(resultado({ antiSeeds: [semente("z", "Obra Evitada")] }))
    expect(screen.getByText("Obra Evitada")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Evitar alguma obra\?/i })).toBeNull()
  })
})

describe("a estrela da semente principal", () => {
  it("é oferecida em cada semente positiva", () => {
    mostrar(resultado())
    expect(screen.getAllByRole("button", { name: /Tornar .* a semente principal/i })).toHaveLength(3)
  })

  it("🔴 NÃO aparece nas anti-sementes — ancorar no que se quer evitar não significa nada", () => {
    mostrar(resultado({ antiSeeds: [semente("z", "Obra Evitada")] }))
    expect(
      screen.queryByRole("button", { name: /Tornar Obra Evitada a semente principal/i }),
    ).toBeNull()
  })

  it("marca a principal e mostra as DUAS leituras de coesão", () => {
    mostrar(resultado({
          primaryId: "a",
          anchoredCohesion: 0.1695,
          cohesionLevel: "fair",
          primaryEffect: Array(11).fill({ enters: 1, moves: 4 }),
        }))

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
    mostrar(resultado())
    expect(screen.queryByText(/todos os pares/i)).toBeNull()
  })
})

describe("Limpar", () => {
  it("aparece com sementes e some sem elas", () => {
    mostrar(resultado())
    expect(screen.getByRole("button", { name: "Limpar" })).toBeTruthy()

    cleanup()
    mostrar(resultado({ seeds: [], cohesion: null }))
    expect(screen.queryByRole("button", { name: "Limpar" })).toBeNull()
  })
})

function obra(over: Partial<DiscoveryWork> = {}): DiscoveryWork {
  return {
    id: "w1",
    title: "Elissa's Whirlwind Marriage",
    year: 2022,
    totalChapters: 110,
    publicationStatusId: null,
    personalStatusId: null,
    isAdult: false,
    coverUrl: "https://exemplo/capa.jpg",
    synopsis: null,
    simPercentile: 100,
    simRaw: 0.4,
    fitPercentile: 90,
    score: 95,
    nearestSeedId: null,
    nearestSeedTitle: null,
    expectedScore: 8.2,
    alignmentScore: 93,
    alignmentStale: false,
    userScore: null,
    ...over,
  }
}

describe("a lista de resultados", () => {
  it("🔴 nomeia as colunas — os quatro números tinham escalas diferentes e nenhum rótulo", () => {
    mostrar(resultado({ works: [obra()] }))

    // As palavras são as MESMAS do controle acima. Antes eram `sim` e `vc`, que não existem
    // em lugar nenhum da página, repetidas em cada linha por não haver cabeçalho.
    expect(screen.getByText("similaridade")).toBeTruthy()
    expect(screen.getByText("a minha cara")).toBeTruthy()
    expect(screen.getByText("prevista")).toBeTruthy()
    expect(screen.getByText("veredito")).toBeTruthy()
    expect(screen.getByText(/combinação/)).toBeTruthy()
    expect(screen.queryByText("vc")).toBeNull()
  })

  it("🔴 mostra a CAPA da obra — a lista nunca mostrou uma", () => {
    // `coverUrl` saía de `seedMeta`, que só contém sementes: para toda obra do resultado o
    // valor era `undefined` e a linha caía no placeholder cinza, em 100% dos casos.
    mostrar(resultado({ works: [obra()] }))
    const img = document.querySelector("img[alt='']") as HTMLImageElement | null
    expect(img).not.toBeNull()
    expect(img!.getAttribute("src")).toContain("capa.jpg")
  })

  it("a combinação aparece em DESTAQUE, não em corpo miúdo", () => {
    // ⚠️ O número exibido é CALCULADO pelo blend no cliente, não lido de `work.score`:
    // 100 de similaridade e 90 de alinhamento, meio a meio, dão 95. Afirmar 97 aqui só
    // passaria se a tela ignorasse o peso — que é o oposto do que ela deve fazer.
    mostrar(resultado({ works: [obra({ simPercentile: 100, fitPercentile: 90 })] }))
    const n = screen.getByText("95")
    expect(n.className).toMatch(/text-lg/)
    expect(n.className).toMatch(/font-semibold/)
  })

  it("🔴 o chip diz o que ACONTECE, não onde a obra está", () => {
    // "só deste lado" exigia saber que o controle tem duas pontas e que a lista muda entre
    // elas — quem desenhou a página não entendeu, e isso é veredito suficiente.
    //
    // ⚠️ Precisa de MAIS de 10 obras: a marca compara os top-10 das duas pontas, e com 10 ou
    // menos os dois conjuntos são a lista inteira — nenhuma marca apareceria, e o teste
    // passaria verde por vacuidade.
    const doze = Array.from({ length: 12 }, (_, i) =>
      obra({
        id: `w${i}`,
        title: `Obra ${i}`,
        simPercentile: 100 - i * 5, // as 10 primeiras por similaridade são i = 0..9
        fitPercentile: i * 5, // por alinhamento a ordem se inverte
      }),
    )
    mostrar(resultado({ works: doze }))

    expect(screen.getAllByText(/sai em “A minha cara”/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/sai em “Similaridade”/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/só deste lado/)).toBeNull()
  })

  it("troca entre lista e cards", () => {
    mostrar(resultado({ works: [obra()] }), "cards")
    // Nos cards o ranking desce para corpo pequeno ao lado da combinação.
    expect(screen.getByText("#1")).toBeTruthy()
    // E o cabeçalho de colunas não existe: em card não há coluna que alinhe.
    expect(screen.queryByText("similaridade")).toBeNull()

    cleanup()
    mostrar(resultado({ works: [obra()] }), "lista")
    expect(screen.getByText("similaridade")).toBeTruthy()
    expect(screen.queryByText("#1")).toBeNull()
  })

  it("o alternador de visão está sempre disponível", () => {
    mostrar(resultado({ works: [obra()] }))
    expect(screen.getByRole("button", { name: "Lista" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Cards" })).toBeTruthy()
  })
})

describe("o vocabulário", () => {
  it("🔴 “parecença” não sobrou em lugar nenhum da tela", () => {
    // A palavra estava em 9 strings visíveis. Trocar só a coluna deixaria a lista dizendo
    // "similaridade" e o controle logo acima dizendo "parecença" sobre o MESMO eixo.
    mostrar(resultado({ works: [obra()] }))
    expect(document.body.textContent?.toLowerCase()).not.toContain("parecen")
  })

  it("a ponta do controle e a coluna usam a mesma palavra", () => {
    mostrar(resultado({ works: [obra()] }))
    expect(screen.getByText(/◄ Similaridade/)).toBeTruthy()
    expect(screen.getByText("similaridade")).toBeTruthy()
  })
})

describe("o controle de mistura", () => {
  it("diz o que a posição ATUAL significa e traduz a divergência", () => {
    mostrar(resultado())

    expect(screen.getByText(/Metade similaridade, metade o seu gosto/i)).toBeTruthy()
    expect(screen.getByText(/Este controle importa aqui/i)).toBeTruthy()
    expect(screen.getByText("8 das 10")).toBeTruthy()
  })

  it("quando os eixos concordam, diz isso em vez de deixar arrastar à toa", () => {
    mostrar(resultado({ extremesDivergence: 0 }))
    expect(screen.getByText(/Tanto faz nesta busca/i)).toBeTruthy()
  })
})

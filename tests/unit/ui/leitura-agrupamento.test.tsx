import { vi, describe, it, expect, afterEach, beforeEach } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("@/lib/reading-view-preference", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  writeReadingViewCookie: vi.fn(),
}))
vi.mock("@/server/actions/reading", () => ({ checkReadingUpdates: vi.fn() }))
vi.mock("@/server/actions/works", () => ({
  setChaptersRead: vi.fn(),
  setReadingStatusForWorks: vi.fn(),
  archiveWork: vi.fn(),
}))

import { ReadingList } from "@/components/reading/reading-list"
import { READING_COLLAPSED_BANDS_COOKIE, parseCollapsedBands } from "@/lib/reading-view-preference"
import type { ReadingWork } from "@/server/queries/reading"

/** Teste de RENDER: o que regride aqui é em que seção a obra aparece, e isso só existe na árvore. */

const ONGOING = 2
const COMPLETED = 1
const HIATUS = 3
const CANCELLED = 4
const UNKNOWN = 5

const hoje = new Date()
const diasAtras = (n: number) => new Date(hoje.getTime() - n * 864e5).toISOString()

const base = {
  personalStatusId: 2,
  coverUrls: [],
  lastReadAt: diasAtras(2),
  lastTouchedAt: null,
  lastChapterReleasedAt: null,
  nextChapterPredictedAt: null,
  chaptersCheckedAt: null,
  comixHid: null,
  hiatusKind: null,
  hiatusKindConfidence: null,
  publicationStatusNote: null,
  isAdult: false,
  isMixed: false,
  readEdition: null,
  defaultEdition: null,
  synopsisQuality: null,
  expectedScore: 8,
  alignmentScore: null,
  byEdition: null,
  criterionScores: {},
  chaptersRead: 10,
  totalChapters: 12,
} satisfies Partial<ReadingWork>

const obra = (id: string, title: string, over: Partial<ReadingWork>): ReadingWork =>
  ({ ...base, id, title, publicationStatusId: ONGOING, ...over }) as ReadingWork

const WORKS: ReadingWork[] = [
  obra("a", "Saindo", {}),
  obra("b", "Terminada", { publicationStatusId: COMPLETED, chaptersRead: 10, totalChapters: 40, lastReadAt: diasAtras(90) }),
  obra("c", "Volta em Maio", { publicationStatusId: HIATUS, hiatusKind: "between_seasons", lastReadAt: diasAtras(2) }),
  obra("d", "Parou no Meio", { publicationStatusId: HIATUS, hiatusKind: "mid_season", lastReadAt: diasAtras(90) }),
  obra("e", "Hiato Mudo", { publicationStatusId: HIATUS }),
  obra("f", "Encerrada", { publicationStatusId: CANCELLED }),
  obra("g", "Sem Informação", { publicationStatusId: UNKNOWN }),
  obra("h", "Sem Status Nenhum", { publicationStatusId: null }),
]

const secao = (id: string) => document.getElementById(`section-${id}`) as HTMLElement
// A pílula vem antes do cabeçalho da seção, que tem o mesmo nome.
const pilula = (nome: RegExp) => screen.getAllByRole("button", { name: nome })[0]!
const renderizar = (collapsed: string[] = [], works = WORKS) =>
  render(<ReadingList works={works} defaultView="list" nowIso={hoje.toISOString()} defaultCollapsedBands={collapsed} />)

beforeEach(() => {
  document.cookie = `${READING_COLLAPSED_BANDS_COOKIE}=; max-age=0; path=/`
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("três seções, pela situação da publicação", () => {
  it("as pílulas contam cada uma", () => {
    renderizar()
    expect(pilula(/^Em andamento/).textContent).toContain("1")
    expect(pilula(/^Concluídas/).textContent).toContain("1")
    expect(pilula(/^Outras/).textContent).toContain("6")
    expect(screen.queryByText(/Concluída & outras/)).toBeNull()
  })

  it("a primeira seção com obra abre sozinha, e as outras esperam o clique", () => {
    renderizar()
    expect(within(secao("ongoing")).getByText("Saindo")).toBeTruthy()
    expect(within(secao("others")).queryByText("Parou no Meio")).toBeNull()
  })

  it("sem obra em andamento, abre a seguinte", () => {
    renderizar([], WORKS.filter((w) => w.publicationStatusId !== ONGOING))
    expect(document.getElementById("section-ongoing")).toBeNull()
    expect(within(secao("completed")).getByText("Terminada")).toBeTruthy()
  })
})

describe("Outras, pelo motivo da parada", () => {
  const abrirOutras = () => {
    renderizar()
    fireEvent.click(pilula(/^Outras/))
    return within(secao("others"))
  }
  const grupo = (id: string) => within(document.getElementById(`band-others-${id}`) as HTMLElement)

  it("cada obra cai no motivo dela", () => {
    abrirOutras()
    expect(grupo("season_break").getByText("Volta em Maio")).toBeTruthy()
    expect(grupo("interrupted").getByText("Parou no Meio")).toBeTruthy()
    expect(grupo("hiatus").getByText("Hiato Mudo")).toBeTruthy()
    expect(grupo("cancelled").getByText("Encerrada")).toBeTruthy()
    expect(grupo("unknown").getByText("Sem Informação")).toBeTruthy()
    expect(grupo("unknown").getByText("Sem Status Nenhum")).toBeTruthy()
  })

  it("a triagem não aparece aqui", () => {
    const outras = abrirOutras()
    expect(outras.queryByText("Parado")).toBeNull()
    expect(outras.queryByText("Continuar")).toBeNull()
    expect(outras.getAllByRole("button", { name: /^Em hiato/ }).length).toBeGreaterThan(0)
  })

  it("Em andamento não oferece mais grupo que nunca enche", () => {
    renderizar()
    expect(within(secao("ongoing")).queryByText("Entre temporadas")).toBeNull()
    expect(within(secao("ongoing")).queryByText("Publicação interrompida")).toBeNull()
  })

  it("On-hold e Arquivar só em quem está parado há 45 dias ou mais", () => {
    abrirOutras()
    expect(grupo("interrupted").getByRole("button", { name: /On-hold/ })).toBeTruthy()
    expect(grupo("season_break").queryByRole("button", { name: /On-hold/ })).toBeNull()
  })

  it("Concluídas seguem na triagem, com as ações em Parado", () => {
    renderizar()
    fireEvent.click(pilula(/^Concluídas/))
    expect(within(document.getElementById("band-completed-parado") as HTMLElement).getByRole("button", { name: /On-hold/ })).toBeTruthy()
  })
})

describe("cada grupo recolhe", () => {
  const grade = () => document.querySelector("#band-others-season_break .auto-rows-fr") as HTMLElement
  const cabecalho = () => within(document.getElementById("band-others-season_break") as HTMLElement).getByRole("button", { name: /Entre temporadas/ })
  const abrirOutras = (collapsed: string[] = []) => {
    renderizar(collapsed)
    fireEvent.click(pilula(/^Outras/))
  }

  it("clicar no título recolhe e expande", () => {
    abrirOutras()
    expect(cabecalho().getAttribute("aria-expanded")).toBe("true")
    fireEvent.click(cabecalho())
    expect(cabecalho().getAttribute("aria-expanded")).toBe("false")
    expect(grade().className).toContain("hidden")
    fireEvent.click(cabecalho())
    expect(grade().className).not.toContain("hidden")
  })

  it("recolher esconde sem desmontar o card, senão o save pendente do stepper se perde", () => {
    abrirOutras()
    fireEvent.click(cabecalho())
    expect(document.getElementById("work-c")).not.toBeNull()
  })

  it("a escolha fica no cookie e volta recolhida", () => {
    abrirOutras()
    fireEvent.click(cabecalho())
    expect(document.cookie).toContain(`${READING_COLLAPSED_BANDS_COOKIE}=others:season_break`)
    cleanup()
    abrirOutras(["others:season_break"])
    expect(grade().className).toContain("hidden")
  })

  it("o chip do resumo reabre o grupo recolhido e rola até ele", () => {
    abrirOutras(["others:season_break"])
    fireEvent.click(within(secao("others")).getAllByRole("button", { name: /Entre temporadas/ })[0]!)
    expect(grade().className).not.toContain("hidden")
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })
})

describe("o cookie dos grupos", () => {
  it("lê só chaves válidas", () => {
    expect(parseCollapsedBands("ongoing:slowing|others:hiatus")).toEqual(["ongoing:slowing", "others:hiatus"])
    expect(parseCollapsedBands("<script>|ongoing:slowing|")).toEqual(["ongoing:slowing"])
    expect(parseCollapsedBands(undefined)).toEqual([])
  })
})

describe("as regras novas na tela", () => {
  it("obra nova com 2 de 3 lidos cai em Acompanhando", () => {
    renderizar([], [obra("n", "Recém Lançada", { chaptersRead: 2, totalChapters: 3 })])
    expect(within(document.getElementById("band-ongoing-onpace") as HTMLElement).getByText("Recém Lançada")).toBeTruthy()
  })

  it("obra sem data de leitura diz que é estimativa e usa a última alteração", () => {
    renderizar([], [obra("s", "Sem Data", { chaptersRead: 28, totalChapters: 30, lastReadAt: null, lastTouchedAt: diasAtras(3) })])
    expect(within(document.getElementById("band-ongoing-onpace") as HTMLElement).getByText("Sem Data")).toBeTruthy()
    expect(screen.getByText(/Sem data de leitura · última alteração/)).toBeTruthy()
  })

  it("o texto de cada grupo sai das constantes, não de número escrito à mão", () => {
    renderizar([], [obra("n", "Recém Lançada", { chaptersRead: 2, totalChapters: 3 })])
    expect(screen.getByText("faltam até 7 capítulos e você leu há menos de 30 dias")).toBeTruthy()
  })
})

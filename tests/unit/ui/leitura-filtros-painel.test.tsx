import { vi, describe, it, expect, afterEach, beforeEach } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("@/lib/reading-view-preference", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  writeReadingViewCookie: vi.fn(),
}))

const checkReadingUpdates = vi.fn()
vi.mock("@/server/actions/reading", () => ({
  checkReadingUpdates: (...args: unknown[]) => checkReadingUpdates(...args),
}))
vi.mock("@/server/actions/works", () => ({
  setChaptersRead: vi.fn(),
  setReadingStatusForWorks: vi.fn(),
  archiveWork: vi.fn(),
}))

import { ReadingList } from "@/components/reading/reading-list"
import type { ReadingWork } from "@/server/queries/reading"

/**
 * Teste de RENDER de propósito: o que regride aqui é a tela deixar de consumir a régua (o filtro
 * cortar sem chip, o calendário ignorar o painel). A função pura passaria verde nos dois casos.
 */

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub)

const NOW = "2026-11-01T12:00:00.000Z"

// `publicationStatusId: 2` = Ongoing: todas caem na seção "Em andamento", aberta por padrão.
const base = {
  publicationStatusId: 2,
  personalStatusId: 2,
  coverUrls: [],
  lastReadAt: "2026-10-30T12:00:00.000Z",
  lastTouchedAt: null,
  lastChapterReleasedAt: null,
  nextChapterPredictedAt: null,
  chaptersCheckedAt: null,
  comixHid: null,
  latestChapterUrl: null,
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
  chaptersRead: 10,
  totalChapters: 12,
} satisfies Partial<ReadingWork>

const WORKS: ReadingWork[] = [
  { ...base, id: "leve", title: "Obra Leve", synopsisQuality: "♥♥♥♥", criterionScores: { tragedy: 2, romance: 8 } },
  { ...base, id: "pesada", title: "Obra Pesada", synopsisQuality: "♥♥", criterionScores: { tragedy: 8, romance: 7 } },
  { ...base, id: "adulta", title: "Obra Adulta", isAdult: true, criterionScores: { tragedy: 3, romance: 8 } },
  {
    ...base,
    id: "r19",
    title: "Obra R19",
    isMixed: true,
    readEdition: "r18",
    defaultEdition: "r18",
    synopsisQuality: "♥♥♥♥",
    criterionScores: { adult_content: 9, romance: 8 },
    byEdition: { normal: { expectedScore: 8, adultContent: 6 }, r18: { expectedScore: 8, adultContent: 9 } },
  },
]

const titulos = () => ["Obra Leve", "Obra Pesada", "Obra Adulta", "Obra R19"].filter((t) => screen.queryByText(t))
const abrir = () => fireEvent.click(screen.getByRole("button", { name: /^Filtros/ }))
const renderizar = (query = "") =>
  render(<ReadingList works={WORKS} defaultView="list" nowIso={NOW} initialFilterQuery={query} />)

beforeEach(() => window.history.replaceState(null, "", "/reading"))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("o botão Filtros", () => {
  it("nasce fechado: a página abre como hoje", () => {
    renderizar()
    expect(screen.getByRole("button", { name: /^Filtros/ }).getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("Conteúdo 18+")).toBeNull()
    expect(titulos()).toHaveLength(4)
    expect(screen.queryByText("Filtrando")).toBeNull()
  })

  it("abre e fecha o painel", () => {
    renderizar()
    abrir()
    expect(screen.getByText("Conteúdo 18+")).toBeTruthy()
    expect(screen.getByText("Atributos")).toBeTruthy()
    abrir()
    expect(screen.queryByText("Conteúdo 18+")).toBeNull()
  })
})

describe("filtrar", () => {
  it("corta a lista na hora, sem botão de aplicar, e o resumo acompanha", () => {
    renderizar()
    abrir()
    fireEvent.click(screen.getByRole("button", { name: /^Ocultar/ }))
    expect(titulos()).toEqual(["Obra Leve", "Obra Pesada"])
    expect(screen.getByText(/^de 4$/, { exact: false })).toBeTruthy()
    expect(screen.getByText("Seu ritmo nas 2 em andamento")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Aplicar/ })).toBeNull()
  })

  it("a obra R19 lida na R18 sai de Ocultar e fica em Só 18+", () => {
    renderizar()
    abrir()
    fireEvent.click(screen.getByRole("button", { name: /^Só 18\+/ }))
    expect(titulos()).toEqual(["Obra Adulta", "Obra R19"])
  })

  it("mostra quantas obras sobram em cada opção", () => {
    renderizar()
    abrir()
    expect(screen.getByRole("button", { name: /^Ocultar/ }).textContent).toContain("2")
    expect(screen.getByRole("button", { name: /^Tudo/ }).textContent).toContain("4")
    expect(screen.getByRole("button", { name: "Sem interesse marcado" }).textContent).toContain("1")
  })

  it("a explicação da R19 fica atrás do ⓘ, e só existe com obra R19 na lista", () => {
    const texto = /Obras R19 seguem a versão que você lê: 1 na R18\./
    renderizar()
    abrir()
    expect(screen.queryByText(texto)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Como as obras R19 entram neste filtro" }))
    expect(screen.getByText(texto)).toBeTruthy()
    cleanup()

    render(<ReadingList works={WORKS.filter((w) => !w.isMixed)} defaultView="list" nowIso={NOW} />)
    abrir()
    expect(screen.queryByRole("button", { name: "Como as obras R19 entram neste filtro" })).toBeNull()
  })

  it("a cobertura da nota só aparece depois de expandir o atributo", () => {
    renderizar()
    abrir()
    const pilula = screen.getByRole("button", { name: /Angústia/ })
    expect(pilula.textContent).not.toMatch(/\d/)
    expect(screen.queryByText(/das 4 obras têm nota/)).toBeNull()
    fireEvent.click(pilula)
    expect(screen.getByText("Só 0 das 4 obras têm nota de Angústia por enquanto.")).toBeTruthy()
  })

  it("o limiar grava em pontos, pelo atalho do editor", () => {
    renderizar()
    abrir()
    fireEvent.click(screen.getByRole("button", { name: /Tragédia/ }))
    fireEvent.click(screen.getByRole("button", { name: /^≤ 3/ }))
    expect(window.location.search).toBe("?max_tragedy=3")
    // A obra R19 não tem nota de Tragédia: sai, e a tela diz isso.
    expect(titulos()).toEqual(["Obra Leve", "Obra Adulta"])
    expect(screen.getByText(/1 obra sem nota de Tragédia sai da lista/)).toBeTruthy()
  })

  it("zero resultado oferece a saída", () => {
    renderizar("min_tragedy=9&max_tragedy=9.5&adult=only")
    expect(screen.getByText("Nenhuma obra com esse filtro.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }))
    expect(titulos()).toHaveLength(4)
    expect(window.location.search).toBe("")
  })
})

describe("o filtro fica visível e sobrevive", () => {
  it("com o painel fechado, o chip e o contador continuam dizendo o que corta", () => {
    renderizar("adult=hide&max_tragedy=3")
    expect(screen.getByText("Filtrando")).toBeTruthy()
    expect(screen.getByText("18+: ocultar")).toBeTruthy()
    expect(screen.getByText("Tragédia ≤ 3")).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Filtros/ }).textContent).toContain("2")
    expect(titulos()).toEqual(["Obra Leve"])
  })

  it("o chip desfaz só o que é dele", () => {
    renderizar("adult=hide&max_tragedy=3")
    fireEvent.click(screen.getByRole("button", { name: "Remover Tragédia ≤ 3" }))
    expect(window.location.search).toBe("?adult=hide")
    expect(titulos()).toEqual(["Obra Leve", "Obra Pesada"])
  })

  it("Limpar tudo não mexe no que não é filtro da página", () => {
    window.history.replaceState(null, "", "/reading?adult=hide&outro=1")
    renderizar("adult=hide&outro=1")
    fireEvent.click(screen.getByRole("button", { name: "Limpar tudo" }))
    expect(window.location.search).toBe("?outro=1")
  })
})

describe("o que continua olhando a lista inteira, e o que não", () => {
  it("Verificar atualizações checa as 4 obras mesmo com filtro ligado", async () => {
    checkReadingUpdates.mockResolvedValue([{ workId: "leve", hasNew: false }])
    renderizar("adult=hide")
    await act(async () => {
      screen.getByText("Verificar atualizações").click()
      await Promise.resolve()
    })
    expect(checkReadingUpdates.mock.calls[0]?.[0]).toEqual(["leve", "pesada", "adulta", "r19"])
  })

  it("o painel também vale no calendário", () => {
    // Com capa, porque é pelo `alt` dela que a obra aparece. E cada uma num dia: no jsdom a célula
    // mede 0px e só desenha a primeira capa, o que deixaria o teste verde com o filtro desligado.
    const comData = WORKS.map((w, i) => ({
      ...w,
      coverUrls: ["https://example.test/capa.jpg"],
      lastChapterReleasedAt: `2026-11-0${i + 3}T12:00:00.000Z`,
    }))
    const { container } = render(
      <ReadingList works={comData} defaultView="calendar" nowIso={NOW} initialFilterQuery="adult=hide" />,
    )
    expect(container.textContent).toContain("2 de 4")
    expect(container.innerHTML).toContain("Obra Leve")
    expect(container.innerHTML).not.toContain("Obra Adulta")
    expect(container.innerHTML).not.toContain("Obra R19")
  })
})

describe("o eco no card", () => {
  it("só aparece com filtro, e só com o que foi filtrado", () => {
    const { unmount } = renderizar()
    expect(screen.queryByText(/Tragédia 2/)).toBeNull()
    unmount()
    renderizar("max_tragedy=3&synopsis_q=%E2%99%A5%E2%99%A5%E2%99%A5%E2%99%A5,none")
    expect(screen.getByText(/Tragédia 2/)).toBeTruthy()
    expect(screen.getByText(/Tragédia 3/)).toBeTruthy()
    expect(screen.getAllByText("♥♥♥♥").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Sem interesse marcado").length).toBeGreaterThan(0)
    expect(screen.queryByText(/Romance 8/)).toBeNull()
  })
})

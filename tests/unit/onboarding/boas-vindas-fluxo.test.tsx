import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"

/**
 * Teste de RENDER das boas-vindas: os defeitos aqui são da TELA, não de regra pura.
 *   - "Pular" na tela de gostos não carregava o deck: a tela ficava em "montando…" para sempre;
 *   - a tela de 18+ tinha "Pular", e pular era mostrar tudo sem a pessoa ter escolhido;
 *   - voltar à tela de notas somava de novo as notas já dadas ali;
 *   - (19/11/2026) a lista vem ANTES do deck, o deck desfaz, a tela de notas trava abaixo de 20%,
 *     e seguir sem nada marcado avisa em vez de levar a uma tela vazia.
 */

const deck = [
  { id: "00000000-0000-4000-8000-000000000001", title: "Obra Um", totalChapters: 80, synopsis: "Sinopse um", coverUrls: [], genres: ["Romance"], platformAvg: 8.5, totalVotes: 51000 },
  { id: "00000000-0000-4000-8000-000000000002", title: "Obra Dois", totalChapters: 247, synopsis: "Sinopse dois", coverUrls: [], genres: ["Fantasy"], platformAvg: null, totalVotes: null },
]
const daLista = { id: "00000000-0000-4000-8000-000000000009", title: "Obra da Lista", totalChapters: 40, synopsis: "", coverUrls: [], genres: [], platformAvg: null, totalVotes: null, status: "Reading" as const, chaptersRead: null }

const acoes = vi.hoisted(() => ({
  getOnboardingDeckAction: vi.fn(),
  getOnboardingProgressAction: vi.fn(async (excluir?: string[]) => (void excluir, { ok: true, ratedCount: 3 })),
  getWelcomeImportStateAction: vi.fn(),
  saveOnboardingTastes: vi.fn(async () => ({ ok: true })),
  deckSwipeAction: vi.fn(async () => ({ ok: true })),
  setOnboardingStatusAction: vi.fn(async () => ({ ok: true, canRate: true })),
  removeOnboardingWorkAction: vi.fn(async () => ({ ok: true })),
  searchOnboardingTagsAction: vi.fn(async (q: string) => ({
    ok: true,
    tags: q.toLowerCase().startsWith("vill") ? [{ id: "00000000-0000-4000-8000-0000000000aa", name: "Villainess", group: "Character Context" }] : [],
  })),
  setHideAdultContent: vi.fn(async () => ({ error: null })),
  setHideAvoidedTags: vi.fn(async () => ({ error: null })),
  saveQuickScore: vi.fn(async () => ({ ok: true })),
  push: vi.fn(),
}))

vi.mock("@/server/actions/onboarding", () => ({
  saveOnboardingTastes: acoes.saveOnboardingTastes,
  getOnboardingDeckAction: acoes.getOnboardingDeckAction,
  deckSwipeAction: acoes.deckSwipeAction,
  getOnboardingProgressAction: acoes.getOnboardingProgressAction,
  getWelcomeImportStateAction: acoes.getWelcomeImportStateAction,
  setOnboardingStatusAction: acoes.setOnboardingStatusAction,
  removeOnboardingWorkAction: acoes.removeOnboardingWorkAction,
  searchOnboardingTagsAction: acoes.searchOnboardingTagsAction,
}))
vi.mock("@/server/actions/settings", () => ({
  setHideAdultContent: acoes.setHideAdultContent,
  setHideAvoidedTags: acoes.setHideAvoidedTags,
}))
vi.mock("@/server/actions/quick-score", () => ({ saveQuickScore: acoes.saveQuickScore }))
vi.mock("@/components/import/external-list-import", () => ({ ExternalListImport: () => <div>importar</div> }))
vi.mock("@/components/ui/cover-image", () => ({ CoverImage: () => null }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: acoes.push }) }))

const { WelcomeFlow } = await import("@/app/welcome/welcome-flow")

const abrir = (props: Partial<React.ComponentProps<typeof WelcomeFlow>> = {}) =>
  render(
    <WelcomeFlow
      displayName="Ana"
      initialLoved={[]}
      initialVetos={[]}
      initialHideAdult={null}
      initialHideAvoided={false}
      startedAt="2026-11-19T12:00:00.000Z"
      {...props}
    />,
  )

const clicar = (nome: string | RegExp) => fireEvent.click(screen.getByRole("button", { name: nome }))
const esperarSwipe = () => new Promise((r) => setTimeout(r, 250))

beforeEach(() => {
  vi.clearAllMocks()
  acoes.getOnboardingDeckAction.mockImplementation(async () => ({ ok: true, works: deck }))
  acoes.getWelcomeImportStateAction.mockImplementation(async () => ({
    ok: true,
    ratedCount: 0,
    importedRatedCount: 0,
    unrated: [],
    sourceLabel: null,
  }))
})

async function irAteGostos() {
  abrir({ initialHideAdult: false })
  clicar(/Começar/)
  clicar(/Continuar/)
  await screen.findByText(/O que você ama/)
}

async function irAteDeck() {
  await irAteGostos()
  clicar("Pular")
  await screen.findByText(/Tem uma lista em outro site/)
  clicar("Não tenho lista")
  await screen.findByText("Obra Um")
}

describe("tela de 18+", () => {
  it("não tem 'Pular', e abre com 'Ocultar' marcado: seguir direto grava ocultar", async () => {
    abrir()
    clicar(/Começar/)
    expect(screen.queryByRole("button", { name: "Pular" })).toBeNull()
    const ocultar = screen.getByRole("button", { name: /Ocultar obras com conteúdo adulto/ })
    expect(ocultar.getAttribute("aria-pressed")).toBe("true")
    clicar(/Continuar/)
    await waitFor(() => expect(acoes.setHideAdultContent).toHaveBeenCalledWith(true))
  })

  it("quem já escolheu mostrar volta com 'Mostrar tudo' marcado", async () => {
    abrir({ initialHideAdult: false })
    clicar(/Começar/)
    expect(screen.getByRole("button", { name: /Mostrar tudo/ }).getAttribute("aria-pressed")).toBe("true")
    clicar(/Continuar/)
    await waitFor(() => expect(acoes.setHideAdultContent).toHaveBeenCalledWith(false))
  })

  it("'Mostrar tudo' pede a idade antes; sem confirmar, nada muda", async () => {
    abrir()
    clicar(/Começar/)
    clicar(/Mostrar tudo/)
    const dialogo = screen.getByRole("dialog", { name: /18 anos ou mais/ })
    fireEvent.click(within(dialogo).getByRole("button", { name: "Voltar" }))
    expect(screen.getByRole("button", { name: /Mostrar tudo/ }).getAttribute("aria-pressed")).toBe("false")
    clicar(/Mostrar tudo/)
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Tenho 18 anos/ }))
    expect(screen.getByRole("button", { name: /Mostrar tudo/ }).getAttribute("aria-pressed")).toBe("true")
  })
})

describe("a lista vem ANTES do deck", () => {
  it("o deck só é montado ao sair da lista — senão ofereceria o que a lista vai trazer", async () => {
    await irAteGostos()
    clicar("Pular")
    await screen.findByText(/Tem uma lista em outro site/)
    expect(acoes.getOnboardingDeckAction).not.toHaveBeenCalled()
    clicar("Não tenho lista")
    expect(await screen.findByText("Obra Um")).toBeTruthy()
    expect(acoes.getWelcomeImportStateAction).toHaveBeenCalledWith("2026-11-19T12:00:00.000Z")
    expect(acoes.saveOnboardingTastes).not.toHaveBeenCalled()
  })

  it("o placar do deck já conta o que a lista trouxe, e diz de onde", async () => {
    acoes.getWelcomeImportStateAction.mockImplementationOnce(async () => ({
      ok: true,
      ratedCount: 9,
      importedRatedCount: 9,
      unrated: [daLista],
      sourceLabel: "AniList",
    }))
    await irAteDeck()
    expect(screen.getByText(/Inclui 10 da sua lista do AniList/)).toBeTruthy()
    expect(screen.getByText("já lidas").parentElement?.textContent).toMatch(/^10 de 20/)
  })

  it("erro ao montar o deck mostra o erro e deixa tentar de novo", async () => {
    acoes.getOnboardingDeckAction.mockImplementationOnce(async () => ({ ok: false, error: "caiu" }))
    const erro = vi.spyOn(console, "error").mockImplementation(() => {})
    await irAteGostos()
    clicar("Pular")
    await screen.findByText(/Tem uma lista/)
    clicar("Não tenho lista")
    await screen.findByText(/Não consegui montar o deck/)
    clicar("Tentar de novo")
    expect(await screen.findByText("Obra Um")).toBeTruthy()
    erro.mockRestore()
  })
})

describe("deck", () => {
  it("'Desfazer última' volta a carta e apaga a marcação no banco", async () => {
    await irAteDeck()
    const desfazer = screen.getByRole("button", { name: /Desfazer última/ })
    expect(desfazer.getAttribute("aria-disabled")).toBe("true")
    clicar(/Já li/)
    await esperarSwipe()
    expect(await screen.findByText("Obra Dois")).toBeTruthy()
    clicar(/Desfazer última/)
    expect(await screen.findByText("Obra Um")).toBeTruthy()
    expect(acoes.removeOnboardingWorkAction).toHaveBeenCalledWith(deck[0].id)
  })

  it("sem nenhuma lida, o rodapé avisa e segue direto para o fim (sem tela de notas vazia)", async () => {
    await irAteDeck()
    expect(screen.getByText(/Sem obras lidas, a Nota Prevista começa desligada/)).toBeTruthy()
    clicar(/Seguir sem marcar nenhuma/)
    expect(await screen.findByText(/acabou de nascer/)).toBeTruthy()
    expect(screen.queryByText(/Quanto você gostou/)).toBeNull()
  })

  it("a sinopse completa abre no próprio cartão e fecha no mesmo canto", async () => {
    await irAteDeck()
    clicar(/Sinopse completa/)
    expect(screen.getByRole("button", { name: /Fechar/ }).getAttribute("aria-expanded")).toBe("true")
    clicar(/Fechar/)
    expect(screen.getByRole("button", { name: /Sinopse completa/ })).toBeTruthy()
  })
})

describe("tela de notas", () => {
  async function irAteNotas() {
    acoes.getWelcomeImportStateAction.mockImplementationOnce(async () => ({
      ok: true,
      ratedCount: 0,
      importedRatedCount: 0,
      unrated: [daLista],
      sourceLabel: "AniList",
    }))
    await irAteDeck()
    clicar(/Já li/)
    await esperarSwipe()
    clicar(/Já li/)
    await esperarSwipe()
    clicar(/Já marquei o bastante/)
    await screen.findByText(/Quanto você gostou/)
  }

  it("as do deck e as que a lista trouxe sem nota, estas com a etiqueta da origem e o status importado", async () => {
    await irAteNotas()
    expect(screen.getAllByRole("group", { name: /Nota para/ }).map((g) => g.getAttribute("aria-label"))).toEqual([
      "Nota para Obra Um",
      "Nota para Obra Dois",
      "Nota para Obra da Lista",
    ])
    expect(screen.getByText("veio do AniList")).toBeTruthy()
    // O "Já li" do deck grava Finished; a obra importada como Reading aparece como Reading.
    expect(screen.getByRole("button", { name: /^Status de leitura de Obra Um: Finished/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Status de leitura de Obra da Lista: Reading/ })).toBeTruthy()
  })

  it("o servidor conta só as notas que a tela NÃO está contando (sem somar duas vezes)", async () => {
    await irAteNotas()
    fireEvent.click(within(screen.getByRole("group", { name: "Nota para Obra Um" })).getByRole("button", { name: "8" }))
    expect(acoes.getOnboardingProgressAction).toHaveBeenLastCalledWith([])
    clicar("Voltar")
    clicar(/Já marquei o bastante|Seguir sem marcar/)
    await screen.findByText(/Quanto você gostou/)
    expect(acoes.getOnboardingProgressAction).toHaveBeenLastCalledWith([deck[0].id])
    // 3 do servidor (sem esta) + 1 da tela = 4, e não 5.
    expect(screen.getAllByText("de 20")[0].previousElementSibling?.textContent).toBe("4")
  })

  /** Radix abre no `pointerdown`, não no `click`. */
  function escolherStatus(titulo: string, status: string) {
    const gatilho = screen.getByRole("button", { name: new RegExp(`^Status de leitura de ${titulo}:`) })
    fireEvent.pointerDown(gatilho, { pointerType: "mouse", button: 0 })
    fireEvent.click(gatilho)
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(status) }))
  }

  it("Reading em branco libera; Started trava abaixo de 20%; o servidor recebe a nota para reaplicar", async () => {
    await irAteNotas()
    const linha = () => screen.getByRole("group", { name: "Nota para Obra Dois" })
    fireEvent.click(within(linha()).getByRole("button", { name: "6" }))
    escolherStatus("Obra Dois", "Reading")
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(deck[1].id, "Reading", null, 6)
    expect(within(linha()).getByRole("button", { name: "6" }).getAttribute("aria-disabled")).toBeNull()
    escolherStatus("Obra Dois", "Started")
    expect(within(linha()).getByRole("button", { name: "6" }).getAttribute("aria-disabled")).toBe("true")
    expect(screen.getByText("Diga em que capítulo parou: a nota vale a partir do cap. 50.")).toBeTruthy()
    const cap = screen.getByRole("spinbutton", { name: /Capítulo em que parou em Obra Dois/ })
    fireEvent.change(cap, { target: { value: "30" } })
    fireEvent.blur(cap)
    expect(screen.getByText("Nota a partir do cap. 50 (20%).")).toBeTruthy()
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(deck[1].id, "Started", 30, 6)
  })

  it("a lixeira na obra do deck desfaz a marcação; na da lista, grava Untracked", async () => {
    await irAteNotas()
    clicar("Tirar Obra Um desta lista")
    expect(screen.queryByRole("group", { name: "Nota para Obra Um" })).toBeNull()
    expect(acoes.removeOnboardingWorkAction).toHaveBeenCalledWith(deck[0].id)
    clicar("Tirar Obra da Lista desta lista")
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(daLista.id, "Untracked", null, null)
    expect(acoes.removeOnboardingWorkAction).toHaveBeenCalledTimes(1)
  })

  it("concluir com menos de 20 notas pergunta antes", async () => {
    await irAteNotas()
    clicar(/Concluir sem notas/)
    const dialogo = screen.getByRole("dialog", { name: /Seguir com 3 de 20 notas/ })
    fireEvent.click(within(dialogo).getByRole("button", { name: "Voltar e dar mais notas" }))
    expect(screen.getByText(/Quanto você gostou/)).toBeTruthy()
    clicar(/Concluir sem notas/)
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Concluir assim" }))
    expect(await screen.findByText(/acabou de nascer/)).toBeTruthy()
    // Com menos de 20, o fim oferece a página "Dar notas".
    clicar("Dar mais notas")
    expect(acoes.push).toHaveBeenCalledWith("/rate")
  })
})

describe("esconder as obras com tags evitadas é ESCOLHA da pessoa", () => {
  async function marcarGostos() {
    await irAteGostos()
    for (const g of ["Romance", "Drama", "Comédia"]) clicar(g)
  }

  it("sem veto marcado, a escolha não aparece", async () => {
    await marcarGostos()
    expect(screen.queryByRole("button", { name: /ficam escondidas/ })).toBeNull()
  })

  it("vetar sozinho não liga nada: o padrão é aparecer", async () => {
    await marcarGostos()
    clicar("Isekai")
    expect(screen.getByRole("button", { name: /aparecem, mais abaixo/ }).getAttribute("aria-pressed")).toBe("true")
    clicar(/Continuar com/)
    await screen.findByText(/Tem uma lista em outro site/)
    expect(acoes.setHideAvoidedTags).not.toHaveBeenCalled()
  })

  it("escolher 'ficam escondidas' grava a preferência ao seguir", async () => {
    await marcarGostos()
    clicar("Isekai")
    clicar(/ficam escondidas/)
    clicar(/Continuar com/)
    await screen.findByText(/Tem uma lista em outro site/)
    expect(acoes.setHideAvoidedTags).toHaveBeenCalledWith(true)
  })
})

describe("procurar outras tags", () => {
  it("a tag achada vira chip no painel e é gravada com a stance ao seguir", async () => {
    await irAteGostos()
    for (const g of ["Romance", "Drama", "Comédia"]) clicar(g)
    fireEvent.change(screen.getByRole("textbox", { name: "Procurar outras tags" }), { target: { value: "villain" } })
    fireEvent.click(await screen.findByRole("button", { name: "Amo Villainess" }))
    expect(screen.getByRole("button", { name: "Tirar Villainess" }).textContent).toMatch(/♥ Villainess/)
    clicar(/Continuar com 4 escolhas/)
    await screen.findByText(/Tem uma lista em outro site/)
    expect(acoes.saveOnboardingTastes).toHaveBeenCalledWith(
      expect.arrayContaining(["Romance", "Drama", "Comédia"]),
      [],
      [{ tagId: "00000000-0000-4000-8000-0000000000aa", stance: "love" }],
    )
  })

  it("sem resultado, diz que não achou", async () => {
    await irAteGostos()
    fireEvent.change(screen.getByRole("textbox", { name: "Procurar outras tags" }), { target: { value: "zzz" } })
    expect(await screen.findByText("Nenhuma tag com esse nome.")).toBeTruthy()
  })
})

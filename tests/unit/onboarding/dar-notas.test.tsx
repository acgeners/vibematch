import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"

const deck = [
  { id: "00000000-0000-4000-8000-000000000001", title: "Obra Um", totalChapters: 80, synopsis: "Sinopse", coverUrls: [], genres: [], platformAvg: null, totalVotes: null },
  { id: "00000000-0000-4000-8000-000000000002", title: "Obra Dois", totalChapters: 80, synopsis: "Sinopse", coverUrls: [], genres: [], platformAvg: null, totalVotes: null },
]
const base = { synopsis: "", coverUrls: [], genres: [], platformAvg: null, totalVotes: null }
const jaLida = { ...base, id: "00000000-0000-4000-8000-000000000009", title: "Lida Antes", totalChapters: 40, status: "Finished" as const, chaptersRead: 40 }
/** Started no cap. 5 de 72: abaixo de 20%, então a nota não vale — vai para o grupo fechado. */
const comecada = { ...base, id: "00000000-0000-4000-8000-000000000008", title: "Começada", totalChapters: 72, status: "Started" as const, chaptersRead: 5 }

const acoes = vi.hoisted(() => ({
  getOnboardingDeckAction: vi.fn(),
  deckSwipeAction: vi.fn(async () => ({ ok: true })),
  removeOnboardingWorkAction: vi.fn(async () => ({ ok: true })),
  setOnboardingStatusAction: vi.fn(async () => ({ ok: true, canRate: true })),
  saveQuickScore: vi.fn(async () => ({ ok: true })),
}))
vi.mock("@/server/actions/onboarding", () => ({
  getOnboardingDeckAction: acoes.getOnboardingDeckAction,
  deckSwipeAction: acoes.deckSwipeAction,
  removeOnboardingWorkAction: acoes.removeOnboardingWorkAction,
  setOnboardingStatusAction: acoes.setOnboardingStatusAction,
}))
vi.mock("@/server/actions/quick-score", () => ({ saveQuickScore: acoes.saveQuickScore }))
vi.mock("@/components/ui/cover-image", () => ({ CoverImage: () => null }))
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

const { RatePage } = await import("@/components/onboarding/rate-page")

beforeEach(() => {
  vi.clearAllMocks()
  acoes.getOnboardingDeckAction.mockImplementation(async () => ({ ok: true, works: deck }))
})

const linha = (titulo: string) => screen.getByRole("group", { name: `Nota para ${titulo}` })
/** Radix abre no `pointerdown`, não no `click`. */
function escolherStatus(titulo: string, status: string) {
  const gatilho = screen.getByRole("button", { name: new RegExp(`^Status de leitura de ${titulo}:`) })
  fireEvent.pointerDown(gatilho, { pointerType: "mouse", button: 0 })
  fireEvent.click(gatilho)
  fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(status) }))
}
const abrirGrupo = () => fireEvent.click(screen.getByRole("button", { name: /Em andamento/ }))
const ensoTexto = () => screen.getByLabelText("Progresso da Nota Prevista").textContent

/** A página "Dar notas": o mesmo deck e a mesma lista de notas das boas-vindas. */
describe("Dar notas", () => {
  it("'Já li' no deck põe a obra no TOPO da lista, marcada como do deck e como Finished", async () => {
    render(<RatePage lovedLabels={["Romance"]} initialUnrated={[jaLida]} ratedCount={4} />)
    expect(await screen.findByText("Obra Um")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Já li/ }))
    await new Promise((r) => setTimeout(r, 250))
    const linhas = screen.getAllByRole("group", { name: /Nota para/ }).map((g) => g.getAttribute("aria-label"))
    expect(linhas).toEqual(["Nota para Obra Um", "Nota para Lida Antes"])
    expect(screen.getByText("DO DECK, AGORA")).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Status de leitura de Obra Um: Finished/ })).toBeTruthy()
  })

  it("a nota dada aqui soma no ensō; 'Desfazer última' tira a obra da lista", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} />)
    await screen.findByText("Obra Um")
    fireEvent.click(within(linha("Lida Antes")).getByRole("button", { name: "8" }))
    expect(ensoTexto()).toMatch(/^5de 20/)
    fireEvent.click(screen.getByRole("button", { name: /Já li/ }))
    await new Promise((r) => setTimeout(r, 250))
    fireEvent.click(screen.getByRole("button", { name: /Desfazer última/ }))
    expect(screen.queryByRole("group", { name: "Nota para Obra Um" })).toBeNull()
    expect(acoes.removeOnboardingWorkAction).toHaveBeenCalledWith(deck[0].id)
  })
})

describe("a linha começa no status GRAVADO", () => {
  it("a travada vai para o grupo FECHADO no fim, com o seu status e o motivo", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[comecada, jaLida]} ratedCount={4} />)
    await screen.findByText("Obra Um")
    // A ordem do servidor põe a Começada primeiro; travada, ela vai para o fim, fechada.
    expect(screen.getAllByRole("group", { name: /Nota para/ }).map((g) => g.getAttribute("aria-label"))).toEqual([
      "Nota para Lida Antes",
    ])
    const grupo = screen.getByRole("button", { name: /Em andamento · 1/ })
    expect(grupo.getAttribute("aria-expanded")).toBe("false")
    abrirGrupo()
    expect(screen.getByRole("button", { name: /^Status de leitura de Começada: Started/ })).toBeTruthy()
    expect(within(linha("Começada")).getByRole("button", { name: "8" }).getAttribute("aria-disabled")).toBe("true")
    expect(screen.getByText("Nota a partir do cap. 15 (20%).")).toBeTruthy()
  })

  it("trocar o status grava pela ação, destrava a escala e a linha NÃO pula de lugar", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[comecada, jaLida]} ratedCount={4} />)
    await screen.findByText("Obra Um")
    abrirGrupo()
    escolherStatus("Começada", "Finished")
    // Finished = a obra inteira: o capítulo vira o total.
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(comecada.id, "Finished", 72, null)
    expect(within(linha("Começada")).getByRole("button", { name: "8" }).getAttribute("aria-disabled")).toBeNull()
    expect(screen.getByRole("button", { name: /Em andamento · 1/ })).toBeTruthy()
  })

  it("só conta no ensō a nota com a escala liberada; o capítulo abaixo de 20% a tira", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[comecada]} ratedCount={4} />)
    await screen.findByText("Obra Um")
    abrirGrupo()
    escolherStatus("Começada", "Finished")
    fireEvent.click(within(linha("Começada")).getByRole("button", { name: "8" }))
    expect(ensoTexto()).toMatch(/^5de 20/)
    escolherStatus("Começada", "Started")
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(comecada.id, "Started", 72, 8)
    const cap = screen.getByRole("spinbutton", { name: /Capítulo em que parou em Começada/ })
    fireEvent.change(cap, { target: { value: "5" } })
    fireEvent.blur(cap)
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(comecada.id, "Started", 5, 8)
    expect(ensoTexto()).toMatch(/^4de 20/)
  })

  it("Want to Read tira a obra da lista, com 'Desfazer'", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} />)
    await screen.findByText("Obra Um")
    escolherStatus("Lida Antes", "Want to Read")
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(jaLida.id, "Want to Read", 40, null)
    expect(screen.queryByRole("group", { name: "Nota para Lida Antes" })).toBeNull()
    expect(screen.getByText(/agora é Want to Read e saiu desta lista/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }))
    expect(linha("Lida Antes")).toBeTruthy()
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(jaLida.id, "Finished", 40, null)
  })

  it("o menu não oferece Not Now, Untracked nem Not Interested", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} />)
    await screen.findByText("Obra Um")
    const gatilho = screen.getByRole("button", { name: /^Status de leitura de Lida Antes:/ })
    fireEvent.pointerDown(gatilho, { pointerType: "mouse", button: 0 })
    fireEvent.click(gatilho)
    const opcoes = screen.getAllByRole("menuitem").map((i) => i.textContent)
    expect(opcoes.some((t) => /Not Now|Untracked|Not Interested/.test(t ?? ""))).toBe(false)
    expect(opcoes.some((t) => /Want to Read/.test(t ?? ""))).toBe(true)
  })
})

/**
 * Toda ação da página chama `revalidatePath`, e o Next reenvia as props do servidor NA HORA: o
 * `rerender` com props novas é esse reenvio. Antes, ele apagava o "Desfazer" (a obra apagada já
 * não vem do servidor), punha a obra mexida no topo (a lista vem por `updated_at`), tirava da lista
 * a obra que ganhou nota e recarregava o deck (`lovedLabels` chega como array novo).
 */
describe("a página trabalha sobre o que ABRIU, não sobre o reenvio do servidor", () => {
  const outra = { ...base, id: "00000000-0000-4000-8000-000000000007", title: "Outra Lida", totalChapters: 30, status: "Dropped" as const, chaptersRead: 12 }
  const ordem = () => screen.getAllByRole("group", { name: /Nota para/ }).map((g) => g.getAttribute("aria-label"))

  it("o 'Desfazer' da lixeira continua depois do reenvio", async () => {
    const { rerender } = render(<RatePage lovedLabels={[]} initialUnrated={[jaLida, outra]} ratedCount={4} />)
    await screen.findByText("Obra Um")
    fireEvent.click(screen.getByRole("button", { name: "Tirar Lida Antes desta lista" }))
    // O servidor já não manda a obra apagada (virou Untracked).
    rerender(<RatePage lovedLabels={[]} initialUnrated={[outra]} ratedCount={4} />)
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeTruthy()
  })

  it("a obra mexida não pula para o topo, e a que ganhou nota fica na lista contando uma vez", async () => {
    const { rerender } = render(<RatePage lovedLabels={[]} initialUnrated={[jaLida, outra]} ratedCount={4} />)
    await screen.findByText("Obra Um")
    fireEvent.click(within(linha("Lida Antes")).getByRole("button", { name: "8" }))
    escolherStatus("Outra Lida", "Finished")
    // Reenvio: a com nota sai (a lista é "sem nota"), a mexida vem primeiro e o servidor já conta a nota.
    rerender(<RatePage lovedLabels={[]} initialUnrated={[{ ...outra, status: "Finished" as const, chaptersRead: 30 }]} ratedCount={5} />)
    expect(ordem()).toEqual(["Nota para Lida Antes", "Nota para Outra Lida"])
    expect(ensoTexto()).toMatch(/^5de 20/)
  })

  it("o deck não recarrega quando os gostos chegam como array novo", async () => {
    const { rerender } = render(<RatePage lovedLabels={["Romance"]} initialUnrated={[jaLida]} ratedCount={4} />)
    await screen.findByText("Obra Um")
    rerender(<RatePage lovedLabels={["Romance"]} initialUnrated={[jaLida]} ratedCount={4} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(acoes.getOnboardingDeckAction).toHaveBeenCalledTimes(1)
  })
})

describe("a lixeira, em toda obra", () => {
  it("na obra que já estava na lista grava Untracked (guarda ♥ e histórico) e o 'Desfazer' devolve o status", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} />)
    await screen.findByText("Obra Um")
    fireEvent.click(screen.getByRole("button", { name: "Tirar Lida Antes desta lista" }))
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(jaLida.id, "Untracked", 40, null)
    expect(acoes.removeOnboardingWorkAction).not.toHaveBeenCalled()
    expect(screen.getByText(/O ♥ de interesse e o histórico continuam guardados/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }))
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(jaLida.id, "Finished", 40, null)
  })

  it("na obra marcada no deck agora desfaz a marcação (a obra volta ao deck)", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[]} ratedCount={4} />)
    await screen.findByText("Obra Um")
    fireEvent.click(screen.getByRole("button", { name: /Já li/ }))
    await new Promise((r) => setTimeout(r, 250))
    fireEvent.click(screen.getByRole("button", { name: "Tirar Obra Um desta lista" }))
    expect(acoes.removeOnboardingWorkAction).toHaveBeenCalledWith(deck[0].id)
    expect(screen.getByText(/volta a aparecer no deck/)).toBeTruthy()
  })
})

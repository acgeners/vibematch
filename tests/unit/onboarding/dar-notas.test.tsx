import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, within } from "@testing-library/react"

const deck = [
  { id: "00000000-0000-4000-8000-000000000001", title: "Obra Um", totalChapters: 80, synopsis: "Sinopse", coverUrls: [], genres: [], platformAvg: null, totalVotes: null, publicationStatusId: null },
  { id: "00000000-0000-4000-8000-000000000002", title: "Obra Dois", totalChapters: 80, synopsis: "Sinopse", coverUrls: [], genres: [], platformAvg: null, totalVotes: null, publicationStatusId: null },
]
const base = { synopsis: "", coverUrls: [], genres: [], platformAvg: null, totalVotes: null, publicationStatusId: null }
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
    render(<RatePage lovedLabels={["Romance"]} initialUnrated={[jaLida]} ratedCount={4} unratedTotal={0} />)
    expect(await screen.findByText("Obra Um")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /Já li/ }))
    await new Promise((r) => setTimeout(r, 250))
    const linhas = screen.getAllByRole("group", { name: /Nota para/ }).map((g) => g.getAttribute("aria-label"))
    expect(linhas).toEqual(["Nota para Obra Um", "Nota para Lida Antes"])
    expect(screen.getByText("DO DECK, AGORA")).toBeTruthy()
    expect(screen.getByRole("button", { name: /^Status de leitura de Obra Um: Finished/ })).toBeTruthy()
  })

  it("a nota dada aqui soma no ensō; 'Desfazer última' tira a obra da lista", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} unratedTotal={0} />)
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
    render(<RatePage lovedLabels={[]} initialUnrated={[comecada, jaLida]} ratedCount={4} unratedTotal={0} />)
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
    render(<RatePage lovedLabels={[]} initialUnrated={[comecada, jaLida]} ratedCount={4} unratedTotal={0} />)
    await screen.findByText("Obra Um")
    abrirGrupo()
    escolherStatus("Começada", "Finished")
    // Finished = a obra inteira: o capítulo vira o total.
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(comecada.id, "Finished", 72, null)
    expect(within(linha("Começada")).getByRole("button", { name: "8" }).getAttribute("aria-disabled")).toBeNull()
    expect(screen.getByRole("button", { name: /Em andamento · 1/ })).toBeTruthy()
  })

  it("só conta no ensō a nota com a escala liberada; o capítulo abaixo de 20% a tira", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[comecada]} ratedCount={4} unratedTotal={0} />)
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
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} unratedTotal={0} />)
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
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} unratedTotal={0} />)
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
    const { rerender } = render(<RatePage lovedLabels={[]} initialUnrated={[jaLida, outra]} ratedCount={4} unratedTotal={0} />)
    await screen.findByText("Obra Um")
    fireEvent.click(screen.getByRole("button", { name: "Tirar Lida Antes desta lista" }))
    // O servidor já não manda a obra apagada (virou Untracked).
    rerender(<RatePage lovedLabels={[]} initialUnrated={[outra]} ratedCount={4} unratedTotal={0} />)
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeTruthy()
  })

  it("a obra mexida não pula para o topo, e a que ganhou nota fica na lista contando uma vez", async () => {
    const { rerender } = render(<RatePage lovedLabels={[]} initialUnrated={[jaLida, outra]} ratedCount={4} unratedTotal={0} />)
    await screen.findByText("Obra Um")
    fireEvent.click(within(linha("Lida Antes")).getByRole("button", { name: "8" }))
    escolherStatus("Outra Lida", "Finished")
    // Reenvio: a com nota sai (a lista é "sem nota"), a mexida vem primeiro e o servidor já conta a nota.
    rerender(<RatePage lovedLabels={[]} initialUnrated={[{ ...outra, status: "Finished" as const, chaptersRead: 30 }]} ratedCount={5} unratedTotal={0} />)
    expect(ordem()).toEqual(["Nota para Lida Antes", "Nota para Outra Lida"])
    expect(ensoTexto()).toMatch(/^5de 20/)
  })

  it("o deck não recarrega quando os gostos chegam como array novo", async () => {
    const { rerender } = render(<RatePage lovedLabels={["Romance"]} initialUnrated={[jaLida]} ratedCount={4} unratedTotal={0} />)
    await screen.findByText("Obra Um")
    rerender(<RatePage lovedLabels={["Romance"]} initialUnrated={[jaLida]} ratedCount={4} unratedTotal={0} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(acoes.getOnboardingDeckAction).toHaveBeenCalledTimes(1)
  })
})

describe("a lixeira, em toda obra", () => {
  it("na obra que já estava na lista grava Untracked (guarda ♥ e histórico) e o 'Desfazer' devolve o status", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} unratedTotal={0} />)
    await screen.findByText("Obra Um")
    fireEvent.click(screen.getByRole("button", { name: "Tirar Lida Antes desta lista" }))
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(jaLida.id, "Untracked", 40, null)
    expect(acoes.removeOnboardingWorkAction).not.toHaveBeenCalled()
    expect(screen.getByText(/O ♥ de interesse e o histórico continuam guardados/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }))
    expect(acoes.setOnboardingStatusAction).toHaveBeenLastCalledWith(jaLida.id, "Finished", 40, null)
  })

  it("na obra marcada no deck agora desfaz a marcação (a obra volta ao deck)", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[]} ratedCount={4} unratedTotal={0} />)
    await screen.findByText("Obra Um")
    fireEvent.click(screen.getByRole("button", { name: /Já li/ }))
    await new Promise((r) => setTimeout(r, 250))
    fireEvent.click(screen.getByRole("button", { name: "Tirar Obra Um desta lista" }))
    expect(acoes.removeOnboardingWorkAction).toHaveBeenCalledWith(deck[0].id)
    expect(screen.getByText(/volta a aparecer no deck/)).toBeTruthy()
  })
})

/** O redesenho de 22/11/2026 (mockup v2): ensō com a conta das obras, escala 1–10, publicação, agrupar, deck vazio. */
describe("Dar notas v2", () => {
  const lida = (n: number, status: "Finished" | "Started" | "Reading", chaptersRead: number | null, pub: number | null = null) => ({
    ...base,
    id: `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`,
    title: `Lida ${n}`,
    totalChapters: 100,
    status,
    chaptersRead,
    publicationStatusId: pub,
  })

  it("depois das 20 o ensō diz 'de N obras' com o mesmo conjunto em cima e embaixo", async () => {
    // 252 com nota, 2 na lista sem nota (1 liberada, 1 travada) e 3 sem nota fora da lista.
    const itens = [lida(1, "Finished", 100), lida(2, "Started", 5)]
    render(<RatePage lovedLabels={[]} initialUnrated={itens} ratedCount={252} unratedTotal={5} />)
    await screen.findByText("Obra Um")
    const enso = screen.getByLabelText("Progresso da Nota Prevista")
    expect(enso.textContent).toMatch(/^252de 257 obras/)
    expect(enso.textContent).toContain("98% das obras que você leu, começou ou avaliou já têm nota.")
    expect(enso.textContent).toContain("1 esperando nota, na lista abaixo")
    expect(enso.textContent).toContain("1 no começo (menos de 20% lido)")
    expect(enso.textContent).toContain("3 fora da lista")
    // Dar nota move a obra de "esperando" para "com nota" sem mudar o total.
    fireEvent.click(within(linha("Lida 1")).getByRole("button", { name: "7" }))
    expect(enso.textContent).toMatch(/^253de 257 obras/)
  })

  it("antes das 20 o ensō segue contando até a meta", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} unratedTotal={1} />)
    await screen.findByText("Obra Um")
    expect(ensoTexto()).toMatch(/^4de 20/)
    expect(ensoTexto()).toContain("Faltam 16.")
  })

  it("o aviso 'A Nota Prevista ligou' só aparece na visita em que a pessoa passa de 20", async () => {
    const { unmount } = render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={252} unratedTotal={1} />)
    await screen.findByText("Obra Um")
    expect(screen.queryByText("A Nota Prevista ligou.")).toBeNull()
    unmount()
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={19} unratedTotal={1} />)
    await screen.findByText("Obra Um")
    expect(screen.queryByText("A Nota Prevista ligou.")).toBeNull()
    fireEvent.click(within(linha("Lida Antes")).getByRole("button", { name: "8" }))
    expect(screen.getByText("A Nota Prevista ligou.")).toBeTruthy()
  })

  it("a escala vai de 1 a 10", async () => {
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} unratedTotal={1} />)
    await screen.findByText("Obra Um")
    const notas = within(linha("Lida Antes")).getAllByRole("button").map((b) => b.textContent)
    expect(notas).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"])
  })

  it("o status de publicação aparece na linha dos gêneros; Unknown fica de fora", async () => {
    const itens = [lida(1, "Finished", 100, 2), lida(2, "Finished", 100, 5)]
    render(<RatePage lovedLabels={[]} initialUnrated={itens} ratedCount={4} unratedTotal={2} />)
    await screen.findByText("Obra Um")
    expect(screen.getByText("Ongoing")).toBeTruthy()
    expect(screen.queryByText("Unknown")).toBeNull()
  })

  it("'Agrupar por status' separa pelo status GRAVADO: trocar o status não muda a obra de grupo", async () => {
    const itens = [lida(1, "Reading", null), lida(2, "Finished", 100), lida(3, "Reading", 50)]
    render(<RatePage lovedLabels={[]} initialUnrated={itens} ratedCount={4} unratedTotal={3} />)
    await screen.findByText("Obra Um")
    expect(screen.queryByRole("region", { name: "Reading" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Agrupar por status/ }))
    const reading = screen.getByRole("region", { name: "Reading" })
    expect(within(reading).getAllByRole("group", { name: /Nota para/ }).map((g) => g.getAttribute("aria-label"))).toEqual([
      "Nota para Lida 1",
      "Nota para Lida 3",
    ])
    escolherStatus("Lida 1", "Finished")
    expect(within(screen.getByRole("region", { name: "Reading" })).getByRole("group", { name: "Nota para Lida 1" })).toBeTruthy()
  })

  it("deck vazio: a coluna sai e uma linha explica; deck com obras mantém a coluna", async () => {
    acoes.getOnboardingDeckAction.mockImplementationOnce(async () => ({ ok: true, works: [] }))
    const { unmount } = render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} unratedTotal={1} />)
    expect(await screen.findByText(/O deck não tem sugestões novas/)).toBeTruthy()
    expect(screen.queryByRole("heading", { name: "Você leu alguma destas?" })).toBeNull()
    unmount()
    render(<RatePage lovedLabels={[]} initialUnrated={[jaLida]} ratedCount={4} unratedTotal={1} />)
    await screen.findByText("Obra Um")
    expect(screen.getByRole("heading", { name: "Você leu alguma destas?" })).toBeTruthy()
    expect(screen.queryByText(/O deck não tem sugestões novas/)).toBeNull()
  })
})

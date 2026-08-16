import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import { act, render, cleanup, within } from "@testing-library/react"

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

// `publicationStatusId: 1` = Ongoing no catálogo gerado — põe as duas obras na seção
// "Em andamento", que é onde a faixa de novidades e as bandas de ritmo aparecem.
const base = {
  publicationStatusId: 1,
  coverUrl: "https://example.test/capa.jpg",
  lastReadAt: "2026-08-05T12:00:00.000Z",
  lastChapterReleasedAt: "2026-08-07T12:00:00.000Z",
  nextChapterPredictedAt: null,
  chaptersCheckedAt: null,
  comixHid: null,
  isAdult: false,
} as unknown as ReadingWork

const WORKS: ReadingWork[] = [
  {
    ...base,
    id: "w1",
    title: "What Was Meant to Be a Contract Marriage Turned Into the Duke's Obsession",
    chaptersRead: 16,
    totalChapters: 17,
  },
  { ...base, id: "w2", title: "As the Heart Leads", chaptersRead: 59, totalChapters: 62 },
]

async function renderWithNewChapter() {
  checkReadingUpdates.mockResolvedValue([
    { workId: "w1", hasNew: true, delta: 1, latestExternal: 18, unreadCount: 2 },
    { workId: "w2", hasNew: false, latestExternal: 62 },
  ])
  const utils = render(
    <ReadingList works={WORKS} defaultView="list" nowIso="2026-08-08T12:00:00.000Z" />,
  )
  await act(async () => {
    utils.getByText("Verificar atualizações").click()
    await Promise.resolve()
  })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  return utils
}

/**
 * O que regride aqui não é regra de negócio — é ESCOPO visual, e escopo só aparece na
 * árvore desenhada. Daí ser teste de render: a faixa e o card já disseram "capítulo novo"
 * com um anel de 1px que ninguém enxergava, e com uma capa de 18px que não identificava
 * obra nenhuma. Nada disso quebra build nem runtime.
 */
describe("/reading: obra com capítulo novo se identifica na faixa e no card", () => {
  beforeEach(() => checkReadingUpdates.mockReset())
  afterEach(cleanup)

  it("a faixa do topo traz o título INTEIRO da obra, não um trecho truncado", async () => {
    const { getByRole } = await renderWithNewChapter()
    const chip = getByRole("button", { name: /Contract Marriage/ })
    expect(chip.textContent).toContain(
      "What Was Meant to Be a Contract Marriage Turned Into the Duke's Obsession",
    )
    // e a capa da faixa tem que ser visível: 18×24px era o tamanho que não mostrava nada
    const img = chip.querySelector("img")
    expect(img?.className).toContain("h-16")
    expect(img?.className).toContain("w-11")
  })

  it("o card ganha o selo sobre a capa — e NÃO repete o mesmo aviso três vezes", async () => {
    const { container } = await renderWithNewChapter()
    const card = container.querySelector("#work-w1")!
    expect(within(card as HTMLElement).getByText(/\+1 NOVO/)).toBeTruthy()
    // o badge "+1 novo" ao lado do "Último lançado" saiu: com o selo e o número em verde,
    // eram três vezes a mesma informação no mesmo card.
    expect(within(card as HTMLElement).queryByText(/^\+1 novos?$/)).toBeNull()
    // o anel some junto com o hasNew — quem não tem capítulo novo não pode ganhá-lo
    const outro = container.querySelector("#work-w2")!
    expect(outro.className).not.toContain("ring-2")
    expect(card.className).toContain("ring-2")
  })

  it("a grade iguala a altura dos cards: `auto-rows-fr` e nenhum `items-start`", async () => {
    const { container } = await renderWithNewChapter()
    const grid = container.querySelector("#work-w1")!.parentElement!
    expect(grid.className).toContain("auto-rows-fr")
    expect(grid.className).not.toContain("items-start")
    // e cada card estica até a linha (h-full) com um piso comum entre bandas (min-h)
    const card = container.querySelector("#work-w1")!
    expect(card.className).toContain("h-full")
    expect(card.className).toMatch(/min-h-\d/)
  })
})

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
  setChaptersRead: vi.fn(async () => ({ ok: true })),
  setReadingStatusForWorks: vi.fn(),
  archiveWork: vi.fn(),
}))

import { ReadingList } from "@/components/reading/reading-list"
import type { ReadingWork } from "@/server/queries/reading"
import { PUBLICATION_STATUSES_BY_ID } from "@/lib/constants/criteria"

/**
 * Marcar a obra como lida até o último capítulo tem de tirá-la de "Acompanhando".
 *
 * 🔴 O defeito (16/11/2026): a checagem de capítulos devolve uma contagem EXATA de não lidos,
 * contada com o lido daquele momento (13 → "1 pra ler"). Marcar 14 salva, a página recarrega
 * com 14, e a tela reaproveitava a contagem velha porque comparava com o lido SALVO — que agora
 * também era 14. A obra lida até o fim seguia com "1 pra ler", em "Acompanhando" (que é decidido
 * pelo mesmo número), e só subia para o topo da fila, porque a ordem é pela última leitura.
 */

// Pelo NOME, não pelo número: o id é gerado do banco (hoje 1 = Completed, 2 = Ongoing).
const ONGOING_ID = Object.values(PUBLICATION_STATUSES_BY_ID).find((s) => s.status === "Ongoing")!.id

const base = {
  publicationStatusId: ONGOING_ID, // seção "Em andamento", onde moram Acompanhando e Em dia
  coverUrls: [],
  lastReadAt: "2026-11-15T12:00:00.000Z",
  lastChapterReleasedAt: "2026-11-05T12:00:00.000Z",
  nextChapterPredictedAt: null,
  chaptersCheckedAt: null,
  comixHid: null,
  latestChapterUrl: null,
  isAdult: false,
} as unknown as ReadingWork

const work = (chaptersRead: number): ReadingWork[] => [
  { ...base, id: "w1", title: "Lady Jane's Toy Drawer", chaptersRead, totalChapters: 14 },
  { ...base, id: "w2", title: "Outra em dia", chaptersRead: 30, totalChapters: 30 },
]

const NOW = "2026-11-16T12:00:00.000Z"

async function renderChecked() {
  checkReadingUpdates.mockResolvedValue([
    { workId: "w1", hasNew: false, delta: 0, latestExternal: 14, unreadCount: 1, unreadCountReadBase: 13 },
    { workId: "w2", hasNew: false, delta: 0, latestExternal: 30, unreadCount: 0, unreadCountReadBase: 30 },
  ])
  const utils = render(<ReadingList chapterCheckAvailable works={work(13)} defaultView="list" nowIso={NOW} />)
  await act(async () => {
    utils.getByText("Verificar atualizações").click()
    await Promise.resolve()
  })
  await act(async () => { await Promise.resolve() })
  await act(async () => { await Promise.resolve() })
  return utils
}

const bandOfCard = (container: HTMLElement, id: string) =>
  container.querySelector(`#work-${id}`)?.closest("[id^='band-']")?.id

describe("/reading: marcar lido até o último capítulo muda a obra de grupo", () => {
  beforeEach(() => checkReadingUpdates.mockReset())
  afterEach(cleanup)

  it("antes de marcar, a contagem exata da checagem vale: 1 pra ler, em Acompanhando", async () => {
    const { container } = await renderChecked()
    expect(bandOfCard(container, "w1")).toBe("band-ongoing-onpace")
    expect(within(container.querySelector("#work-w1") as HTMLElement).getByText(/1 pra ler/)).toBeTruthy()
  })

  it("🔴 depois de salvar 14 e a página recarregar, a obra está Em dia — a contagem velha não volta", async () => {
    const utils = await renderChecked()
    // o que o servidor devolve depois de salvar: o lido novo nas props, a checagem (estado da
    // tela) intacta
    utils.rerender(<ReadingList chapterCheckAvailable works={work(14)} defaultView="list" nowIso={NOW} />)
    const card = utils.container.querySelector("#work-w1") as HTMLElement
    expect(bandOfCard(utils.container, "w1")).toBe("band-ongoing-uptodate")
    expect(within(card).queryByText(/pra ler/)).toBeNull()
    expect(within(card).getByText(/Em dia/)).toBeTruthy()
  })

  it("a contagem exata segue valendo para quem não mexeu no lido", async () => {
    const utils = await renderChecked()
    utils.rerender(<ReadingList chapterCheckAvailable works={work(14)} defaultView="list" nowIso={NOW} />)
    expect(bandOfCard(utils.container, "w2")).toBe("band-ongoing-uptodate")
  })
})

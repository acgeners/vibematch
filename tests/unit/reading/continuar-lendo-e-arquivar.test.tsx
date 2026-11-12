import { vi, describe, it, expect, afterEach } from "vitest"
import { cleanup, render, within } from "@testing-library/react"

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
import { continueReadingUrl, pickReadUrl } from "@/lib/reading/read-url"
import type { ReadingWork } from "@/server/queries/reading"

// Dois defeitos da /reading, achados em 2026-11-11 depois do lote de capítulos:
//   · o "Continuar lendo" ia SEMPRE para a Comix quando a obra tinha hid — e 12 hids devolviam
//     404, 9 deles com o capítulo vindo do Mangago;
//   · o "Arquivar" aparecia para qualquer leitor, mas arquiva a obra no catálogo de TODOS e o
//     servidor recusa quem não é curador — botão oferecido que só devolvia erro.

const comixUrl = (hid: string) => `https://comix.to/title/${hid}`
const MANGAGO = "https://www.mangago.me/read-manga/obra/"

describe("pickReadUrl — o link que a checagem grava", () => {
  it("a Comix, quando ela respondeu nesta checagem (a leitura preferida)", () => {
    expect(pickReadUrl({ comixAnsweredUrl: comixUrl("abc"), winnerUrl: MANGAGO })).toBe(comixUrl("abc"))
  })

  it("🔴 Comix que NÃO respondeu (código com 404) leva para a fonte que achou o capítulo", () => {
    expect(pickReadUrl({ comixAnsweredUrl: null, winnerUrl: MANGAGO })).toBe(MANGAGO)
  })

  it("sem nenhuma fonte, nada", () => {
    expect(pickReadUrl({ comixAnsweredUrl: undefined, winnerUrl: null })).toBeNull()
  })
})

describe("continueReadingUrl — o link do card", () => {
  it("desta checagem → o gravado pela última → a Comix pelo hid", () => {
    expect(continueReadingUrl({ checkedUrl: "a", savedUrl: "b", comixHid: "c", comixUrl })).toBe("a")
    expect(continueReadingUrl({ checkedUrl: null, savedUrl: "b", comixHid: "c", comixUrl })).toBe("b")
    expect(continueReadingUrl({ checkedUrl: undefined, savedUrl: null, comixHid: "c", comixUrl })).toBe(comixUrl("c"))
    expect(continueReadingUrl({ checkedUrl: undefined, savedUrl: null, comixHid: null, comixUrl })).toBeNull()
  })
})

// ── Render: o que a pessoa vê no card ────────────────────────────────────────────────────

const hoje = new Date()
const diasAtras = (n: number) => new Date(hoje.getTime() - n * 864e5).toISOString()

const obra = (over: Partial<ReadingWork>): ReadingWork =>
  ({
    id: "w1",
    title: "Obra de Teste",
    publicationStatusId: 2,
    personalStatusId: 2,
    coverUrls: [],
    lastReadAt: diasAtras(60), // parada há 60 dias ⇒ o card ganha as ações On-hold/Arquivar
    lastTouchedAt: null,
    lastChapterReleasedAt: diasAtras(3),
    nextChapterPredictedAt: null,
    chaptersCheckedAt: diasAtras(1),
    comixHid: "morto",
    latestChapterUrl: MANGAGO,
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
    totalChapters: 30,
    ...over,
  }) as ReadingWork

const card = () => within(document.getElementById("work-w1") as HTMLElement)

afterEach(cleanup)

describe("o card da /reading", () => {
  it("🔴 abre o link GRAVADO pela checagem, não a página da Comix pelo hid", () => {
    render(<ReadingList works={[obra({})]} defaultView="list" nowIso={hoje.toISOString()} />)
    const link = card().getByRole("link", { name: /Continuar lendo/ })
    expect(link.getAttribute("href")).toBe(MANGAGO)
  })

  it("obra nunca checada (sem link gravado) segue na Comix pelo hid, como antes", () => {
    render(<ReadingList works={[obra({ latestChapterUrl: null })]} defaultView="list" nowIso={hoje.toISOString()} />)
    expect(card().getByRole("link", { name: /Continuar lendo/ }).getAttribute("href")).toBe(comixUrl("morto"))
  })

  it("🔴 o leitor vê On-hold, mas não Arquivar", () => {
    render(<ReadingList works={[obra({})]} defaultView="list" nowIso={hoje.toISOString()} />)
    expect(card().getByRole("button", { name: /On-hold/ })).toBeTruthy()
    expect(card().queryByRole("button", { name: /Arquivar/ })).toBeNull()
  })

  it("a curadoria vê os dois", () => {
    render(<ReadingList works={[obra({})]} defaultView="list" nowIso={hoje.toISOString()} canArchive />)
    expect(card().getByRole("button", { name: /On-hold/ })).toBeTruthy()
    expect(card().getByRole("button", { name: /Arquivar/ })).toBeTruthy()
  })
})

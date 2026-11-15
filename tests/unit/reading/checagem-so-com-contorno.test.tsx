import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import { act, render, cleanup } from "@testing-library/react"

// A checagem de capítulos (Comix + Mangago) só funciona com o contorno do Cloudflare, que existe
// no Mac e não em produção. Medido em 15/11/2026: rodada no Fly, falhou em 53 de 55 obras. Onde não
// há contorno, o botão fica desabilitado e um texto VISÍVEL diz onde ela roda — teste de RENDER,
// porque o que regride é a tela voltar a oferecer a ação, não o predicado.

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }))
vi.mock("@/lib/chrome-refresh", () => ({ refreshChrome: vi.fn() }))
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

import { dismissTask, readTasks } from "@/lib/tasks-store"
import { ReadingList } from "@/components/reading/reading-list"
import { CatalogSyncPanel } from "@/components/settings/catalog-sync-panel"
import type { ReadingWork } from "@/server/queries/reading"

const AVISO = /Indisponível neste servidor/

describe("hasCfBypassConfigured — config, não saúde", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  // FLARESOLVERR_URL é lido no carregamento do módulo: cada caso reimporta.
  async function comEnv(sidecar: string, flaresolverr: string): Promise<boolean> {
    vi.resetModules()
    vi.stubEnv("COMIX_RENDER_URL", sidecar)
    vi.stubEnv("FLARESOLVERR_URL", flaresolverr)
    const mod = await import("@/lib/external/flaresolverr")
    return mod.hasCfBypassConfigured()
  }

  it("produção (nenhum dos dois) ⇒ sem contorno", async () => {
    expect(await comEnv("", "")).toBe(false)
  })

  it("só o sidecar, só o FlareSolverr, ou os dois ⇒ com contorno", async () => {
    expect(await comEnv("http://localhost:8790", "")).toBe(true)
    expect(await comEnv("", "http://localhost:8191/v1")).toBe(true)
    expect(await comEnv("http://localhost:8790", "http://localhost:8191/v1")).toBe(true)
  })

  it("variável só com espaço não conta como configurada", async () => {
    expect(await comEnv("   ", "  ")).toBe(false)
  })
})

const base = {
  publicationStatusId: 1,
  coverUrl: "https://example.test/capa.jpg",
  lastReadAt: "2026-08-05T12:00:00.000Z",
  lastChapterReleasedAt: "2026-08-07T12:00:00.000Z",
  nextChapterPredictedAt: null,
  chaptersCheckedAt: null,
  comixHid: null,
  latestChapterUrl: null,
  isAdult: false,
} as unknown as ReadingWork
const WORKS: ReadingWork[] = [{ ...base, id: "w1", title: "Obra 1", chaptersRead: 10, totalChapters: 11 }]

describe("/reading — o botão só é oferecido onde a checagem funciona", () => {
  beforeEach(() => {
    checkReadingUpdates.mockReset()
    for (const t of readTasks()) dismissTask(t.id)
  })
  afterEach(() => {
    cleanup()
    for (const t of readTasks()) dismissTask(t.id)
  })

  it("sem contorno: botão desabilitado, aviso visível, e clicar não chama a checagem", async () => {
    const view = render(
      <ReadingList chapterCheckAvailable={false} works={WORKS} defaultView="list" nowIso="2026-08-08T12:00:00.000Z" />,
    )
    const botao = view.getByRole("button", { name: /Verificar atualizações/ }) as HTMLButtonElement
    expect(botao.disabled).toBe(true)
    expect(view.getByText(AVISO).textContent).toMatch(/Mac \(localhost:3000\)/)

    await act(async () => {
      botao.click()
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    expect(checkReadingUpdates).not.toHaveBeenCalled()
  })

  it("com contorno: botão habilitado e nenhum aviso", () => {
    const view = render(
      <ReadingList chapterCheckAvailable works={WORKS} defaultView="list" nowIso="2026-08-08T12:00:00.000Z" />,
    )
    const botao = view.getByRole("button", { name: /Verificar atualizações/ }) as HTMLButtonElement
    expect(botao.disabled).toBe(false)
    expect(view.queryByText(AVISO)).toBeNull()
  })
})

describe("painel 'Capítulos e status' — a mesma régua", () => {
  afterEach(cleanup)

  const overview = { targets: [{ id: "c1", title: "Catálogo Um" }] as never, neverChecked: 1, checkedLongAgo: 0 }

  it("sem contorno: botão desabilitado e aviso visível", () => {
    const view = render(<CatalogSyncPanel accent="cyan" overview={overview} staleDays={7} available={false} />)
    const botao = view.getByRole("button", { name: /Verificar capítulos e status/ }) as HTMLButtonElement
    expect(botao.disabled).toBe(true)
    expect(view.getByText(AVISO)).toBeTruthy()
  })

  it("com contorno: botão habilitado e nenhum aviso", () => {
    const view = render(<CatalogSyncPanel accent="cyan" overview={overview} staleDays={7} available />)
    const botao = view.getByRole("button", { name: /Verificar capítulos e status/ }) as HTMLButtonElement
    expect(botao.disabled).toBe(false)
    expect(view.queryByText(AVISO)).toBeNull()
  })
})

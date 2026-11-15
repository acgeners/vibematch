import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import { act, render, cleanup, fireEvent, within } from "@testing-library/react"

// A checagem de capítulos devolve o motivo de cada obra "não verificada", e a tela o mostra:
// um link na "Última verificação" e um "Ver motivos" no aviso abrem a lista, com um resumo por
// motivo. Teste de RENDER de propósito: o que regride aqui é a tela deixar de consumir o motivo
// (o objeto pode estar perfeito e a página seguir mostrando só "53 não verificadas").

vi.mock("server-only", () => ({}))
const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }))
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock("sonner", () => ({ toast }))
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
import { readLastReadingCheck, resetLastReadingCheck } from "@/lib/reading/last-check-store"
import type { CheckFailureItem } from "@/lib/reading/last-check-store"
import { CheckFailuresList } from "@/components/reading/check-failures-list"
import { ReadingList } from "@/components/reading/reading-list"
import type { ReadingWork } from "@/server/queries/reading"

const T = (s: string) => `[withTimeout] chapter:${s} excedeu 25000ms`

describe("CheckFailuresList — resumo por motivo + uma linha por obra", () => {
  afterEach(cleanup)

  const items: CheckFailureItem[] = [
    { workId: "a", title: "Obra Alfa", failure: { kind: "sources", sources: { comix: T("comix"), mangago: T("mangago") } } },
    { workId: "b", title: "Obra Beta", failure: { kind: "sources", sources: { comix: T("comix"), mangago: "sem vínculo" } } },
    { workId: "c", title: "Obra Gama", failure: { kind: "sources", sources: { comix: "comix indisponível (rate_limited)", mangago: "sem vínculo" } } },
  ]

  it("mostra cada motivo com quantas obras o têm, e o texto cru na dica", () => {
    const { getByRole, getAllByTitle } = render(<CheckFailuresList items={items} />)
    expect(getByRole("button", { name: /Comix · tempo esgotado \(25 s\)\s*2/ })).toBeTruthy()
    expect(getByRole("button", { name: /Mangago · sem vínculo\s*2/ })).toBeTruthy()
    expect(getByRole("button", { name: /Comix · limite de pedidos\s*1/ })).toBeTruthy()
    expect(getAllByTitle("comix indisponível (rate_limited)")).toHaveLength(1)
  })

  it("clicar num motivo filtra a lista; clicar de novo limpa", () => {
    const { getByRole, queryByText } = render(<CheckFailuresList items={items} />)
    const chip = getByRole("button", { name: /Comix · limite de pedidos/ })
    fireEvent.click(chip)
    expect(queryByText("Obra Gama")).toBeTruthy()
    expect(queryByText("Obra Alfa")).toBeNull()
    fireEvent.click(chip)
    expect(queryByText("Obra Alfa")).toBeTruthy()
  })

  it("com `limit`, mostra só as primeiras e oferece 'Ver todas'", () => {
    const { queryByText, getByRole } = render(<CheckFailuresList items={items} limit={2} />)
    expect(queryByText("Obra Gama")).toBeNull()
    fireEvent.click(getByRole("button", { name: "Ver todas as 3" }))
    expect(queryByText("Obra Gama")).toBeTruthy()
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
const WORKS: ReadingWork[] = Array.from({ length: 3 }, (_, i) => ({
  ...base,
  id: `w${i + 1}`,
  title: `Obra ${i + 1}`,
  chaptersRead: 10,
  totalChapters: 11,
}))

describe("/reading — a checagem com falhas leva aos motivos", () => {
  beforeEach(() => {
    checkReadingUpdates.mockReset()
    toast.warning.mockReset()
    toast.error.mockReset()
    toast.success.mockReset()
    push.mockReset()
    resetLastReadingCheck()
    for (const t of readTasks()) dismissTask(t.id)
  })
  afterEach(() => {
    cleanup()
    resetLastReadingCheck()
    for (const t of readTasks()) dismissTask(t.id)
  })

  async function checar() {
    checkReadingUpdates.mockResolvedValue([
      { workId: "w1", hasNew: false, latestExternal: 11, failed: false },
      {
        workId: "w2",
        hasNew: false,
        latestExternal: null,
        failed: true,
        failure: { kind: "sources", sources: { comix: "comix indisponível (rate_limited)", mangago: T("mangago") } },
      },
      { workId: "w3", hasNew: false, latestExternal: null, failed: true, failure: { kind: "whole", reason: "erro: falha ao gravar" } },
    ])
    const view = render(<ReadingList works={WORKS} defaultView="list" nowIso="2026-08-08T12:00:00.000Z" />)
    await act(async () => {
      view.getByText("Verificar atualizações").click()
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    return view
  }

  it("o link '2 não verificadas · ver motivos' abre a lista com o motivo de cada fonte", async () => {
    const view = await checar()
    fireEvent.click(view.getByRole("button", { name: "2 não verificadas · ver motivos" }))

    const dialog = within(view.getByRole("dialog"))
    expect(dialog.getByText("2 obras não verificadas")).toBeTruthy()
    expect(dialog.getByText(/As outras 1 foram verificadas/)).toBeTruthy()
    expect(dialog.getByText("Obra 2")).toBeTruthy()
    expect(dialog.getAllByText(/limite de pedidos/).length).toBeGreaterThan(0)
    expect(dialog.getAllByText(/erro inesperado/).length).toBeGreaterThan(0)
  })

  it("o aviso do fim traz 'Ver motivos', que abre a lista (e volta à /reading se precisar)", async () => {
    await checar()
    const opts = toast.warning.mock.calls.at(-1)![1] as { action?: { label: string; onClick: () => void } }
    expect(opts.action?.label).toBe("Ver motivos")

    act(() => opts.action!.onClick())
    expect(readLastReadingCheck().open).toBe(true)
  })

  it("o título do aviso só diz 'nenhuma novidade' sobre as obras verificadas", async () => {
    await checar()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.warning.mock.calls.at(-1)![0]).toBe("Nenhuma novidade na única obra verificada")
  })

  it("com todas não verificadas, o aviso é de falha (vermelho), não 'nenhuma novidade'", async () => {
    checkReadingUpdates.mockResolvedValue(
      WORKS.map((w) => ({
        workId: w.id,
        hasNew: false,
        latestExternal: null,
        failed: true,
        failure: { kind: "sources", sources: { comix: "comix indisponível (blocked)", mangago: "mangago bypass_unavailable: x" } },
      })),
    )
    const view = render(<ReadingList works={WORKS} defaultView="list" nowIso="2026-08-08T12:00:00.000Z" />)
    await act(async () => {
      view.getByText("Verificar atualizações").click()
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    const [title, opts] = toast.error.mock.calls.at(-1)! as [string, { action?: { label: string } }]
    expect(title).toBe("Nenhuma obra foi verificada")
    expect(opts.action?.label).toBe("Ver motivos")
  })

  it("sem falhas, nada de link nem de 'Ver motivos'", async () => {
    checkReadingUpdates.mockResolvedValue(WORKS.map((w) => ({ workId: w.id, hasNew: false, latestExternal: 11, failed: false })))
    const view = render(<ReadingList works={WORKS} defaultView="list" nowIso="2026-08-08T12:00:00.000Z" />)
    await act(async () => {
      view.getByText("Verificar atualizações").click()
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    expect(view.queryByRole("button", { name: /ver motivos/ })).toBeNull()
    expect(readLastReadingCheck().last?.failures).toEqual([])
  })
})

describe("painel 'Capítulos e status' do catálogo — a mesma lista, com motivo", () => {
  beforeEach(() => {
    checkReadingUpdates.mockReset()
    for (const t of readTasks()) dismissTask(t.id)
  })
  afterEach(() => {
    cleanup()
    for (const t of readTasks()) dismissTask(t.id)
  })

  it("a última execução lista as não verificadas com o motivo de cada fonte, não só os nomes", async () => {
    const { CatalogSyncPanel } = await import("@/components/settings/catalog-sync-panel")
    checkReadingUpdates.mockResolvedValue([
      { workId: "c1", hasNew: false, latestExternal: 5, failed: false, statusApplied: null },
      {
        workId: "c2",
        hasNew: false,
        latestExternal: null,
        failed: true,
        statusApplied: null,
        failure: { kind: "sources", sources: { comix: T("comix"), mangago: "sem vínculo" } },
      },
    ])
    const view = render(
      <CatalogSyncPanel
        accent="cyan"
        overview={{ targets: [{ id: "c1", title: "Catálogo Um" }, { id: "c2", title: "Catálogo Dois" }] as never, neverChecked: 2, checkedLongAgo: 0 }}
        staleDays={7}
      />,
    )
    await act(async () => {
      view.getByRole("button", { name: /Verificar capítulos e status/ }).click()
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })

    expect(view.getByText("Catálogo Dois")).toBeTruthy()
    expect(view.getByRole("button", { name: /Comix · tempo esgotado \(25 s\)\s*1/ })).toBeTruthy()
    expect(view.getAllByText(/sem vínculo/).length).toBeGreaterThan(0)
  })
})

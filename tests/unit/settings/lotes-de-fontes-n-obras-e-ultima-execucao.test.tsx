import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock("@/lib/chrome-refresh", () => ({ refreshChrome: vi.fn() }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
const checkReadingUpdates = vi.hoisted(() =>
  vi.fn(async (ids: string[]) => ids.map((workId) => ({ workId, failed: false, statusApplied: null, hasNew: false }))),
)
vi.mock("@/server/actions/reading", () => ({ checkReadingUpdates }))
const checkComixHealth = vi.hoisted(() => vi.fn())
vi.mock("@/server/actions/comix-resolver", () => ({ checkComixHealth }))

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { CatalogSyncPanel } from "@/components/settings/catalog-sync-panel"
import { ComixHealthPanel } from "@/components/settings/comix-health-panel"
import { dismissTask, readTasks } from "@/lib/tasks-store"
import { firstN, formatDateTime, latestCheck } from "@/lib/catalog/batch-targets"

/**
 * Pedidos de 16/11/2026 para `/curation/settings?g=fontes`: rodar o lote só em N obras, e mostrar
 * a data e a hora da última execução de cada ação.
 */

describe("regras dos lotes", () => {
  const alvos = [
    { id: "a", checkedAt: null },
    { id: "b", checkedAt: "2026-11-01T10:00:00Z" },
    { id: "c", checkedAt: "2026-11-16T05:37:00Z" },
  ]
  it("as N primeiras; sem número, zero ou acima do total: todas", () => {
    expect(firstN(alvos, 2).map((t) => t.id)).toEqual(["a", "b"])
    expect(firstN(alvos, null)).toHaveLength(3)
    expect(firstN(alvos, 0)).toHaveLength(3)
    expect(firstN(alvos, 99)).toHaveLength(3)
  })
  it("a última execução é a checagem mais recente; nenhuma = null", () => {
    expect(latestCheck(alvos)).toBe("2026-11-16T05:37:00Z")
    expect(latestCheck([{ checkedAt: null }])).toBeNull()
  })
  it("data e hora no fuso de São Paulo", () => {
    expect(formatDateTime("2026-11-16T05:37:00Z")).toBe("16/11/2026 às 02:37")
  })
})

describe("lote de capítulos e status", () => {
  const overview = {
    targets: [
      { id: "w1", title: "Mais antiga", checkedAt: null },
      { id: "w2", title: "Segunda", checkedAt: "2026-10-01T00:00:00Z" },
      { id: "w3", title: "Terceira", checkedAt: "2026-11-16T05:37:00Z" },
    ],
    neverChecked: 1,
    checkedLongAgo: 1,
  }
  beforeEach(() => {
    checkReadingUpdates.mockClear()
  })
  afterEach(() => {
    for (const t of readTasks()) dismissTask(t.id)
    cleanup()
  })

  it("com 'Quantas' = 2, roda só nas 2 checadas há mais tempo", async () => {
    render(<CatalogSyncPanel accent="amber" overview={overview} staleDays={7} available />)
    await act(async () => {
      fireEvent.change(screen.getByLabelText(/Quantas obras rodar/), { target: { value: "2" } })
    })
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Verificar capítulos e status/ }))
    })
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(checkReadingUpdates).toHaveBeenCalledTimes(1)
    expect(checkReadingUpdates.mock.calls[0][0]).toEqual(["w1", "w2"])
  })

  it("mostra a data e a hora da checagem mais recente", async () => {
    render(<CatalogSyncPanel accent="amber" overview={overview} staleDays={7} available />)
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(screen.getByText(/Última checagem: 16\/11\/2026 às 02:37/)).toBeTruthy()
  })
})

describe("teste de conexão da Comix: o último teste fica guardado", () => {
  beforeEach(() => {
    window.localStorage.clear()
    checkComixHealth.mockReset()
  })
  afterEach(cleanup)

  it("depois de testar, remontar o painel ainda mostra quando e como foi", async () => {
    checkComixHealth.mockResolvedValueOnce({
      checkedAt: "2026-11-16T05:37:00Z",
      checks: [{ ok: false, key: "detail", label: "Detalhe (SSR)", detail: "403" }],
    })
    const { unmount } = render(<ComixHealthPanel accent="amber" available />)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Testar agora/ }))
    })
    unmount()
    render(<ComixHealthPanel accent="amber" available />)
    await act(() => new Promise((r) => setTimeout(r, 0)))
    expect(screen.getByText(/Último teste \(com problemas\): 16\/11\/2026 às 02:37/)).toBeTruthy()
  })
})

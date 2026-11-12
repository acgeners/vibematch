import { vi, describe, it, expect, afterEach, beforeEach } from "vitest"
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react"

const { refreshMock, toastMock } = vi.hoisted(() => ({
  refreshMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/curation/settings",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: toastMock }))
vi.mock("@/server/actions/embeddings", () => ({ refreshEmbeddings: refreshMock }))
// O store de tarefas real é coberto em outro lugar; aqui importa só que o `onDone`
// recebe o resultado da action.
vi.mock("@/lib/tasks-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks-store")>()),
  runTask: vi.fn(async (spec: { run: () => Promise<unknown>; onDone?: (r: unknown) => void }) => {
    spec.onDone?.(await spec.run())
  }),
}))

import { EmbeddingsPanel } from "@/components/settings/embeddings-panel"
import { OPENAI_BILLING_URL } from "@/lib/ml/embedding-failure"

const PROPS = {
  accent: "cyan" as const,
  initialCachedCount: 1000,
  pendingCount: 15,
  totalWorks: 1015,
  initialLastRun: null,
}

function resultado(failures: Array<{ kind: string; detail: string; works: number }>) {
  const failed = failures.reduce((s, f) => s + f.works, 0)
  return {
    totalWorks: 1015,
    skipped: 1000,
    refreshed: 0,
    tokensUsed: 0,
    estimatedCostUsd: 0,
    failed,
    failures,
  }
}

async function clicarEmAtualizar() {
  fireEvent.click(screen.getByRole("button", { name: /Atualizar embeddings/i }))
  await waitFor(() => expect(toastMock.warning).toHaveBeenCalled())
  const [texto, opcoes] = toastMock.warning.mock.calls[0] as [
    string,
    { action?: { label: string; onClick: () => void } } | undefined,
  ]
  return { texto, opcoes }
}

/**
 * O aviso de falha dos embeddings diz O MOTIVO — teste de RENDER de propósito.
 *
 * 🔴 Era "0 embedados, 15 falharam. Veja os logs do servidor." O motivo (conta da
 * OpenAI sem crédito) estava no servidor e não chegava à tela; "os logs" são um
 * arquivo no Mac ou o painel da Fly. Resultado medido em 2026-11-11: a curadora foi
 * conferir o saldo da ANTHROPIC, que tinha crédito. Um teste que lesse só o
 * objeto devolvido passaria verde com o painel ainda imprimindo a frase antiga.
 */
describe("o aviso de falha dos embeddings diz o motivo", () => {
  beforeEach(() => {
    refreshMock.mockReset()
    for (const fn of Object.values(toastMock)) fn.mockReset()
  })
  afterEach(cleanup)

  it("sem crédito: o aviso nomeia a OpenAI e oferece a página de cobrança", async () => {
    refreshMock.mockResolvedValue(
      resultado([{ kind: "sem_credito", detail: "You have no credits remaining.", works: 15 }]),
    )
    render(<EmbeddingsPanel {...PROPS} />)
    const { texto, opcoes } = await clicarEmAtualizar()

    expect(texto).toContain("15 falharam")
    expect(texto).toContain("conta da OpenAI está sem crédito")
    expect(texto, "voltou a mandar o leitor para um lugar fora do app").not.toMatch(/logs do servidor/i)

    const abrir = vi.spyOn(window, "open").mockImplementation(() => null)
    expect(opcoes?.action?.label).toBe("Abrir cobrança da OpenAI")
    opcoes?.action?.onClick()
    expect(abrir).toHaveBeenCalledWith(OPENAI_BILLING_URL, "_blank", "noopener,noreferrer")
    abrir.mockRestore()
  })

  it("o motivo fica na TELA depois que o aviso some", async () => {
    refreshMock.mockResolvedValue(
      resultado([{ kind: "sem_credito", detail: "You have no credits remaining.", works: 15 }]),
    )
    render(<EmbeddingsPanel {...PROPS} />)
    await clicarEmAtualizar()

    expect(screen.getByText(/conta da OpenAI está sem crédito/)).toBeTruthy()
    const link = screen.getByRole("link", { name: "Abrir cobrança da OpenAI" }) as HTMLAnchorElement
    expect(link.href).toBe(OPENAI_BILLING_URL)
  })

  it("motivo que não é de cobrança não oferece o botão de cobrança", async () => {
    refreshMock.mockResolvedValue(
      resultado([{ kind: "limite_de_ritmo", detail: "Rate limit reached.", works: 15 }]),
    )
    render(<EmbeddingsPanel {...PROPS} />)
    const { texto, opcoes } = await clicarEmAtualizar()

    expect(texto).toContain("a OpenAI limitou o ritmo")
    expect(opcoes?.action).toBeUndefined()
    expect(screen.queryByRole("link", { name: "Abrir cobrança da OpenAI" })).toBeNull()
  })
})

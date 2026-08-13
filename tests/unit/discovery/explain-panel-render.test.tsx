import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react"
import { ExplainPanel } from "@/components/discovery/explain-panel"

/**
 * Teste de RENDER de propósito.
 *
 * O que regride aqui não é a lógica — é o que a árvore desenha. A 1ª versão do painel
 * imprimia só a nota e o parágrafo, sem o TÍTULO: cinco explicações soltas que a pessoa
 * tinha que casar de cabeça com a lista acima. Um teste que lesse o objeto do resultado
 * passaria verde com esse defeito na tela, porque os dados estavam todos lá.
 */

const explicar = vi.fn()
const aplicar = vi.fn()

vi.mock("@/server/actions/recommendations", () => ({
  explainSeedResultsAction: (...args: unknown[]) => explicar(...args),
  applySeedVerdictAction: (...args: unknown[]) => aplicar(...args),
}))

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

// `useScopedGuard` chama `useRouter` para interceptar navegação (guardNavigation).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}))

const WORKS = [
  { id: "w1", title: "A Villainess Que Não Desiste" },
  { id: "w2", title: "O Duque e o Contrato" },
]

const RESULT = {
  runId: "run-1",
  slug: "2026-08-13-1",
  modeSummary: "As duas giram em torno de vilãs transmigradas.",
  rankings: [
    { workId: "w2", alignmentScore: 55, justification: "Química forçada entre FL e ML." },
    { workId: "w1", alignmentScore: 78, justification: "FL ativa, romance slow-burn saudável." },
  ],
}

function renderPanel() {
  return render(
    <ExplainPanel seedIds={["s1", "s2"]} antiIds={[]} works={WORKS} weight={0.5} />,
  )
}

beforeEach(() => {
  cleanup()
  explicar.mockReset()
  aplicar.mockReset()
  explicar.mockResolvedValue({ data: RESULT })
  aplicar.mockResolvedValue({ data: { applied: 2 } })
})

describe("ExplainPanel", () => {
  it("anuncia o custo MEDIDO, formatado pela régua do projeto", async () => {
    renderPanel()
    // ~6,38¢ — centavos abaixo de 10¢ e vírgula pt-BR, como manda lib/format/money.ts.
    expect(screen.getByText(/6,38¢/)).toBeTruthy()
  })

  it("o botão diz quantas obras vão ao modelo", () => {
    renderPanel()
    expect(screen.getByRole("button", { name: /Explicar as 2 primeiras/ })).toBeTruthy()
  })

  it("🔴 cada explicação vem com o TÍTULO da obra", async () => {
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /Explicar as 2/ }))
    await waitFor(() => expect(screen.getByText(/FL ativa/)).toBeTruthy())

    for (const w of WORKS) {
      expect(screen.getByText(w.title), `sem o título "${w.title}"`).toBeTruthy()
    }
  })

  it("🔴 a nota vem rotulada 'Ver.' — senão é lida como posição no ranking", async () => {
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /Explicar as 2/ }))
    await waitFor(() => expect(screen.getByText(/Ver\. 78/)).toBeTruthy())
    expect(screen.getByText(/Ver\. 55/)).toBeTruthy()
  })

  it("mantém a ordem da LISTA, não a do modelo", async () => {
    // O modelo devolveu w2 (55) antes de w1 (78); a tela mostra na ordem da lista, que é
    // como a pessoa casa cada parágrafo com a linha que está vendo acima.
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /Explicar as 2/ }))
    await waitFor(() => expect(screen.getByText(/FL ativa/)).toBeTruthy())

    const itens = screen.getAllByRole("listitem").map((li) => li.textContent ?? "")
    const i1 = itens.findIndex((t) => t.includes(WORKS[0].title))
    const i2 = itens.findIndex((t) => t.includes(WORKS[1].title))
    expect(i1).toBeGreaterThanOrEqual(0)
    expect(i1).toBeLessThan(i2)
  })

  it("aplicar manda o runId e confirma na tela", async () => {
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /Explicar as 2/ }))
    await waitFor(() => expect(screen.getByRole("button", { name: /Aplicar ao catálogo/ })).toBeTruthy())

    fireEvent.click(screen.getByRole("button", { name: /Aplicar ao catálogo/ }))
    await waitFor(() => expect(screen.getByText(/Aplicado ao catálogo/)).toBeTruthy())
    expect(aplicar).toHaveBeenCalledWith("run-1")
  })

  it("erro da action não deixa a tela dizendo que aplicou", async () => {
    explicar.mockResolvedValue({ error: "Limite diário atingido." })
    renderPanel()
    fireEvent.click(screen.getByRole("button", { name: /Explicar as 2/ }))
    await waitFor(() => expect(explicar).toHaveBeenCalled())
    expect(screen.queryByRole("button", { name: /Aplicar ao catálogo/ })).toBeNull()
  })
})

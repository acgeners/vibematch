import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/curation/settings",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock("@/server/actions/embeddings", () => ({ refreshEmbeddings: vi.fn() }))

import { EmbeddingsPanel } from "@/components/settings/embeddings-panel"

/** O número que o StatCard "Sem embedding" está mostrando na tela. */
function semEmbeddingNaTela(): string {
  const rotulo = screen.getByText("Sem embedding")
  const card = rotulo.parentElement
  if (!card) throw new Error("StatCard sem contêiner")
  // <p>label</p><p>value</p><p>hint</p> — o valor é o irmão seguinte do rótulo.
  return (card.querySelectorAll("p")[1]?.textContent ?? "").trim()
}

const BASE = {
  accent: "cyan" as const,
  initialCachedCount: 1009,
  totalWorks: 1009,
  initialLastRun: null,
}

/**
 * "Sem embedding" tem que seguir o SERVIDOR, e este é teste de RENDER de propósito.
 *
 * 🔴 O painel guardava o número em `useState(initialPendingCount)` e, ao terminar
 * uma execução, gravava `result.failed` nele. Isso criava dois critérios pro mesmo
 * fato a dois centímetros um do outro dentro do MESMO card: a pílula do cabeçalho
 * (renderizada no servidor, via `getSettingsItemUnread`) dizia "15 pendentes" e o
 * StatCard logo abaixo dizia "0". E `failed` nem é a mesma grandeza — obra que
 * falhou pode já ter linha antiga em `work_embeddings`, ou seja NÃO está "sem
 * embedding".
 *
 * Com o número vindo direto da prop, o `router.refresh()` disparado no fim da
 * execução reconcilia as duas superfícies de uma vez. Um teste que lesse o objeto
 * de resultado passaria verde com o número congelado na tela — só a árvore
 * desenhada mostra a divergência.
 */
describe("o painel de embeddings segue a contagem do servidor", () => {
  afterEach(cleanup)

  it("imprime a contagem que recebeu por prop", () => {
    render(<EmbeddingsPanel {...BASE} pendingCount={7} />)
    expect(semEmbeddingNaTela()).toBe("7")
  })

  it("acompanha a prop quando o servidor re-renderiza (o que o router.refresh() faz)", () => {
    const { rerender } = render(<EmbeddingsPanel {...BASE} pendingCount={7} />)
    expect(semEmbeddingNaTela()).toBe("7")
    // É exatamente isto que o `refresh()` do `onDone` provoca: mesma instância do
    // componente, props novas. Com a cópia em estado, a tela ficaria em "7".
    rerender(<EmbeddingsPanel {...BASE} pendingCount={0} />)
    expect(
      semEmbeddingNaTela(),
      "o número congelou: alguém devolveu a cópia local (useState) da contagem do servidor",
    ).toBe("0")
  })

  it("o botão nunca é desabilitado por contagem zero", () => {
    // Zero aqui NÃO quer dizer "nada a fazer": o contador olha linha ausente e o
    // botão trabalha por hash. Já trancou o único caminho de re-embedar uma vez.
    render(<EmbeddingsPanel {...BASE} pendingCount={0} />)
    const botao = screen.getByRole("button", { name: /Atualizar embeddings/i }) as HTMLButtonElement
    expect(botao.disabled).toBe(false)
  })
})

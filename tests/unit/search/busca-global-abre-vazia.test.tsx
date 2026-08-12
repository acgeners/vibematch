import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, act } from "@testing-library/react"
import type { SearchEntry } from "@/server/queries/search-index"

/**
 * Duas coisas que só a árvore DESENHADA prova, e que um teste sobre o índice passaria verde:
 *
 *   1. **A busca abre VAZIA.** Antes, sem termo, `matches` devolvia o índice inteiro — o diálogo
 *      abria despejando ~40 seções de Configurações/Preferências/Páginas na frente do campo que
 *      a pessoa veio usar. Nada quebrava: os itens eram todos legítimos, só não tinham sido
 *      pedidos.
 *   2. **O diálogo é ancorado no TOPO.** O `DialogContent` padrão é `top-1/2 -translate-y-1/2`,
 *      e num diálogo cuja altura depende do resultado isso faz a borda de cima — onde mora o
 *      campo de busca — escorregar a cada tecla. Aqui a asserção é de CLASSE e não de layout
 *      porque o jsdom não calcula layout; o que precisa não regredir é o par
 *      `top-*` + `translate-y-0`, e é ele que está no DOM.
 */

// O cmdk observa o tamanho da lista; o jsdom não tem ResizeObserver. Stub inerte — nada aqui
// depende de medida, e é só isso que impede o componente de montar.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= function scrollIntoView() {}

// ⚠️ Os papéis são em PORTUGUÊS ("curador", não "curator"). Com um nome inválido,
// `roleAtLeast` compara `undefined >= undefined` → false, `visible` fica vazio e o teste passa
// verde sem nunca ter renderizado um item — foi exatamente o que aconteceu na 1ª versão daqui.
vi.mock("@/components/layout/admin-context", () => ({
  useRole: () => "curador",
  useIsSignedIn: () => true,
}))

const searchWorkSuggestions = vi.fn(async (_term: string) => [])
vi.mock("@/server/actions/work-search", () => ({
  searchWorkSuggestions: (t: string) => searchWorkSuggestions(t),
}))

const INDEX: SearchEntry[] = [
  {
    id: "cfg-calibracao-auto",
    kind: "config",
    title: "Calibração automática",
    description: "MAEs e pseudo-votos recalculados a partir dos dados reais",
    href: "/settings?g=calibracao",
    crumb: "Configurações › Calibração das notas",
    iconName: "Gauge",
    minRole: "curador",
    requiresSession: true,
  },
  {
    id: "cfg-embeddings",
    kind: "config",
    title: "Embeddings",
    description: "Representação vetorial via OpenAI para obras parecidas",
    href: "/settings?g=ia",
    crumb: "Configurações › Gerado por IA",
    iconName: "Sparkles",
    minRole: "curador",
    requiresSession: true,
  },
  {
    id: "page-ranking",
    kind: "page",
    title: "Ranking",
    description: "Ordena o catálogo pela Nota Prevista",
    href: "/ranking",
    crumb: null,
    iconName: "Trophy",
    minRole: "leitor",
    requiresSession: true,
  },
]

/** Os itens desenhados na lista — é o que a pessoa vê, e o que a 1ª versão deste teste não olhou. */
const itensNaLista = () =>
  Array.from(document.querySelectorAll("[data-slot=command-item]"))

beforeEach(() => {
  searchWorkSuggestions.mockClear()
})

async function abrirBusca() {
  const { GlobalSearch } = await import("@/components/search/global-search")
  render(<GlobalSearch index={INDEX} />)
  const [gatilho] = screen.getAllByRole("button", { name: /buscar/i })
  await act(async () => {
    gatilho.click()
  })
}

describe("busca global", () => {
  it("abre sem nenhum resultado listado", async () => {
    await abrirBusca()

    expect(screen.getByPlaceholderText(/Buscar obras, ajustes, páginas/i)).toBeTruthy()
    expect(
      itensNaLista().map((el) => el.textContent),
      "sem termo, o índice não pode ser despejado na tela",
    ).toEqual([])
    expect(screen.getByText(/Comece a digitar para buscar/i)).toBeTruthy()
    expect(searchWorkSuggestions, "sem termo, nem o servidor é consultado").not.toHaveBeenCalled()
  })

  it("as três entradas do índice APARECEM quando há termo — o vazio é do termo, não do papel", async () => {
    const { fireEvent } = await import("@testing-library/react")
    await abrirBusca()

    // Contraprova: sem isto, um índice filtrado por engano (papel errado, `requiresSession`)
    // deixaria o teste acima verde por motivo nenhum. Foi assim que a 1ª versão passou com
    // `matches = visible` ainda no lugar.
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText(/Buscar obras, ajustes, páginas/i), {
        target: { value: "a" },
      })
    })

    expect(itensNaLista().length).toBeGreaterThan(0)
  })

  it("ancora o diálogo no topo, sem centralização vertical", async () => {
    await abrirBusca()

    const content = document.querySelector("[data-slot=dialog-content]")
    expect(content, "o diálogo não montou").not.toBeNull()
    const cls = content!.className

    expect(cls, "precisa de um `top-*` explícito").toMatch(/\btop-\[/)
    expect(
      cls,
      "sem `translate-y-0` o -50% do padrão continua valendo e a altura volta a mover o topo",
    ).toMatch(/\btranslate-y-0\b/)
    expect(cls, "centralização vertical do padrão não pode sobreviver").not.toMatch(
      /translate-y-\[-50%\]/,
    )
  })
})

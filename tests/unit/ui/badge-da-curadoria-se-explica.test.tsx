import { vi, describe, it, expect, afterEach, beforeAll } from "vitest"
import { render, cleanup, screen, fireEvent } from "@testing-library/react"

/**
 * O número ao lado de "Curadoria da Obra" conta DECISÃO ESPERANDO (avaliação nunca
 * feita ou aguardando revisão, não-lida). As abas contam o tamanho da lista no filtro
 * padrão, que inclui a reavaliação por reviews novas. Em 2026-10-09 eram "1" na sidebar
 * e "492" na aba, e o 1 foi reportado como errado: ele ficava ao lado de "fila de
 * atributos" e o clique abria a lista de 492, onde a obra que ele contava sumia.
 *
 * A régua escolhida foi manter o número e fazê-lo se EXPLICAR — o texto diz o que ele
 * conta e o clique abre a lista recortada nisso. São três pontas, e cada uma regride
 * calada:
 *
 * 1. a sidebar (RENDER: o que regride é o componente deixar de consumir o destino);
 * 2. o recorte do link ter de bater com a query do número — os dois derivam de
 *    `ATTR_DECISION_FILTERS`, e o caso abaixo prova isso pela chamada, não pela grafia;
 * 3. o painel de filtros, que tinha uma CÓPIA defasada do default e apagava exatamente
 *    esse recorte da URL ao aplicar.
 */

let badges = { curadoria: 0, requests: 0 }

vi.mock("server-only", () => ({}))
const nav = { replace: vi.fn(), push: vi.fn() }
vi.mock("next/navigation", () => ({
  usePathname: () => "/curation",
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => nav,
}))
vi.mock("@/components/layout/chrome-badges", () => ({
  useChromeBadges: () => ({
    curadoria: badges.curadoria,
    recQueue: 0,
    requests: badges.requests,
    settings: 0,
    settingsByGroup: {},
    recalcPending: false,
    comixHealth: "unknown" as const,
    clearRecalcPending: () => {},
  }),
}))
vi.mock("@/components/layout/admin-context", () => ({
  useCanWriteOwnState: () => true,
  useIsAdmin: () => true,
}))

// ── a query do número, sem banco: grava o `.in()` que ela monta ──────────────────
const inCalls: unknown[][] = []
const chain: Record<string, unknown> = new Proxy(
  {},
  {
    get: (_t, prop) =>
      prop === "in"
        ? (...args: unknown[]) => {
            inCalls.push(args)
            return chain
          }
        : () => chain,
  },
)
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => chain }))
vi.mock("@/lib/supabase/paginate", () => ({
  fetchAllRows: async (build: () => unknown) => {
    build()
    return [{ id: "w1" }, { id: "w2" }]
  },
}))
vi.mock("@/server/queries/current-user", () => ({ getSessionUserId: async () => null }))
vi.mock("@/server/queries/recommendations", () => ({}))
vi.mock("@/server/queries/works-without-reviews", () => ({}))
vi.mock("@/server/queries/works-without-tags", () => ({}))

import { ConsoleNav } from "@/components/curation/console-nav"
import { AiEvaluationFilters } from "@/components/ai-evaluation/ai-evaluation-filters"
import { DECISION_QUEUES } from "@/lib/curation/decision-queues"
import {
  ATTR_DECISION_EVAL_STATUSES,
  ATTR_DECISION_FILTERS,
  DEFAULT_ATTR_EVAL_FILTERS,
  parseAttrEvalFilters,
} from "@/lib/ai-evaluation/attr-eval-filters"
import { getCuradoriaBadgeUnreadCount } from "@/server/queries/ai-eval-read"

const curadoria = DECISION_QUEUES.find((q) => q.key === "curadoria")!

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  badges = { curadoria: 0, requests: 0 }
  nav.replace.mockClear()
  inCalls.length = 0
  window.localStorage.clear()
})

function linhaDaCuradoria(): HTMLAnchorElement {
  return screen.getByRole("link", { name: /Curadoria da Obra/ }) as HTMLAnchorElement
}

describe("sidebar: o número diz o que conta e leva até lá", () => {
  const renderNav = () => render(<ConsoleNav settingsGroups={[]} defaultSettingsGroup="x" />)

  it("com 1 pendente, a linha diz \"1 decisão esperando\" — não \"fila de atributos\"", () => {
    badges = { curadoria: 1, requests: 0 }
    renderNav()
    const texto = linhaDaCuradoria().textContent ?? ""
    expect(texto).toContain("1 decisão esperando")
    expect(texto).not.toContain("fila de atributos")
  })

  it("o plural acompanha o número", () => {
    badges = { curadoria: 3, requests: 2 }
    renderNav()
    expect(linhaDaCuradoria().textContent).toContain("3 decisões esperando")
    expect(screen.getByRole("link", { name: /Pedidos/ }).textContent).toContain("2 pedidos em aberto")
  })

  it("o clique abre a lista recortada no que o número conta, não a aba no padrão", () => {
    badges = { curadoria: 1, requests: 0 }
    renderNav()
    expect(linhaDaCuradoria().getAttribute("href")).toBe(curadoria.focusHref)
    expect(curadoria.focusHref).not.toBe(curadoria.href)
  })

  it("zerada, a linha volta a ser só o destino, com a dica fixa", () => {
    renderNav()
    expect(linhaDaCuradoria().getAttribute("href")).toBe("/curation/works")
    expect(linhaDaCuradoria().textContent).toContain("fila de atributos")
  })
})

describe("o recorte do link é o MESMO que a query do número usa", () => {
  it("o `filter` do link é aceito pela página — não cai no default", () => {
    const filter = new URL(curadoria.focusHref, "http://x").searchParams.get("filter") ?? undefined
    const lido = parseAttrEvalFilters(filter)
    expect(lido).toEqual([...ATTR_DECISION_FILTERS])
    // Contraprova: um typo no link faria a página abrir o default (as ~490), calada.
    expect(lido).not.toEqual([...DEFAULT_ATTR_EVAL_FILTERS])
  })

  it("a query do número filtra pelos status que o link recorta", async () => {
    const n = await getCuradoriaBadgeUnreadCount()
    expect(n).toBe(2)
    const statusCall = inCalls.find((c) => c[0] === "ai_eval_status")
    expect(statusCall?.[1]).toEqual([...ATTR_DECISION_EVAL_STATUSES])
    expect(ATTR_DECISION_EVAL_STATUSES).toEqual(["pending", "review_pending"])
  })
})

describe("o painel de filtros não apaga mais o recorte", () => {
  const renderPanel = (activeFilters: string[]) =>
    render(
      <AiEvaluationFilters
        activeFilters={activeFilters as never}
        activePubStatuses={[]}
        activePersonalStatuses={[]}
      />,
    )

  it("no padrão da página, o painel não conta filtro nem acusa alteração pendente", () => {
    renderPanel([...DEFAULT_ATTR_EVAL_FILTERS])
    const heading = screen.getByRole("heading", { name: "Filtros" })
    // O contador fica logo depois do título; com a cópia defasada ele dizia "3".
    expect(heading.nextElementSibling).toBeNull()
    expect(screen.queryByText("alterações não aplicadas")).toBeNull()
  })

  it("aplicar \"Sem avaliação + Aguardando revisão\" mantém o filtro na URL", () => {
    renderPanel([...DEFAULT_ATTR_EVAL_FILTERS])
    fireEvent.click(screen.getByText("Reviews novas"))
    fireEvent.click(screen.getByRole("button", { name: /^Aplicar/ }))
    expect(nav.replace).toHaveBeenCalledTimes(1)
    const url = String(nav.replace.mock.calls[0][0])
    const filter = new URL(url, "http://x").searchParams.get("filter")
    expect(filter?.split(",").sort()).toEqual([...ATTR_DECISION_FILTERS].sort())
  })
})

import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen } from "@testing-library/react"

/**
 * A console aninhou em `/curation/*` em 2026-08-16, e isso deu à raiz uma propriedade
 * que ela não tinha: **`/curation` é prefixo dos outros quatro**. Com o `startsWith`
 * uniforme que parece natural aqui, "Visão geral" fica acesa nas CINCO páginas — duas
 * linhas com `aria-current="page"` ao mesmo tempo, e o menu deixa de dizer onde você
 * está. Não quebra build, não quebra runtime, não aparece em teste de gate.
 *
 * 🔴 O teste que já existia (`console-nav-settings-branch`) NÃO pega isto: ele mocka
 * `usePathname` fixo em `/curation`, o único valor em que os dois comportamentos
 * coincidem. Por isso aqui o pathname é PARAMETRIZADO — o mock lê uma variável de
 * módulo, e cada caso a reescreve antes de renderizar.
 *
 * É teste de RENDER de propósito: o que regride é o `aria-current` da árvore desenhada.
 * Um teste da função pura passaria verde com o componente chamando outra coisa.
 */

let pathname = "/curation"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}))
vi.mock("@/components/layout/chrome-badges", () => ({
  useChromeBadges: () => ({
    curadoria: 0,
    recQueue: 0,
    requests: 0,
    settings: 0,
    settingsByGroup: {},
    recalcPending: false,
    comixHealth: "unknown" as const,
    clearRecalcPending: () => {},
  }),
}))

import { ConsoleNav } from "@/components/curadoria/console-nav"

const GROUPS = [
  { id: "calibracao", label: "Calibração das notas", iconName: "Gauge", accent: "violet" as const },
]

function renderAt(path: string) {
  pathname = path
  render(<ConsoleNav settingsGroups={GROUPS} defaultSettingsGroup="calibracao" />)
}

/** Os rótulos das linhas marcadas como página atual, na sidebar. */
function ativos(): string[] {
  return screen
    .getAllByRole("link")
    .filter((el) => el.getAttribute("aria-current") === "page")
    .map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "")
}

afterEach(() => {
  cleanup()
  pathname = "/curation"
})

describe("sidebar da console: exatamente UMA linha ativa por rota", () => {
  it("na raiz, quem acende é a Visão geral", () => {
    renderAt("/curation")
    expect(ativos()).toHaveLength(1)
    expect(ativos()[0]).toMatch(/Visão geral/i)
  })

  // O caso que o aninhamento criou: cada membro é `/curation/...`, então a raiz casaria
  // por prefixo junto com ele.
  it.each([
    ["/curation/works", /Curadoria da Obra/i],
    ["/curation/ai-usage", /Uso da API/i],
    ["/curation/model-metrics", /Métricas do modelo/i],
    ["/curation/requests", /Pedidos/i],
  ])("em %s, a Visão geral NÃO acende junto", (path, esperado) => {
    renderAt(path)
    const marcados = ativos()
    expect(marcados, `mais de uma linha ativa em ${path}: ${marcados.join(" | ")}`).toHaveLength(1)
    expect(marcados[0]).toMatch(esperado)
    expect(marcados[0]).not.toMatch(/Visão geral/i)
  })

  // Sub-rota real: o membro continua aceso abaixo dele próprio — é por isso que o
  // `startsWith` tem que valer pra todo mundo MENOS a raiz, e não sumir de vez.
  it("sub-rota de um membro mantém o membro aceso", () => {
    renderAt("/curation/settings/tag-consolidation")
    const marcados = ativos()
    expect(marcados.some((t) => /Configurações|Calibração/i.test(t))).toBe(true)
    expect(marcados.some((t) => /Visão geral/i.test(t))).toBe(false)
  })
})

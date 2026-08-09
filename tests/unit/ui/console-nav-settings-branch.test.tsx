import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen, fireEvent } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/curadoria",
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

import { ConsoleNav, ConsoleMobileNav } from "@/components/curadoria/console-nav"

const GROUPS = [
  { id: "calibracao", label: "Calibração das notas", iconName: "Gauge", accent: "violet" as const },
  { id: "ia", label: "Gerado por IA", iconName: "Sparkles", accent: "cyan" as const },
]

function renderNav() {
  return render(<ConsoleNav settingsGroups={GROUPS} defaultSettingsGroup="calibracao" />)
}

/**
 * "Configurações" ABRE o ramo; quem navega são os tópicos.
 *
 * Antes, o rótulo era `<Link href="/settings">` e só a seta expandia — dois alvos com
 * destinos diferentes na mesma linha, a 20px um do outro. E o link nem tinha destino
 * próprio: `/settings` sem `?g=` renderiza o tópico default, o mesmo do 1º filho.
 *
 * Teste de RENDER de propósito: o que regride aqui é o ELEMENTO (voltar a ser `<a>`),
 * e uma varredura de source não distingue "o href sumiu" de "o href mudou de lugar".
 */
describe("ramo Configurações da sidebar da console", () => {
  afterEach(cleanup)

  it("o rótulo não é link — clicar nele não navega", () => {
    renderNav()
    const row = screen.getByText("Configurações").closest("a, button")
    expect(row?.tagName).toBe("BUTTON")
    // Com o ramo ABERTO (pior caso pro teste): nenhum `<a href="/settings">` solto —
    // o único caminho pra rota é o tópico, via `?g=`.
    fireEvent.click(row!)
    const settingsLinks = Array.from(document.querySelectorAll("a[href^='/settings']"))
    expect(settingsLinks.map((a) => a.getAttribute("href"))).toEqual([
      "/settings?g=calibracao",
      "/settings?g=ia",
    ])
  })

  it("clicar expande e recolhe os tópicos", () => {
    renderNav()
    const row = screen.getByText("Configurações").closest("button")!
    // Fora de /settings o ramo começa fechado.
    expect(row.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("Gerado por IA")).toBeNull()

    fireEvent.click(row)
    expect(row.getAttribute("aria-expanded")).toBe("true")
    expect(screen.getByText("Gerado por IA")).toBeDefined()

    fireEvent.click(row)
    expect(row.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("Gerado por IA")).toBeNull()
  })
})

/**
 * "Nova obra" é AÇÃO, não o 7º destino da console.
 *
 * A lista responde "onde eu trabalho"; criar obra é "o que eu faço", e é o único
 * caminho daqui que sai da console. Dentro do `<ul>` ele viraria mais um lugar —
 * a régua que já custou caro na barra superior. Por isso o teste não checa só que
 * o link existe: checa que ele está FORA da lista.
 */
describe("atalho de nova obra na console", () => {
  afterEach(cleanup)

  it("o link existe e fica fora da lista de seções", () => {
    renderNav()
    const link = screen.getByRole("link", { name: /Nova obra/ })
    expect(link.getAttribute("href")).toBe("/titles/new")
    expect(link.closest("ul")).toBeNull()
    expect(link.closest("nav")).toBeNull()
  })

  it("no mobile fica ao lado do seletor, nunca dentro dele", () => {
    render(<ConsoleMobileNav settingsGroups={GROUPS} defaultSettingsGroup="calibracao" />)
    const link = screen.getByRole("link", { name: "Nova obra" })
    expect(link.getAttribute("href")).toBe("/titles/new")
    // Uma `<option>` que cria obra faria o seletor mentir sobre o que ele é.
    expect(
      Array.from(document.querySelectorAll("option")).map((o) => o.getAttribute("value")),
    ).not.toContain("/titles/new")
  })
})

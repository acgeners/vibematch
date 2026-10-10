import { describe, it, expect } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { ContentWarningsSummary } from "@/components/titles/content-warnings"
import { Tabs, TabsContent, TabsExtraContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { displayableContentWarnings } from "@/lib/reviews/digest-view"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"

// O tooltip do selo ✨ (dentro do popover) mede o tamanho com ResizeObserver, que o jsdom não traz.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

/**
 * A linha compacta de avisos de conteúdo na Visão Geral (`⚠ 3 avisos de conteúdo · Ver avisos`).
 *
 * Teste de RENDER de propósito: o que regride aqui é a tela — o texto do aviso aparecer antes
 * do clique, a linha imprimir "sem avisos" ou ganhar cara de selo 18+. Um teste da função pura
 * passaria verde em qualquer um dos três.
 */

const AVISOS = [
  "Cena de estupro/agressão sexual no início da relação",
  "Violência/guerra e morte de personagens secundários",
  "Abuso emocional e manipulação",
]

const DIGEST: ReviewDigest = {
  consensus: "casal carismático e mundo bem construído",
  divergence: "o ritmo do meio divide opiniões",
  salient_traits: [{ trait: "protagonista calculista", polarity: "positive", axis: "personagens" }],
  content_warnings: AVISOS,
  execution: "arte sólida",
}

describe("ContentWarningsSummary — linha compacta da Visão Geral", () => {
  it("mostra só a CONTAGEM; o texto dos avisos aparece depois de 'Ver avisos'", () => {
    render(<ContentWarningsSummary warnings={AVISOS} />)
    expect(screen.getByText("3 avisos de conteúdo")).toBeTruthy()
    // ⚠️ Pelo TEXTO da página, não por `queryByText(aviso)`: este casa só elemento cujo texto é
    // exatamente o aviso, e os avisos concatenados numa linha só passavam batido (sonda conferida).
    for (const aviso of AVISOS) expect(document.body.textContent).not.toContain(aviso)

    fireEvent.click(screen.getByRole("button", { name: "Ver avisos" }))
    for (const aviso of AVISOS) expect(screen.getByText(aviso)).toBeTruthy()
    // Separa o conceito na própria tela: aviso de tema sensível ≠ classificação 18+.
    expect(screen.getByText(/Não é a classificação 18\+/)).toBeTruthy()
  })

  it("usa o singular com um aviso só", () => {
    render(<ContentWarningsSummary warnings={[AVISOS[0]]} />)
    expect(screen.getByText("1 aviso de conteúdo")).toBeTruthy()
  })

  it("lista vazia não renderiza NADA — nunca 'sem avisos'", () => {
    const { container } = render(<ContentWarningsSummary warnings={[]} />)
    expect(container.innerHTML).toBe("")
    expect(screen.queryByText(/sem avisos/i)).toBeNull()
  })

  it("não tem a forma do selo 🔞: sem 18+ à vista e sem pílula colorida", () => {
    const { container } = render(<ContentWarningsSummary warnings={AVISOS} />)
    expect(container.textContent).not.toContain("18+")
    expect(container.textContent).not.toContain("🔞")
    // O selo 18+ é uma pílula com fundo/borda vermelhos; a linha não tem fundo nem borda.
    const linha = container.firstElementChild as HTMLElement
    expect(linha.className).not.toMatch(/\bbg-/)
    expect(linha.className).not.toMatch(/\b(border|ring)-/)
  })

  it("leva o selo ✨ de proveniência DENTRO do popover, não na linha", () => {
    render(
      <ContentWarningsSummary
        warnings={AVISOS}
        provenance={{ title: "Avisos resumidos por IA", model: "claude-sonnet-5", at: "2026-10-01T12:00:00Z" }}
      />,
    )
    expect(screen.queryByRole("button", { name: /Avisos resumidos por IA/ })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Ver avisos" }))
    expect(screen.getByRole("button", { name: /Avisos resumidos por IA/ })).toBeTruthy()
  })
})

describe("displayableContentWarnings — a régua compartilhada com o card de reviews", () => {
  it("devolve os avisos de um digest íntegro, na ordem", () => {
    expect(displayableContentWarnings(DIGEST)).toEqual(AVISOS)
  })

  it("sem digest, digest corrompido ou sem consenso ⇒ nada (o card também não os mostra)", () => {
    expect(displayableContentWarnings(null)).toEqual([])
    expect(displayableContentWarnings({ ...DIGEST, divergence: '</parameter><parameter name="x">' })).toEqual([])
    expect(displayableContentWarnings({ ...DIGEST, consensus: "  " })).toEqual([])
  })

  it("descarta entradas vazias", () => {
    expect(displayableContentWarnings({ ...DIGEST, content_warnings: ["", "  ", AVISOS[1]] })).toEqual([AVISOS[1]])
  })
})

describe("TabsExtraContent — o bloco da Visão Geral que a página põe fora do AdultGate", () => {
  /** O mesmo arranjo da página: um conteúdo extra da aba ANTES do painel principal dela. */
  function Pagina({ inicial }: { inicial: string }) {
    return (
      <Tabs defaultValue={inicial}>
        <TabsList>
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="ai">Análise da IA</TabsTrigger>
        </TabsList>
        <TabsExtraContent value="overview">
          <ContentWarningsSummary warnings={AVISOS} />
        </TabsExtraContent>
        <TabsContent value="overview">painel principal</TabsContent>
        <TabsContent value="ai">painel da IA</TabsContent>
      </Tabs>
    )
  }

  it("aparece na Visão Geral e some nas outras abas", () => {
    const { unmount } = render(<Pagina inicial="overview" />)
    expect(screen.getByText("3 avisos de conteúdo")).toBeTruthy()
    unmount()
    render(<Pagina inicial="ai" />)
    expect(screen.queryByText("3 avisos de conteúdo")).toBeNull()
  })

  it("não vira um 2º tabpanel nem repete o id do painel (o aria-controls do gatilho continua único)", () => {
    const { container } = render(<Pagina inicial="overview" />)
    expect(screen.getAllByRole("tabpanel")).toHaveLength(1)
    const linha = screen.getByText("3 avisos de conteúdo").closest("[data-slot='tabs-content']") as HTMLElement
    expect(linha.getAttribute("role")).toBeNull()
    expect(linha.getAttribute("id")).toBeNull()
    expect(linha.getAttribute("tabindex")).toBeNull()
    const gatilho = screen.getByRole("tab", { name: "Visão Geral" })
    const alvo = gatilho.getAttribute("aria-controls")
    expect(container.querySelectorAll(`[id="${alvo}"]`)).toHaveLength(1)
  })
})

import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("@/server/actions/opening-structure", () => ({
  analyzeOpeningStructureAction: vi.fn(),
  analyzeOpeningStructureWebAction: vi.fn(),
  setOpeningStructureOverrideAction: vi.fn(),
}))
vi.mock("@/lib/tasks-store", () => ({ runTask: vi.fn() }))
vi.mock("@/components/tasks/use-app-tasks", () => ({ useAppTasks: () => [] }))
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => async () => true }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => () => {} }))

import { OpeningStructureCard } from "@/components/titles/opening-structure-card"
import type { OpeningStructureRow } from "@/server/queries/opening-structure"

/**
 * O card de estrutura de abertura, em RENDER.
 *
 * De render de propósito. O que regride nesta classe não é o veredito — é o TRATAMENTO dele na
 * tela, e nada disso aparece num teste que leia o objeto:
 *   - a citação sair da tela e virar tooltip (ela é a única prova de que não é palpite)
 *   - "evidência insuficiente" perder a razão impressa (e o 2º botão virar chute do usuário)
 *   - o botão de web reaparecer depois de a web já ter falhado (paga de novo por nada)
 *   - o override não esconder a citação da IA (a tela mostraria prova de um veredito revogado)
 */

const VAZIO: OpeningStructureRow = {
  opening_structure: null,
  opening_structure_auto: null,
  opening_structure_auto_confidence: null,
  opening_structure_auto_evidence: null,
  opening_structure_auto_rationale: null,
  opening_structure_auto_source: null,
  opening_structure_auto_model: null,
  opening_structure_auto_at: null,
  opening_structure_override: null,
}

const CITACAO = "they show us like towards the end of the story and the chapters after is the backstory"

const DECIDIDO: OpeningStructureRow = {
  ...VAZIO,
  opening_structure: "flashforward",
  opening_structure_auto: "flashforward",
  opening_structure_auto_confidence: 0.9,
  opening_structure_auto_evidence: CITACAO,
  opening_structure_auto_rationale: "O capítulo 1 mostra eventos que a narrativa ainda não alcançou.",
  opening_structure_auto_source: "local",
  opening_structure_auto_model: "claude-sonnet-5",
  opening_structure_auto_at: "2026-08-12T12:00:00Z",
}

const SEM_BASE: OpeningStructureRow = {
  ...VAZIO,
  opening_structure: "indeterminado",
  opening_structure_auto: "indeterminado",
  opening_structure_auto_confidence: 0.3,
  opening_structure_auto_rationale:
    "As tags mencionam time-skip-in-first-chapter-prologue, mas nenhuma review indica a ordem dos eventos.",
  opening_structure_auto_source: "local",
  opening_structure_auto_model: "claude-sonnet-5",
  opening_structure_auto_at: "2026-08-12T12:00:00Z",
}

afterEach(cleanup)

const props = { workId: "w1", canOverride: true, canRunAi: true }

describe("nunca analisado", () => {
  it("convida a analisar e mostra o custo antes do clique", () => {
    render(<OpeningStructureCard {...props} row={VAZIO} />)
    expect(screen.getByText("Ainda não analisado")).toBeTruthy()
    expect(screen.getByRole("button", { name: /Analisar abertura/i })).toBeTruthy()
    // O custo na superfície, como no CTA do Deep Dive — quem clica sabe o preço antes do modal.
    expect(screen.getByText(/\$0,016/)).toBeTruthy()
  })

  it("não oferece a busca web antes de a análise local ter rodado", () => {
    render(<OpeningStructureCard {...props} row={VAZIO} />)
    expect(screen.queryByRole("button", { name: /Buscar na web/i })).toBeNull()
  })
})

describe("veredito decidido", () => {
  it("mostra a CITAÇÃO no corpo do card, não escondida", () => {
    render(<OpeningStructureCard {...props} row={DECIDIDO} />)
    // getByText só acha o que está na árvore renderizada — se a citação virar `title=` ou
    // conteúdo de tooltip Radix (que só monta no hover), este teste reprova.
    expect(screen.getByText(new RegExp(CITACAO.slice(0, 40)))).toBeTruthy()
  })

  it("nomeia o veredito em português, não o valor do enum", () => {
    render(<OpeningStructureCard {...props} row={DECIDIDO} />)
    expect(screen.getByText("Começa com flashforward")).toBeTruthy()
  })

  it("desenha o diagrama com rótulo acessível em vez de depender só da forma", () => {
    render(<OpeningStructureCard {...props} row={DECIDIDO} />)
    expect(screen.getByRole("img", { name: /alcança/i })).toBeTruthy()
  })

  it("não oferece a busca web quando já há veredito", () => {
    render(<OpeningStructureCard {...props} row={DECIDIDO} />)
    expect(screen.queryByRole("button", { name: /Buscar na web/i })).toBeNull()
  })
})

describe("evidência insuficiente", () => {
  it("imprime a razão — é ela que justifica o segundo botão existir", () => {
    render(<OpeningStructureCard {...props} row={SEM_BASE} />)
    expect(screen.getByText(/nenhuma review indica a ordem dos eventos/i)).toBeTruthy()
  })

  it("oferece a busca web com o preço e a taxa de resgate à vista", () => {
    render(<OpeningStructureCard {...props} row={SEM_BASE} />)
    expect(screen.getByRole("button", { name: /Buscar na web/i })).toBeTruthy()
    expect(screen.getByText(/\$0,25/)).toBeTruthy()
  })

  it("NÃO reoferece a web quando ela já foi tentada e também não decidiu", () => {
    render(<OpeningStructureCard {...props} row={{ ...SEM_BASE, opening_structure_auto_source: "web" }} />)
    expect(screen.queryByRole("button", { name: /Buscar na web/i })).toBeNull()
    expect(screen.getByText(/também não encontrou/i)).toBeTruthy()
  })

  it("oferece a marcação manual ao curador — com 13 de 19 indeterminados, é o caminho principal", () => {
    render(<OpeningStructureCard {...props} row={SEM_BASE} />)
    expect(screen.getByRole("button", { name: /É flashforward/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /É cronológico/i })).toBeTruthy()
  })

  it("esconde a marcação de quem não cura o catálogo", () => {
    render(<OpeningStructureCard {...props} canOverride={false} row={SEM_BASE} />)
    expect(screen.queryByRole("button", { name: /É flashforward/i })).toBeNull()
  })
})

describe("marcação humana", () => {
  const MARCADO: OpeningStructureRow = { ...SEM_BASE, opening_structure: "flashforward", opening_structure_override: "flashforward" }

  it("o override vence o veredito da IA na tela", () => {
    render(<OpeningStructureCard {...props} row={MARCADO} />)
    expect(screen.getByText("Começa com flashforward")).toBeTruthy()
    expect(screen.queryByText(/Evidência insuficiente/i)).toBeNull()
  })

  it("não mostra citação da IA sob marcação humana — seria prova de um veredito revogado", () => {
    const comCitacaoVelha = { ...MARCADO, opening_structure_auto: "linear" as const, opening_structure_auto_evidence: CITACAO }
    render(<OpeningStructureCard {...props} row={comCitacaoVelha} />)
    expect(screen.queryByText(new RegExp(CITACAO.slice(0, 40)))).toBeNull()
    expect(screen.getByText(/Marcado por você/i)).toBeTruthy()
  })

  it("permite desfazer, devolvendo o veredito da IA", () => {
    render(<OpeningStructureCard {...props} row={MARCADO} />)
    expect(screen.getByRole("button", { name: /Desfazer marcação/i })).toBeTruthy()
  })
})

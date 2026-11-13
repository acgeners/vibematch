import { vi, describe, it, expect } from "vitest"
import { render, screen, within } from "@testing-library/react"

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/components/layout/admin-context", () => ({ useCan: () => true }))
vi.mock("@/components/titles/update-data-dialog", () => ({ UpdateDataDialog: () => null }))
vi.mock("@/lib/tasks-store", () => ({ runTask: vi.fn() }))
vi.mock("@/server/actions/generate-all", () => ({ generateAllWorkData: vi.fn() }))

import { GenerateAllBanner } from "@/components/titles/generate-all-banner"
import { GenerateAllCard } from "@/components/titles/generate-all-card"
import { describeGenerateAll, type GenerateAllPieces, type GenerateAllWorkState } from "@/lib/generate-all/work-pieces"

const ALL: GenerateAllPieces = {
  synopsis: true,
  summary: true,
  digest: true,
  tags: true,
  scores: true,
  interest: true,
  verdict: true,
  embedding: true,
}

function state(over: Partial<GenerateAllPieces> = {}, extra: Partial<GenerateAllWorkState> = {}): GenerateAllWorkState {
  return { pieces: { ...ALL, ...over }, reviewPending: false, usefulReviews: 40, estimatedUsd: 0.13, ...extra }
}

function banner(workState: GenerateAllWorkState | null, initialStatus: "idle" | "verifying_sources" = "idle") {
  return render(
    <GenerateAllBanner compact workId="w1" workTitle="Obra" initialStatus={initialStatus} currentWork={{} as never} workState={workState} />,
  )
}

/**
 * O botão "Gerar tudo" muda de aparência conforme o que a obra já tem, e o cartão do hover
 * diz o que falta. Teste de RENDER: o que regride é a tela, não a régua.
 */
describe("Gerar tudo — botão", () => {
  it("🔴 obra com notas: 'Refazer tudo', sem contorno e sem a caixa de texto do navegador", () => {
    banner(state())
    const b = screen.getByRole("button", { name: /Refazer tudo/ })
    expect(b.getAttribute("data-variant")).toBe("ghost")
    expect(b.getAttribute("title")).toBeNull()
  })

  it("🔴 obra sem notas: 'Gerar tudo', com contorno, como sempre", () => {
    banner(state({ scores: false, interest: false, verdict: false }))
    const b = screen.getByRole("button", { name: /Gerar tudo/ })
    expect(b.getAttribute("data-variant")).toBe("outline")
  })

  it("com a cascata andando, o botão diz o estado dela, mesmo numa obra com notas", () => {
    banner(state(), "verifying_sources")
    expect(screen.getByRole("button", { name: /Verificando/ }).getAttribute("data-variant")).toBe("outline")
  })

  it("sem os dados da obra, fica como era (o texto do navegador continua)", () => {
    banner(null)
    const b = screen.getByRole("button", { name: /Gerar tudo/ })
    expect(b.getAttribute("title")).toMatch(/Escolha fontes e capas/)
  })
})

describe("Gerar tudo — cartão", () => {
  it("🔴 lista o que a obra tem e o botão de cada peça que falta", () => {
    render(<GenerateAllCard view={describeGenerateAll(state({ interest: false, verdict: false }))} />)
    expect(screen.getByText("6 de 8 prontas")).toBeTruthy()
    const lista = screen.getByRole("list", { name: /Etapas do Gerar tudo/ })
    expect(within(lista).getAllByText("falta")).toHaveLength(2)
    expect(screen.getByText(/seriam refeitas sem revisão/)).toBeTruthy()
    expect(screen.getByText(/“Prever interesse” no card Sinopses/)).toBeTruthy()
    expect(screen.getByText(/“Calcular” no Veredito IA/)).toBeTruthy()
    expect(screen.getByText("$0,13", { exact: false })).toBeTruthy()
  })

  it("obra completa sugere reavaliar só as notas", () => {
    render(<GenerateAllCard view={describeGenerateAll(state())} />)
    expect(screen.getByText("8 de 8 prontas")).toBeTruthy()
    expect(screen.getByText(/já tem tudo/)).toBeTruthy()
    expect(screen.getByText(/Reavaliar com IA/)).toBeTruthy()
  })

  it("🔴 avaliação esperando revisão: avisa que refazer a descartaria", () => {
    render(<GenerateAllCard view={describeGenerateAll(state({ verdict: false }, { reviewPending: true, usefulReviews: 9 }))} />)
    expect(screen.getByText("esperando revisão")).toBeTruthy()
    expect(screen.getByText(/refazer a descartaria/)).toBeTruthy()
  })

  it("🔴 sem notas e com poucas reviews: é o caso, mas diz para esperar", () => {
    render(
      <GenerateAllCard
        view={describeGenerateAll(state({ scores: false, digest: false, tags: false, interest: false, verdict: false }, { usefulReviews: 1 }))}
      />,
    )
    expect(screen.getByText("Gerar tudo")).toBeTruthy()
    expect(screen.getByText(/1 review útil/)).toBeTruthy()
    expect(screen.getByText("mínimo 4")).toBeTruthy()
    expect(screen.getByText(/Prontas para avaliar/)).toBeTruthy()
    expect(screen.queryByText("Indicado aqui")).toBeNull()
  })

  it("sem notas e com reviews suficientes: 'Indicado aqui'", () => {
    render(<GenerateAllCard view={describeGenerateAll(state({ scores: false }, { usefulReviews: 12 }))} />)
    expect(screen.getByText("Indicado aqui")).toBeTruthy()
    expect(screen.queryByText("mínimo 4")).toBeNull()
  })
})

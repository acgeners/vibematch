import { vi, describe, it, expect } from "vitest"

// "use server" / server-only não rodam no ambiente de teste — mocka o módulo da action.
vi.mock("server-only", () => ({}))
vi.mock("@/server/actions/review-digest", () => ({ generateWorkReviewDigest: vi.fn() }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
// O card chama useCostConfirm(), que exige o <CostConfirmProvider> acima na árvore.
// Aqui só interessa o render, então o confirm sempre aprova.
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => vi.fn(async () => true) }))

import { render, screen } from "@testing-library/react"
import { WorkReviewsCard } from "@/components/titles/work-reviews-card"
import type { WorkReviewsSnapshot } from "@/server/queries/work-reviews"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"

const ISO = "2026-06-27T00:00:00.000Z"
const base: WorkReviewsSnapshot = {
  fetchedAt: ISO, total: 5, bySource: [], manual: [],
  summary: "Resumo das reviews aqui.", summaryAt: ISO,
  digest: null, digestAt: null, digestN: null, digestVersion: null,
}
const DIGEST: ReviewDigest = {
  consensus: "casal carismatico e mundo bem construido",
  divergence: "o ritmo do meio divide opinioes",
  salient_traits: [
    { trait: "protagonista calculista", polarity: "positive", axis: "personagens" },
    { trait: "vilao raso", polarity: "negative", axis: "personagens" },
  ],
  content_warnings: ["violencia grafica"],
  execution: "arte solida e consistente",
}

describe("WorkReviewsCard — digest na aba Notas & Avaliações", () => {
  it("renderiza o digest + traços agrupados por polaridade + botão Regerar", () => {
    render(<WorkReviewsCard workId="w1" snapshot={{ ...base, digest: DIGEST, digestN: 12, digestAt: ISO }} />)
    expect(screen.getByText("O que dizem as reviews")).toBeTruthy()
    expect(screen.getByText(/casal carismatico/)).toBeTruthy()
    expect(screen.getByText(/o ritmo do meio divide/)).toBeTruthy()
    expect(screen.getByText("protagonista calculista")).toBeTruthy()
    expect(screen.getByText("vilao raso")).toBeTruthy()
    expect(screen.getByText(/arte solida/)).toBeTruthy()
    expect(screen.getByText(/violencia grafica/)).toBeTruthy()
    expect(screen.getByText("Regerar")).toBeTruthy()
    // DIGEST tem 1 traço positivo + 1 negativo, nenhum misto: só essas duas seções saem.
    expect(screen.getByText("Positivo")).toBeTruthy()
    expect(screen.getByText("Negativo")).toBeTruthy()
    expect(screen.queryByText("Misto")).toBeNull()
  })

  it("agrupa os traços na ordem positivo → misto → negativo", () => {
    const mixedDigest: ReviewDigest = {
      ...DIGEST,
      salient_traits: [
        { trait: "vilao raso", polarity: "negative", axis: "personagens" },
        { trait: "ritmo divide", polarity: "mixed", axis: "ritmo" },
        { trait: "protagonista calculista", polarity: "positive", axis: "personagens" },
      ],
    }
    render(<WorkReviewsCard workId="w1" snapshot={{ ...base, digest: mixedDigest, digestAt: ISO }} />)
    const labels = screen.getAllByText(/^(Positivo|Misto|Negativo)$/).map((el) => el.textContent)
    expect(labels).toEqual(["Positivo", "Misto", "Negativo"])
  })

  it("mostra o CTA de síntese quando NÃO há digest mas há reviews", () => {
    render(<WorkReviewsCard workId="w1" snapshot={{ ...base, total: 3, digest: null }} />)
    expect(screen.getByText("Destilar")).toBeTruthy()
    expect(screen.getByText("O que dizem as reviews")).toBeTruthy()
  })

  it("não mostra botão de digest quando não há nenhuma review", () => {
    render(<WorkReviewsCard workId="w1" snapshot={{ ...base, total: 0, manual: [], digest: null, summary: null }} />)
    expect(screen.queryByText("Gerar digest")).toBeNull()
    expect(screen.queryByText("Regerar")).toBeNull()
  })

  // Linhas gravadas antes da blindagem carregam o tool-call mal-serializado no
  // texto. Renderizar isso mostrava JSON cru na página da obra.
  it("não renderiza o markup vazado de um digest corrompido — oferece regerar", () => {
    const corrupted: ReviewDigest = {
      ...DIGEST,
      divergence:
        'uns acham a FL ingenua </divergence> <parameter name="salient_traits">[{"trait": "protagonista passiva", "polarity": "negative", "axis": "moralidade"}]',
      salient_traits: [],
    }
    render(<WorkReviewsCard workId="w1" snapshot={{ ...base, digest: corrupted, digestN: 42, digestAt: ISO }} />)
    expect(screen.queryByText(/parameter name/)).toBeNull()
    expect(screen.queryByText(/salient_traits/)).toBeNull()
    expect(screen.getByText(/resposta corrompida/i)).toBeTruthy()
    // o botão continua disponível (o texto "Regerar" também aparece no aviso)
    expect(screen.getByRole("button", { name: /Regerar/ })).toBeTruthy()
  })
})

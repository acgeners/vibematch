import { vi, describe, it, expect } from "vitest"

// "use server" / server-only não rodam no ambiente de teste — mocka o módulo da action.
vi.mock("server-only", () => ({}))
vi.mock("@/server/actions/review-digest", () => ({ generateWorkReviewDigest: vi.fn() }))
// O card agora importa o RefetchReviewsButton, que puxa estas actions "use server".
vi.mock("@/server/actions/reviews", () => ({ refetchWorkReviews: vi.fn() }))
vi.mock("@/server/actions/update-status", () => ({ getWorkUpdateStatus: vi.fn() }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
// O card chama useCostConfirm(), que exige o <CostConfirmProvider> acima na árvore.
// Aqui só interessa o render, então o confirm sempre aprova.
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => vi.fn(async () => true) }))

import { render, screen, fireEvent, within } from "@testing-library/react"
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

/** Digest com 3 eixos distintos, para exercitar a régua e o painel. */
const MULTI: ReviewDigest = {
  ...DIGEST,
  salient_traits: [
    { trait: "protagonista calculista", polarity: "positive", axis: "personagens" },
    { trait: "vilao raso", polarity: "negative", axis: "personagens" },
    { trait: "arte cai depois da troca de artista", polarity: "negative", axis: "arte" },
    { trait: "premissa incomum pro genero", polarity: "positive", axis: "originalidade" },
  ],
}

describe("WorkReviewsCard — digest na aba Notas & Avaliações", () => {
  it("renderiza consenso, divergência, avisos e a régua de eixos", () => {
    render(<WorkReviewsCard workId="w1" snapshot={{ ...base, digest: DIGEST, digestN: 12, digestAt: ISO }} />)
    expect(screen.getByText("O que dizem as reviews")).toBeTruthy()
    expect(screen.getByText(/casal carismatico/)).toBeTruthy()
    expect(screen.getByText(/o ritmo do meio divide/)).toBeTruthy()
    expect(screen.getByText(/violencia grafica/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Regerar síntese" })).toBeTruthy()
  })

  // 🔴 O `axis` sempre existiu no dado e vivia só no atributo `title=` do chip — invisível.
  // Este teste é de RENDER de propósito: um teste que lesse o objeto passaria mesmo com o
  // eixo fora da tela, que era exatamente o estado anterior.
  it("mostra o EIXO de cada traço na tela, não só no title", () => {
    render(<WorkReviewsCard workId="w1" snapshot={{ ...base, digest: MULTI, digestAt: ISO }} />)
    const ruler = screen.getByRole("tablist", { name: /eixos citados/i })
    const labels = within(ruler).getAllByRole("tab").map((t) => t.textContent)
    // Ordenado do que mais agrada ao que mais incomoda: originalidade (+1) → personagens
    // (0, dividido) → arte (−1).
    expect(labels[0]).toContain("Originalidade")
    expect(labels[1]).toContain("Personagens")
    expect(labels[2]).toContain("Arte")
    expect(labels[0]).toContain("elogiado")
    expect(labels[1]).toContain("dividido")
    expect(labels[2]).toContain("criticado")
  })

  // O painel nasce no eixo MAIS CITADO — abrir no primeiro da régua deixaria a caixa com
  // uma frase e um vão embaixo, que é o problema que este desenho veio resolver.
  it("abre o painel no eixo mais citado e troca ao clicar em outro", () => {
    render(<WorkReviewsCard workId="w1" snapshot={{ ...base, digest: MULTI, digestAt: ISO }} />)
    const panel = screen.getByRole("tabpanel")
    // personagens tem 2 traços; os outros, 1.
    expect(within(panel).getByText("protagonista calculista")).toBeTruthy()
    expect(within(panel).getByText("vilao raso")).toBeTruthy()
    expect(within(panel).queryByText("premissa incomum pro genero")).toBeNull()

    fireEvent.click(screen.getByRole("tab", { name: /Originalidade/ }))
    expect(within(screen.getByRole("tabpanel")).getByText("premissa incomum pro genero")).toBeTruthy()
    expect(within(screen.getByRole("tabpanel")).queryByText("vilao raso")).toBeNull()
  })

  // O texto do traço mora no painel, NUNCA na linha da régua: inline ele empurra a régua e
  // a altura do card passa a mudar a cada clique (o motivo de o painel existir).
  it("não escreve o texto do traço dentro da régua", () => {
    render(<WorkReviewsCard workId="w1" snapshot={{ ...base, digest: MULTI, digestAt: ISO }} />)
    const ruler = screen.getByRole("tablist", { name: /eixos citados/i })
    expect(within(ruler).queryByText("protagonista calculista")).toBeNull()
    expect(within(ruler).queryByText(/arte cai depois/)).toBeNull()
  })

  // "Execução" repetia em prosa o que os eixos arte/ritmo já dizem (294 caracteres de
  // mediana): saiu do corpo e virou gaveta.
  it("guarda a execução numa gaveta do rodapé", () => {
    render(<WorkReviewsCard workId="w1" snapshot={{ ...base, digest: DIGEST, digestAt: ISO }} />)
    expect(screen.queryByText(/arte solida/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: /Sobre a execução/ }))
    expect(screen.getByText(/arte solida/)).toBeTruthy()
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

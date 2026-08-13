import { vi, describe, it, expect, afterEach } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/server/actions/review-digest", () => ({ generateWorkReviewDigest: vi.fn() }))
vi.mock("@/server/actions/reviews", () => ({ refetchWorkReviews: vi.fn() }))
vi.mock("@/server/actions/update-status", () => ({ getWorkUpdateStatus: vi.fn() }))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => vi.fn() }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => vi.fn(async () => true) }))

import { render, screen, cleanup, within } from "@testing-library/react"
import { WorkReviewsCard } from "@/components/titles/work-reviews-card"
import type { WorkReviewsSnapshot } from "@/server/queries/work-reviews"
import type { ReviewDigest } from "@/lib/ai-recommendation/types"

/**
 * O card "O que dizem as reviews" adapta o layout ao que a obra TEM (2026-08-12).
 *
 * Antes, duas linhas fixas: [texto | coluna de 292px] em cima e [régua | painel do eixo]
 * embaixo. Medido nas 852 obras com síntese do clone local, a coluna de 292px vinha
 * VAZIA em 81 (9,5%) e carregava um único bloco de ~130px em outras 459 (53,9%) — o vão
 * era o caso comum, não a exceção. Embaixo era pior e estrutural: 91% das obras têm 5 a 7
 * eixos (régua de 190–260px) contra 2,2 traços no eixo mais citado (painel de ~110px).
 *
 * Teste de RENDER de propósito: o que regride aqui é a ÁRVORE — quem é irmão de quem e
 * quantas colunas o grid tem. Um teste sobre o objeto do digest passaria verde com a
 * coluna vazia de volta na tela.
 */

const ISO = "2026-06-27T00:00:00.000Z"

const DIGEST: ReviewDigest = {
  consensus: "consenso da obra",
  divergence: "onde as opinioes racham",
  salient_traits: [
    { trait: "protagonista calculista", polarity: "positive", axis: "personagens" },
    { trait: "vilao raso", polarity: "negative", axis: "personagens" },
    { trait: "arte cai depois", polarity: "negative", axis: "arte" },
    { trait: "premissa incomum", polarity: "positive", axis: "originalidade" },
  ],
  content_warnings: ["violencia grafica", "abuso psicologico"],
  execution: "arte solida",
}

/** Reviews COM nota de leitor — é o que faz o histograma existir (mínimo 5). */
function comNotas(n: number) {
  return [
    {
      source: "mangaupdates",
      reviews: Array.from({ length: n }, (_, i) => ({
        id: `r${i}`,
        text: "review com nota",
        textLength: 120,
        matchScore: 0.9,
        sourceTitle: null,
        userRating: 6 + (i % 4),
      })),
    },
  ] as WorkReviewsSnapshot["bySource"]
}

function snapshot(over: Partial<WorkReviewsSnapshot> = {}): WorkReviewsSnapshot {
  return {
    fetchedAt: ISO,
    total: 12,
    bySource: [],
    manual: [],
    summary: "resumo em prosa",
    summaryAt: ISO,
    digest: DIGEST,
    digestAt: ISO,
    digestN: 12,
    digestVersion: "digest-v1",
    ...over,
  }
}

/** O grid do topo — identificado pelo rótulo da seção que ele contém. */
function gridDoTopo(container: HTMLElement): HTMLElement {
  const label = within(container).getByText("O que quase todos dizem")
  // rótulo → <div> do bloco → coluna (ou o próprio item, sob `contents`) → grid
  let el: HTMLElement | null = label.parentElement
  while (el && !el.className.includes("grid")) el = el.parentElement
  if (!el) throw new Error("grid do topo não encontrado")
  return el
}

afterEach(cleanup)

describe("digest: o layout segue o dado", () => {
  it("sem notas de leitor, NÃO reserva a coluna de 292px", () => {
    // Era o pior caso: 292px fixos ao lado de um texto espremido em 1fr, com nada
    // dentro. Sem histograma, consenso e divergência dividem a largura.
    const { container } = render(<WorkReviewsCard workId="w1" snapshot={snapshot()} />)
    const grid = gridDoTopo(container)
    expect(grid.className).not.toContain("292px")
    expect(grid.className).toContain("grid-cols-2")
  })

  it("com notas de leitor, a coluna volta — e o histograma é quem a sustenta", () => {
    const { container } = render(
      <WorkReviewsCard workId="w1" snapshot={snapshot({ bySource: comNotas(8) })} />,
    )
    expect(gridDoTopo(container).className).toContain("292px")
    expect(screen.getByText(/8 notas de leitor/)).toBeTruthy()
  })

  it("os avisos de conteúdo descem pro lado da régua, e não flutuam sozinhos em cima", () => {
    // É o vão que sobrava de verdade: a régua tem 5–7 linhas e o painel do eixo, 2 traços.
    const { container } = render(<WorkReviewsCard workId="w1" snapshot={snapshot()} />)
    const avisos = screen.getByText(/2 avisos de conteúdo/).closest("div.flex-col")!
    const painel = screen.getByRole("tabpanel")
    // Mesma coluna: o painel do eixo e os avisos são irmãos.
    expect(avisos.parentElement).toBe(painel.parentElement)
    expect(gridDoTopo(container).contains(avisos)).toBe(false)
  })

  it("com histograma, os avisos ficam NO TOPO — o vão maior muda de lugar", () => {
    // Medido no app: com o gráfico ocupando 250px ao lado de um consenso longo, o vão do
    // topo passa dos 500px enquanto embaixo a régua e o painel quase empatam. Descer os
    // avisos nesse caso troca um vão médio por um enorme.
    const { container } = render(
      <WorkReviewsCard workId="w1" snapshot={snapshot({ bySource: comNotas(8) })} />,
    )
    const avisos = screen.getByText(/2 avisos de conteúdo/).closest("div.flex-col")!
    expect(gridDoTopo(container).contains(avisos)).toBe(true)
    expect(screen.getByRole("tabpanel").parentElement!.contains(avisos)).toBe(false)
  })

  it("sem régua de eixos, os avisos continuam na tela", () => {
    // 8 obras não têm traço nenhum. Sem o fallback, o bloco sumiria em silêncio junto
    // com a régua que passou a hospedá-lo.
    render(
      <WorkReviewsCard
        workId="w1"
        snapshot={snapshot({ digest: { ...DIGEST, salient_traits: [] } })}
      />,
    )
    expect(screen.getByText(/2 avisos de conteúdo/)).toBeTruthy()
    expect(screen.queryByRole("tabpanel")).toBeNull()
  })

  it("o painel do eixo não estica pra acompanhar a régua", () => {
    // `items-stretch` fazia a caixa crescer até a altura da régua e o texto ficava
    // boiando num retângulo alto e vazio. Quem define a altura da linha é a régua.
    const { container } = render(<WorkReviewsCard workId="w1" snapshot={snapshot()} />)
    const grid = screen.getByRole("tablist").parentElement!
    expect(grid.className).toContain("items-start")
    expect(grid.className).not.toContain("items-stretch")
    // E a régua continua sem o texto do traço dentro dela.
    expect(within(container.querySelector('[role="tablist"]')!).queryByText("vilao raso")).toBeNull()
  })
})

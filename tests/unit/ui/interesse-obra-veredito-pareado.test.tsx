import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => () => {} }))
vi.mock("@/components/cost/cost-confirm", () => ({ useCostConfirm: () => async () => true }))
vi.mock("@/components/titles/predict-interest-toast", () => ({ predictInterestWithToast: vi.fn() }))
vi.mock("@/server/actions/synopsis-quality", () => ({
  applySynopsisPredictionAction: vi.fn(async () => ({ error: null })),
  setSynopsisQualityAction: vi.fn(async () => ({ error: null })),
}))

import { SynopsisQualitySuggestion } from "@/components/titles/synopsis-quality-suggestion"
import type { SynopsisQuality } from "@/types/domain"

/**
 * O bloco "Interesse na Obra" da página da obra emparelha a SUGESTÃO da IA com o
 * valor MANUAL que aplicar sobrescreve.
 *
 * Teste de RENDER de propósito. O que regride nesta classe não é cálculo, é ESCOPO
 * de tela, e são DUAS regressões distintas:
 *
 *  1. **Aplicar cego** — a 1ª versão mostrava só a sugestão, e aplicar gravava por
 *     cima do ♥ que mora na faixa de stats no TOPO da página: dava pra BAIXAR o
 *     próprio interesse (♥♥♥ → ♥♥) sem ver o que estava sendo trocado.
 *  2. **Repetição** — a 2ª versão dizia "desatualizado" em três lugares (chip, faixa
 *     âmbar com a data, e a data de novo no rodapé) e tinha duas portas pra mesma
 *     ação. Nada quebra quando isso volta; a tela só fica ilegível.
 */

const JUST =
  "A sinopse acerta várias loved_tags do perfil, mas o digest derruba o conjunto: pacing ruim e buracos de roteiro."

const PRED = {
  predictedQuality: "♥♥" as SynopsisQuality,
  justification: JUST,
  confidence: 0.78,
  stale: false,
  predictedAt: "2026-07-12T10:00:00Z",
  modelName: "claude-sonnet-4-6",
}

function renderBlock(over: Partial<Parameters<typeof SynopsisQualitySuggestion>[0]> = {}) {
  return render(
    <SynopsisQualitySuggestion
      workId="w1"
      manualValue={"♥♥♥" as SynopsisQuality}
      canEditManual
      hasCanonicalSynopsis
      prediction={PRED}
      {...over}
    />,
  )
}

afterEach(cleanup)

describe("Interesse na Obra: veredito pareado", () => {
  it("a seta entre os cards É o botão de aplicar, e diz a TRANSIÇÃO", () => {
    renderBlock()
    // Baixar de ♥♥♥ pra ♥♥ é uma perda; o rótulo tem que dizer isso antes do clique.
    expect(screen.getByRole("button", { name: /Aplicar ao meu interesse \(♥♥♥ → ♥♥\)/ })).toBeTruthy()
  })

  it("desenha o valor MANUAL dentro do bloco, ao lado da sugestão", () => {
    renderBlock()
    expect(screen.getByText(/Seu interesse/i)).toBeTruthy()
    expect(screen.getByText(/A IA sugere/i)).toBeTruthy()
    // Editável: os 4 corações do picker viram botões com o nível no aria-label.
    expect(screen.getByRole("button", { name: /Interesse ♥♥♥ \(Boa\)/ })).toBeTruthy()
  })

  it("sugestão e valor manual NÃO usam a mesma cor", () => {
    const { container } = renderBlock()
    // laranja = previsão da IA (mesma do /ranking); vermelho/rosa = o seu ♥.
    expect(container.querySelector(".text-orange-500")).toBeTruthy()
    expect(container.querySelector(".fill-rose-500, .text-red-500")).toBeTruthy()
  })

  it("os corações dos DOIS lados são o mesmo desenho e o mesmo tamanho", () => {
    const { container } = renderBlock()
    const iaCard = screen.getByText(/A IA sugere/i).closest("div")!
    const meuCard = screen.getByText(/Seu interesse/i).closest("div")!

    // Escala cheia de 4 dos dois lados, sempre em SVG do lucide — o lado da IA usava
    // o glifo ♥ (fonte, bem menor) contra os ícones clicáveis do picker: no mesmo
    // bloco, a diferença de tamanho lia como "um é mais importante que o outro".
    const iaHearts = iaCard.querySelectorAll('svg[class*="orange"]')
    const meusHearts = meuCard.querySelectorAll('svg[class*="rose"]')
    expect(iaHearts).toHaveLength(4)
    expect(meusHearts).toHaveLength(4)
    for (const h of [...iaHearts, ...meusHearts]) {
      expect(h.getAttribute("class")).toMatch(/h-4 w-4/)
    }

    // E nenhum ♥ sobrou como TEXTO dentro dos cards de valor (o "clique nos ♥" da
    // legenda é frase, não escala — por isso a âncora é "elemento só de corações").
    const glifos = [...container.querySelectorAll("span")].filter(
      (el) => el.children.length === 0 && /^[♥\s]+$/.test(el.textContent ?? ""),
    )
    expect(glifos).toHaveLength(0)
  })

  it("sem previsão, aplicar fica desabilitado", () => {
    renderBlock({ prediction: null })
    const apply = screen.getByRole("button", { name: /Sem previsão para aplicar/ }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
  })

  it("quando a sugestão já é o seu valor, aplicar sai de cena", () => {
    renderBlock({ manualValue: "♥♥" as SynopsisQuality })
    const apply = screen.getByRole("button", { name: /Aplicado/ }) as HTMLButtonElement
    expect(apply.disabled).toBe(true)
    expect(screen.getByText(/^aplicado$/i)).toBeTruthy()
  })

  it("há UMA porta pra aplicar — nunca botão e seta ao mesmo tempo", () => {
    renderBlock()
    const portas = screen
      .getAllByRole("button")
      .filter((b) => /aplicar/i.test(b.getAttribute("aria-label") ?? b.textContent ?? ""))
    expect(portas).toHaveLength(1)
  })

  it("desatualizada: a data aparece UMA vez, e 'Prever de novo' ocupa o topo", () => {
    const { container } = renderBlock({ prediction: { ...PRED, stale: true } })
    const texto = container.textContent ?? ""
    expect(texto.match(/12\/07\/2026/g) ?? []).toHaveLength(1)
    expect(texto).toMatch(/desatualizada/i)
    expect(screen.getByRole("button", { name: /Prever de novo/ })).toBeTruthy()
  })

  it("a justificativa começa FECHADA, mas está no DOM", () => {
    const { container } = renderBlock()
    const details = container.querySelector("details")
    expect(details).toBeTruthy()
    expect(details?.hasAttribute("open")).toBe(false)
    expect(screen.getByText(new RegExp(JUST.slice(0, 30)))).toBeTruthy()
    expect(screen.getByText(/Por que Regular\?/)).toBeTruthy()
  })

  it("sem permissão de escrita, o ♥ manual é só leitura", () => {
    renderBlock({ canEditManual: false })
    expect(screen.queryByRole("button", { name: /Interesse ♥♥♥ \(Boa\)/ })).toBeNull()
    expect(screen.getByText(/entre pra editar/i)).toBeTruthy()
  })
})

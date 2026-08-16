import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { DecisionBreakdownPanel } from "@/components/titles/decision-breakdown-panel"
import { buildDecisionBreakdown } from "@/lib/calculations/decision-breakdown"

/**
 * Teste de RENDER de propósito: o que regride aqui é o painel deixar de IMPRIMIR
 * um sinal, ou imprimir um peso que não houve. Um teste que lesse o objeto do
 * breakdown passaria verde com o número fora da tela.
 *
 * ⚠️ O painel é o CORPO do tooltip, montado direto — `TooltipContent` do Radix não
 * abre no jsdom ([[gotcha-radix-tooltip-nao-abre-no-jsdom]]).
 */

const COM_VEREDITO = buildDecisionBreakdown({
  expected: 8.5,
  alignment: 62,
  alignmentConfidence: 0.6,
  personalFitPercentile: 72,
  interestManual: "♥♥♥",
  interestPredicted: null,
  platformAvg: 7.9063,
  totalVotes: 1036,
  attributesScored: 9,
  attributesTotal: 9,
  weightsAuto: true,
  // Régua do catálogo (migration 193): sem ela o veredito não ajusta, e este
  // fixture deixaria de exercitar justamente a linha do peso.
  verdictScale: { mean: 54.2, sd: 17.8, expectedSd: 0.9 },
})

const SEM_VEREDITO = buildDecisionBreakdown({
  expected: 7.2,
  alignment: null,
  alignmentConfidence: null,
  personalFitPercentile: 40,
  interestManual: null,
  interestPredicted: "♥♥",
  platformAvg: 7.8,
  totalVotes: 41,
  attributesScored: 9,
  attributesTotal: 9,
  weightsAuto: false,
})

describe("o painel imprime a composição da Prioridade", () => {
  it("mostra o total, a âncora e o veredito com o peso", () => {
    render(<DecisionBreakdownPanel breakdown={COM_VEREDITO} />)
    // 8,58: a âncora 8,5 SUBIU com um veredito de 62 — que está acima da média do
    // catálogo (54,2). Na fórmula antiga o mesmo 62 virava "6,2" e DERRUBAVA a nota
    // para 8,0, que é o defeito medido em 2026-08-16.
    expect(screen.getByText(/Prioridade 8,6/)).toBeTruthy()
    // "Nota Prevista" aparece em dois lugares (a âncora e a frase dos 4 sinais) —
    // este caso é sobre a LINHA da âncora.
    expect(screen.getByText("Nota Prevista (âncora)")).toBeTruthy()
    expect(screen.getByText("8,5")).toBeTruthy()
    expect(screen.getByText("62/100")).toBeTruthy()
    // 0,35 × 0,6 = 21% — o peso que o cálculo aplicou, não um número escrito na tela.
    expect(screen.getByText(/peso 21%/)).toBeTruthy()
  })

  it("imprime os CINCO sinais que já entram na Prevista, com os valores da obra", () => {
    render(<DecisionBreakdownPanel breakdown={COM_VEREDITO} />)
    for (const rotulo of ["Atributos de IA", "Alinhamento", "Interesse", "Média externa", "Votos"]) {
      expect(screen.getByText(rotulo), `sumiu da tela: ${rotulo}`).toBeTruthy()
    }
    expect(screen.getByText("72%")).toBeTruthy()
    expect(screen.getByText("♥♥♥ (seu)")).toBeTruthy()
    expect(screen.getByText("7,9")).toBeTruthy()
    expect(screen.getByText("1.036")).toBeTruthy()
    expect(screen.getByText("9 de 9")).toBeTruthy()
  })

  /** A ênfase em vigor é a resposta a "vocês consideram o que eu escolhi?" — e a
   *  frase precisa dizer que a declaração NÃO está valendo quando é automática. */
  it("imprime qual ênfase dos atributos está em vigor", () => {
    const { unmount } = render(<DecisionBreakdownPanel breakdown={COM_VEREDITO} />)
    expect(screen.getByText(/Ênfase dos atributos: automática/)).toBeTruthy()
    expect(screen.getByText(/não a de \/preferencias/)).toBeTruthy()
    unmount()
    render(<DecisionBreakdownPanel breakdown={SEM_VEREDITO} />)
    expect(screen.getByText(/Ênfase dos atributos: a sua/)).toBeTruthy()
  })

  /**
   * A frase que impede a leitura errada ("então a Prioridade ignora esses números").
   * É medida: somar os 7 dá rho 0,626 contra 0,643 da Prevista sozinha (210
   * rotuladas, ridge 5-fold OOF, 2026-08-15).
   *
   * 🔴 Ela tem que dizer **"não melhora"**, nunca "piora": o Δrho é −0,017 com IC95%
   * [−0,050, +0,015], que cruza zero. A 1ª versão desta tela afirmava "ordena pior
   * que a Prevista sozinha" — inferência além da medição, e na superfície que a
   * pessoa lê. Este caso trava as duas pontas.
   */
  it("diz que os quatro NÃO são somados de novo — e não afirma que somar PIORA", () => {
    render(<DecisionBreakdownPanel breakdown={COM_VEREDITO} />)
    expect(screen.getByText(/Não são somados de novo/)).toBeTruthy()
    expect(screen.getByText(/não melhora a ordem/)).toBeTruthy()
    expect(
      screen.queryByText(/ordena pior|piora/i),
      "a tela afirma piora, e a medição só sustenta ausência de ganho",
    ).toBeNull()
  })

  it("sem Veredito, NÃO imprime peso nenhum e diz que a Prioridade é a Prevista", () => {
    render(<DecisionBreakdownPanel breakdown={SEM_VEREDITO} />)
    expect(screen.queryByText(/peso \d+%/), "peso afirmado sem veredito que o justifique").toBeNull()
    expect(screen.getByText(/Sem Veredito IA/)).toBeTruthy()
    expect(screen.getByText(/Prioridade 7,2/)).toBeTruthy()
  })

  it("o Interesse previsto aparece marcado como previsto", () => {
    render(<DecisionBreakdownPanel breakdown={SEM_VEREDITO} />)
    expect(screen.getByText("♥♥ (previsto)")).toBeTruthy()
  })

  it("sem Nota Prevista, explica a ausência em vez de mostrar um número", () => {
    render(
      <DecisionBreakdownPanel
        breakdown={buildDecisionBreakdown({
          expected: null,
          alignment: 90,
          alignmentConfidence: 1,
          personalFitPercentile: null,
          interestManual: null,
          interestPredicted: null,
          platformAvg: null,
          totalVotes: null,
          attributesScored: 0,
          attributesTotal: 9,
          weightsAuto: true,
        })}
      />,
    )
    expect(screen.getByText("Sem Prioridade")).toBeTruthy()
    expect(screen.getByText(/depende da Nota Prevista/)).toBeTruthy()
  })
})

/**
 * 🔴 Capacidade construída e DESLIGADA é pior que ausente — foi o que aconteceu com
 * o fallback do `CoverImage` (34 de 36 telas passavam `url`). Este caso garante que
 * a linha "Prioridade" do comparador de fato monta o painel.
 */
describe("o comparador liga o painel na linha Prioridade", () => {
  const SRC = readFileSync(
    resolve(process.cwd(), "components/titles/work-compare-drawer.tsx"),
    "utf8",
  )

  /**
   * ⚠️ `key: "score:decision"` aparece DUAS vezes: uma no catálogo de linhas
   * configuráveis (só key + label) e outra na definição que a tabela desenha. A que
   * importa é a que traz `get:` — pegar a primeira testava a lista errada e passava
   * verde com o painel desligado.
   */
  function blocoDaLinhaPrioridade(): string {
    let at = -1
    for (let i = SRC.indexOf('key: "score:decision"'); i !== -1; i = SRC.indexOf('key: "score:decision"', i + 1)) {
      const fim = SRC.indexOf('key: "score:', i + 20)
      const trecho = SRC.slice(i, fim === -1 ? i + 2500 : fim)
      if (/\bget:\s*\(/.test(trecho)) {
        at = i
        break
      }
    }
    expect(at, "a definição da linha Prioridade (a que tem `get:`) sumiu do comparador").toBeGreaterThan(-1)
    const fim = SRC.indexOf('key: "score:', at + 20)
    return SRC.slice(at, fim === -1 ? at + 2500 : fim)
  }

  it("a linha score:decision tem wrapScore montando o DecisionBreakdownPanel", () => {
    const bloco = blocoDaLinhaPrioridade()
    expect(bloco).toContain("wrapScore")
    expect(bloco).toContain("DecisionBreakdownPanel")
    expect(bloco).toContain("buildDecisionBreakdown")
  })

  it("passa os sinais da obra — não um objeto vazio com cara de painel", () => {
    const bloco = blocoDaLinhaPrioridade()
    for (const campo of [
      "w.expectedScore",
      "w.alignmentScore",
      "w.alignmentConfidence",
      "w.personalFitPercentile",
      "w.synopsisQuality",
      "w.predictedSynopsisQuality",
      "w.platformAvg",
      "w.totalVotes",
      "w.weightsAuto",
    ]) {
      expect(bloco, `o painel não recebe ${campo}`).toContain(campo)
    }
  })
})

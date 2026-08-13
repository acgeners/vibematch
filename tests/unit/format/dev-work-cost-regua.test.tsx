import { vi, describe, it, expect, afterEach } from "vitest"
import { render, cleanup, screen, fireEvent } from "@testing-library/react"

vi.mock("server-only", () => ({}))
vi.mock("@/lib/use-refresh", () => ({ useRefresh: () => () => {} }))
vi.mock("@/server/actions/account", () => ({ setAnthropicBalance: vi.fn() }))

import { DevWorkAiCost } from "@/components/titles/dev-work-ai-cost"
import { BalanceCard } from "@/components/settings/ai-usage/balance-card"
import type {
  WorkAiCostSummary,
  FromScratchBaseline,
  BalanceStatus,
} from "@/server/queries/ai-usage"

/**
 * O badge de custo por obra e o popover que ele abre são UMA régua de dinheiro.
 *
 * Este é um teste de RENDER de propósito, e não um teste do `money.ts`: o
 * `makeUsdScale` já é coberto por `money.test.ts` e passava verde enquanto este
 * componente chamava `formatUsd` quatro vezes em separado. O que regride aqui não
 * é a fórmula, é o ESCOPO — e escopo só aparece na árvore desenhada.
 *
 * Os números são medidos (ai_api_calls, 2026-08-08, obra "I Became the Cure for
 * the Tyrant in the Waste Novel"): total US$0,125255 sobre cinco parcelas de 0,50¢
 * a 5,37¢. É o caso que produzia "$0,13" em cima de "5,37¢ · 3,98¢ · …" — as
 * parcelas somam o total, e em unidades diferentes a conta deixa de fechar de olho.
 */

const SUMMARY: WorkAiCostSummary = {
  totalCostUsd: 0.125255,
  nCalls: 11,
  byOperation: [
    { operation: "ai_evaluation", label: "Avaliação IA", nCalls: 2, totalCostUsd: 0.053716 },
    { operation: "review_digest", label: "Digest de reviews", nCalls: 3, totalCostUsd: 0.039772 },
    { operation: "synopsis_consolidator", label: "Sinopse canônica", nCalls: 2, totalCostUsd: 0.015298 },
    { operation: "synopsis_quality_predict", label: "Previsão de Interesse", nCalls: 2, totalCostUsd: 0.011428 },
    { operation: "review_summarizer", label: "Resumo de reviews", nCalls: 2, totalCostUsd: 0.005041 },
  ],
}

const BASELINE: FromScratchBaseline = {
  totalUsd: 0.079333,
  byOperation: [
    { operation: "ai_evaluation", label: "Avaliação IA", medianUsd: 0.0479, nSamples: 300 },
  ],
  missingOperations: [],
}

/** Todo texto monetário desenhado — gatilho e popover. */
function moneyOnScreen(): string[] {
  return Array.from(document.body.querySelectorAll("*"))
    .filter((el) => el.children.length === 0)
    .map((el) => el.textContent ?? "")
    .filter((t) => /(\$|¢)/.test(t))
}

function openPopover() {
  const trigger = screen.getByTitle(/custo de ia acumulado/i)
  // Radix abre o popover no `pointerdown`, não no `click` — o mesmo detalhe que
  // já mordeu o dropdown no Puppeteer.
  fireEvent.pointerDown(trigger, { pointerType: "mouse", button: 0 })
  fireEvent.click(trigger)
}

afterEach(cleanup)

describe("badge de custo por obra: uma régua só", () => {
  it("gatilho e quebra por operação saem na MESMA unidade", () => {
    render(<DevWorkAiCost summary={SUMMARY} baseline={BASELINE} />)
    openPopover()

    const values = moneyOnScreen()
    expect(values.length).toBeGreaterThanOrEqual(7) // gatilho + total + 5 parcelas + baseline

    const cents = values.filter((v) => v.includes("¢")).length
    const dollars = values.filter((v) => v.includes("$")).length
    expect({ cents, dollars }).toEqual({ cents: values.length, dollars: 0 })
  })

  it("o total NÃO vira dólar sozinho: 12,53¢, não $0,13", () => {
    render(<DevWorkAiCost summary={SUMMARY} baseline={BASELINE} />)

    // O gatilho é o valor que o dev compara entre obras ao navegar. Com régua por
    // valor ele saía "$0,13", e "0,13" lê como MENOR que o "7,77¢" da obra ao lado.
    expect(screen.getByTitle(/custo de ia acumulado/i).textContent).toContain("12,53¢")
    expect(screen.getByTitle(/custo de ia acumulado/i).textContent).not.toContain("$")
  })

  it("uma parcela cara arrasta a régua INTEIRA pra dólar", () => {
    // O veto de US$1 do `makeUsdScale` continua valendo aqui — a régua não está
    // fixada em centavos, ela é derivada. Sem isso, uma obra de US$3 imprimiria "300¢".
    render(
      <DevWorkAiCost
        summary={{
          ...SUMMARY,
          totalCostUsd: 3.05,
          byOperation: [
            { operation: "ai_evaluation", label: "Avaliação IA", nCalls: 9, totalCostUsd: 3.0 },
            { operation: "review_summarizer", label: "Resumo de reviews", nCalls: 2, totalCostUsd: 0.05 },
          ],
        }}
        baseline={BASELINE}
      />,
    )
    openPopover()

    const values = moneyOnScreen()
    expect(values.filter((v) => v.includes("¢"))).toEqual([])
    // E o menor da série não pode virar "$0,00", que AFIRMA que não houve custo.
    expect(values).not.toContain("$0,00")
    expect(values.join(" ")).toContain("$0,05")
  })
})

/**
 * Mesma classe no card de saldo: "Informado", "gasto desde então" e o número
 * grande do restante são termos de UMA conta (informado − gasto = restante), e
 * apareciam com uma régua cada um. O caso que morde é o dia em que o saldo é
 * informado — o gasto acumulado ainda é de centavos ao lado de um saldo em dólar.
 */
describe("card de saldo: informado, gasto e restante na mesma régua", () => {
  const STATUS: BalanceStatus = {
    balanceUsd: 20,
    setAt: "2026-08-08T12:00:00.000Z",
    spentSinceUsd: 0.03,
    remainingUsd: 19.97,
    callsSince: 4,
  }

  it("gasto pequeno acompanha o saldo em dólar, sem virar ¢", () => {
    render(<BalanceCard status={STATUS} />)

    const values = moneyOnScreen()
    expect(values.filter((v) => v.includes("¢"))).toEqual([])
    // "$0,03" e não "3¢": os três números têm que se somar na cabeça de quem lê.
    expect(values.join(" ")).toContain("$0,03")
    expect(values.join(" ")).toContain("$20,00")
    expect(values.join(" ")).toContain("$19,97")
  })
})

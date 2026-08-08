import { describe, expect, it } from "vitest"
import { formatUsd, formatUsdApprox, makeUsdAxisFormatter } from "@/lib/format/money"

describe("formatUsd", () => {
  it("mostra centavos abaixo de 10¢, que é onde o dólar colapsa", () => {
    expect(formatUsd(0.0567)).toBe("5,67¢") // o badge dev, que exibia "$0.0567"
    expect(formatUsd(0.0034)).toBe("0,34¢") // exibia "$0.003"
    expect(formatUsd(0.03)).toBe("3¢") // avaliação IA típica, exibia "$0.03"
    expect(formatUsd(0.093)).toBe("9,3¢")
  })

  it("mostra dólares de 10¢ pra cima, onde o dólar já lê melhor que o centavo", () => {
    expect(formatUsd(0.1)).toBe("$0,10")
    expect(formatUsd(0.13)).toBe("$0,13") // generate_all
    expect(formatUsd(0.567)).toBe("$0,57")
    expect(formatUsd(4.2)).toBe("$4,20") // saldo baixo
    expect(formatUsd(38.5)).toBe("$38,50")
  })

  it("decide a unidade pelo valor arredondado, não pelo bruto", () => {
    // Pelo bruto, este daria "10¢" — o mesmo número que $0,10 imprime como dólar.
    expect(formatUsd(0.09999)).toBe("$0,10")
    expect(formatUsd(0.0999)).toBe("9,99¢")
  })

  it("não poda zeros que não são mudos", () => {
    expect(formatUsd(0.001)).toBe("0,1¢") // e não "0,10¢"
    expect(formatUsd(0.09)).toBe("9¢") // e não "9,00¢"
    // Regressão do `/\.?0+$/` sem checar o ponto, que imprimia "1" para "100".
    expect(formatUsd(1)).toBe("$1,00")
    expect(formatUsd(100)).toBe("$100,00")
  })

  it("distingue 'zero' de 'existe mas some no arredondamento'", () => {
    expect(formatUsd(0)).toBe("0¢")
    expect(formatUsd(0.00007)).toBe("0,01¢") // 0,007¢ ainda arredonda pra 0,01¢
    expect(formatUsd(0.00004)).toBe("<0,01¢") // 0,004¢ arredondaria pra zero
  })

  it("trata saldo negativo — o pior caso do alerta de saldo", () => {
    expect(formatUsd(-4.2)).toBe("−$4,20") // antes saía "$-4.20"
    expect(formatUsd(-0.05)).toBe("−5¢")
    expect(formatUsd(-0.00004)).toBe(">−0,01¢")
  })

  it("devolve travessão para ausência de dado, nunca zero", () => {
    expect(formatUsd(null)).toBe("—")
    expect(formatUsd(undefined)).toBe("—")
    expect(formatUsd(Number.NaN)).toBe("—")
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe("—")
  })
})

describe("formatUsdApprox", () => {
  it("marca a estimativa", () => {
    expect(formatUsdApprox(0.0567)).toBe("~5,67¢")
    expect(formatUsdApprox(0.13)).toBe("~$0,13")
  })

  it("não empilha qualificador sobre qualificador", () => {
    expect(formatUsdApprox(0.00004)).toBe("<0,01¢")
    expect(formatUsdApprox(null)).toBe("—")
  })
})

describe("makeUsdAxisFormatter", () => {
  it("mantém a unidade fixa no eixo inteiro, escolhida pelo máximo da série", () => {
    // Série que cruza o corte: tick a tick daria "5¢ · 50¢ · $1,20" no mesmo eixo.
    const dollars = makeUsdAxisFormatter(1.2)
    expect(dollars(0)).toBe("$0,00")
    expect(dollars(0.05)).toBe("$0,05")
    expect(dollars(1.2)).toBe("$1,20")

    const cents = makeUsdAxisFormatter(0.08)
    expect(cents(0)).toBe("0¢")
    expect(cents(0.02)).toBe("2¢")
    expect(cents(0.08)).toBe("8¢")
  })
})

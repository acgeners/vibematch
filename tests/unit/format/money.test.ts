import { describe, expect, it } from "vitest"
import { formatUsd, formatUsdApprox, makeUsdScale } from "@/lib/format/money"

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

describe("makeUsdScale", () => {
  it("mantém uma unidade só na régua inteira", () => {
    const s = makeUsdScale(0.0122, 0.03, 0.0472, 0.0815, 0.1, 0.21)
    // A lista "Quanto custa cada ação": a coluna passa a ordenar a olho.
    expect([0.0122, 0.03, 0.0472, 0.0815, 0.1, 0.21].map(s.format)).toEqual([
      "1,22¢",
      "3¢",
      "4,72¢",
      "8,15¢",
      "10¢",
      "21¢",
    ])
  })

  it("resolve o par estimativa/teto que cruza o corte", () => {
    // O bug do print: `formatUsd` valor a valor dava "~8,15¢" ao lado de "até $0,12".
    expect(formatUsdApprox(0.0815)).toBe("~8,15¢")
    expect(formatUsd(0.1223)).toBe("$0,12")

    const par = makeUsdScale(0.0815, 0.1223)
    expect(par.approx(0.0815)).toBe("~8,15¢")
    expect(par.format(0.1223)).toBe("12,23¢")
  })

  it("a unidade sai do MENOR valor — é ele que colapsa em dólar", () => {
    // Pelo maior, este par sairia "$0,08 / $0,12" e perderia a resolução dos dois.
    expect(makeUsdScale(0.0815, 0.1223).format(0.0815)).toBe("8,15¢")
  })

  it("mas o maior VETA a partir de US$1, senão o eixo imprime '776¢'", () => {
    const eixo = makeUsdScale(0.001, 0.45, 7.76)
    expect(eixo.format(7.76)).toBe("$7,76")
    expect(eixo.format(0.45)).toBe("$0,45")
  })

  it("sob veto, o menor da série não vira '$0,00' — isso afirmaria custo zero", () => {
    // A coluna Custo do /curation/ai-usage: `suggest_groups` custou US$0,0046 e o veto do
    // US$25,91 puxa a régua pra dólar. "$0,00" diria que não houve custo.
    const coluna = makeUsdScale(0.0046, 3.28, 25.91)
    expect(coluna.format(0.0046)).toBe("<$0,01")
    expect(coluna.format(25.91)).toBe("$25,91")
    // Zero de verdade continua sendo zero.
    expect(coluna.format(0)).toBe("$0,00")
  })

  it("zero não decide a unidade da régua", () => {
    // Num eixo o zero é sempre o 1º tick; se opinasse, fixaria tudo em centavos.
    const dollars = makeUsdScale(0, 0.05, 1.2)
    expect(dollars.format(0)).toBe("$0,00")
    expect(dollars.format(1.2)).toBe("$1,20")
    // Régua só de zeros: não há o que preservar, cai no default.
    expect(makeUsdScale(0, 0).format(0)).toBe("0¢")
  })

  it("valor solto é a régua de um elemento só — mesma regra, não uma cópia", () => {
    expect(makeUsdScale(0.0567).format(0.0567)).toBe(formatUsd(0.0567))
    expect(makeUsdScale(38.5).format(38.5)).toBe(formatUsd(38.5))
  })
})

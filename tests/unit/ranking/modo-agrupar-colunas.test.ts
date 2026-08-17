import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DEFAULT_COLUMN_WIDTHS,
  TIER_MODE_COLUMN_KEYS,
  WORK_TABLE_COLUMNS,
  getTierModeColumns,
} from "@/components/titles/work-table-config"

const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf-8")

/**
 * O modo Agrupar existe por ORÇAMENTO, não por gosto: a tabela é `table-layout: fixed`,
 * proporcional e sem rolagem horizontal, então cada coluna recebe `natural ÷ soma × largura`.
 * Com as 26 colunas que o seletor permite ligar a soma é 3.066px para ~1.500px de tela — fator
 * 0,49, e TODA coluna sai pela metade. Estes testes guardam a conta, não a lista.
 */

/** A largura de tela de referência — a menor em que este modo precisa caber com folga. */
const TELA_REFERENCIA = 1500

/** As duas colunas estruturais que o `RankingTable` prepende sempre. */
const ESTRUTURAIS = ["select", "rank"] as const

const somaDoModo = () =>
  [...ESTRUTURAIS, ...TIER_MODE_COLUMN_KEYS].reduce(
    (soma, key) => soma + (DEFAULT_COLUMN_WIDTHS[key] ?? 100),
    0,
  )

describe("o conjunto do modo Agrupar", () => {
  it("toda chave existe em WORK_TABLE_COLUMNS — nada some em silêncio", () => {
    // `getTierModeColumns` resolve por chave e DESCARTA o que não achar: um rename na tabela
    // de colunas encolheria o modo sem erro nenhum, e a tela abriria com uma coluna a menos.
    const existentes = new Set(WORK_TABLE_COLUMNS.map((c) => c.key))
    const orfas = TIER_MODE_COLUMN_KEYS.filter((k) => !existentes.has(k))
    expect(orfas, `chaves sem coluna correspondente: ${orfas.join(", ")}`).toEqual([])
    expect(getTierModeColumns()).toHaveLength(TIER_MODE_COLUMN_KEYS.length)
  })

  it("a ordem declarada é a ordem desenhada", () => {
    expect(getTierModeColumns().map((c) => c.key)).toEqual([...TIER_MODE_COLUMN_KEYS])
  })

  it("carrega a coluna que só existe neste modo", () => {
    // "O que a separa" mede o desvio contra as empatadas DO TIER. Fora do modo ela nem é
    // renderizada; se sair daqui, deixa de existir em qualquer lugar.
    expect(TIER_MODE_COLUMN_KEYS).toContain("separator")
  })

  /** O que uma coluna recebe DE FATO: a largura aqui é uma share, não um tamanho. */
  const larguraReal = (key: string) =>
    Math.round(((DEFAULT_COLUMN_WIDTHS[key] ?? 100) / somaDoModo()) * TELA_REFERENCIA)

  it("🔴 o separador recebe o bastante para a leitura INTEIRA", () => {
    // É o piso que justifica o modo existir. Medido no browser: barra 92 + ícone + valor +
    // frase + σ pedem ~292px, e o container query só devolve a frase acima de 270 de conteúdo.
    // ⚠️ Coluna nova no conjunto derruba este número sem tocar em nada do separador — a share
    // dele diminui porque a SOMA aumentou. É esse acoplamento que o teste guarda.
    expect(
      larguraReal("separator"),
      `com ${TIER_MODE_COLUMN_KEYS.length} colunas a soma é ${somaDoModo()}px; ` +
        "para caber mais uma, suba `separator` em DEFAULT_COLUMN_WIDTHS na mesma proporção",
    ).toBeGreaterThanOrEqual(292)
  })

  it("o título continua legível — ele é a identidade da linha", () => {
    // Sem um piso aqui, o orçamento fecharia comendo o título, que é o que faz a pessoa saber
    // de que obra a linha fala.
    expect(larguraReal("title")).toBeGreaterThanOrEqual(260)
  })
})

describe("quem manda nas colunas quando há tiers", () => {
  it("a Lista usa o modo, e não a config do seletor", () => {
    const src = ler("components/ranking/ranking-table.tsx")
    const bloco = src.match(/const columns = useMemo\([\s\S]*?\n {4}\[config, tiers\],\n {2}\)/)
    expect(bloco, "o cálculo de `columns` mudou de forma — reveja este teste").toBeTruthy()
    expect(bloco![0]).toContain("tiers != null")
    expect(bloco![0]).toContain("getTierModeColumns()")
    // E sem tiers a coluna do separador não pode entrar por config: ela mediria contra um
    // conjunto que não está na tela.
    expect(bloco![0]).toContain('c.key !== "separator"')
  })

  it("a legenda das forças é desenhada na linha do DIVISOR, e numa cópia só", () => {
    // Ela já esteve no tooltip do cabeçalho e no <th>, ao mesmo tempo. Duas cópias do mesmo
    // texto divergem na primeira edição — e no cabeçalho ela cobrava altura da linha inteira
    // para caber por 14px.
    const src = ler("components/ranking/ranking-table.tsx")
    expect(src.match(/<SeparatorLegend[\s/]/g) ?? [], "mais de uma cópia da legenda").toHaveLength(1)
    expect(src, "a legenda não está no slot do divisor").toMatch(/legendSlot=\{<SeparatorLegend/)

    // E o <th> volta a ser só o nome da coluna.
    const th = src.slice(src.indexOf("{cellContent}"), src.indexOf("<ResizeHandle"))
    expect(th, "a legenda voltou para o cabeçalho").not.toContain("SeparatorLegend")
  })

  it("os chips de composição ficam junto do rótulo do tier, não no canto oposto", () => {
    // Eles dizem DE QUE o tier é feito; o rótulo diz de QUANTAS obras. O `ml-auto` que os
    // empurrava para a direita passou para a legenda.
    const src = ler("components/ranking/tie-break-band.tsx")
    const posChips = src.indexOf("composition?.map(")
    const posLegenda = src.indexOf("{legendSlot &&")
    expect(posChips).toBeGreaterThan(-1)
    expect(posLegenda, "o slot da legenda sumiu do divisor").toBeGreaterThan(-1)
    expect(posLegenda, "a legenda tem que vir DEPOIS dos chips na linha").toBeGreaterThan(posChips)
    // o `ml-auto` é o que separa os dois lados da linha, e ele é da legenda agora
    const trechoChips = src.slice(src.lastIndexOf("<span", posChips), posChips)
    expect(trechoChips, "os chips voltaram a ser empurrados para a direita").not.toContain("ml-auto")
  })

  it("o seletor de colunas fica desabilitado — e explica por quê", () => {
    // Desabilitado e não ausente: controle que some obriga a pessoa a reencontrá-lo. E sem a
    // explicação, o seletor cinza vira "quebrou".
    const src = ler("components/ranking/ranking-table.tsx")
    expect(src).toContain("tierModeOnList")
    const trecho = src.slice(src.indexOf("<WorkColumnPicker"), src.indexOf("<WorkColumnPicker") + 600)
    expect(trecho).toContain("tierModeOnList")
    expect(trecho).toMatch(/Desligue o Agrupar/)
  })
})

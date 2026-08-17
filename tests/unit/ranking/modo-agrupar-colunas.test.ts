import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  TIER_MODE_COLUMN_KEYS,
  TIER_MODE_COLUMN_WIDTHS,
  TIER_MODE_TABLE_WIDTH,
  WORK_TABLE_COLUMNS,
  getTierModeColumns,
} from "@/components/titles/work-table-config"

const ler = (rel: string) => readFileSync(join(process.cwd(), rel), "utf-8")

/**
 * O modo Agrupar existe por ORÇAMENTO, não por gosto: a tabela é `table-layout: fixed`,
 * proporcional e sem rolagem horizontal, então cada coluna recebe `natural ÷ soma × largura`.
 * Com as 26 colunas que o seletor permite ligar a soma é 3.066px para ~1.500px de tela — fator
 * 0,49, e TODA coluna sai pela metade. Estes testes guardam a conta, não a lista.
 *
 * 🔴 **A primeira versão media contra um container de 1.500px, e a tabela nunca recebe isso.**
 * Medido no browser em 17/08/2026: a 1500px de viewport a tabela mede **1.442px** (o resto é o
 * padding da página) e o teto dela é 1.502px. O teste aprovava quatro truncamentos ao mesmo
 * tempo — Ano em "20…", Votos em "33,…", a pílula do Veredito cortada e a frase do separador
 * nunca desenhada —, porque conferia a conta numa largura que a página não tem. Referência
 * errada aprova tudo, inclusive o que quebrou na véspera.
 */

/** As duas colunas estruturais que o `RankingTable` prepende sempre. */
const ESTRUTURAIS = ["select", "rank"] as const

/**
 * O que cada célula PEDE, em px na largura de referência — medido no browser clonando cada
 * `<td>` num contêiner `width: max-content` (40 linhas, filtro de publicação aberto). Medir no
 * lugar devolveria a largura CONCEDIDA, nunca a pedida: a tabela é fixed e o `td` é
 * `overflow:hidden`. Inclui os 24px de `px-3` do `td`.
 *
 * ⚠️ É a ENTRADA do orçamento, não uma 2ª cópia dele: `TIER_MODE_COLUMN_WIDTHS` é a alocação
 * escolhida, e o teste existe para dizer se ela cobre o pedido. Os dois números coincidirem na
 * maioria das colunas é consequência de a soma fechar, não a regra.
 *
 * Três não vêm de `max-content`:
 * - `separator` 294 — o degrau do container query (270 de conteúdo) + 24. O clone mede 24px
 *   ali, porque a barra é `absolute` e o `@container` não resolve fora da árvore.
 * - `title` 260 — piso escolhido: ele é o único que degrada bem (reticências num nome são
 *   esperadas), e por isso é ele que absorve a sobra do orçamento.
 * - `total_votes` 74 — o pior caso da TELA era "16,2K", o do CATÁLOGO é 193.712 votos
 *   ⇒ "193,7K". Dimensionar coluna de número pela amostra visível trunca no dia da obra popular.
 */
const PEDE: Record<string, number> = {
  select: 40,
  rank: 41,
  fav: 52,
  title: 250,
  publication_status: 92,
  // ⚠️ 50 e não 49: o medido é 49,2 e o `text-overflow` dispara em QUALQUER estouro — 0,2px
  // viraram "2…" numa coluna de 3 dígitos. Idem `art` e `platform_avg`. Arredonde PRA CIMA.
  chapters_total: 50,
  year: 58,
  art: 50,
  decision: 62,
  separator: 294,
  expected_score: 58,
  synopsis_q: 73,
  synopsis_pred: 90,
  alignment_score: 100,
  platform_avg: 50,
  total_votes: 75,
}

const chavesDoModo = (): string[] => [...ESTRUTURAIS, ...TIER_MODE_COLUMN_KEYS]

const somaDoModo = () =>
  chavesDoModo().reduce((soma, key) => soma + (TIER_MODE_COLUMN_WIDTHS[key] ?? 100), 0)

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

  it("toda coluna do modo declara largura — nenhuma cai no `?? 100` invisível", () => {
    const semLargura = chavesDoModo().filter((k) => TIER_MODE_COLUMN_WIDTHS[k] == null)
    expect(semLargura, `sem entrada em TIER_MODE_COLUMN_WIDTHS: ${semLargura.join(", ")}`).toEqual([])
    // E nada sobrando no mapa: entrada órfã é largura que ninguém aplica, e ela some do
    // orçamento sem nada acusar.
    const orfas = Object.keys(TIER_MODE_COLUMN_WIDTHS).filter((k) => !chavesDoModo().includes(k))
    expect(orfas, `no mapa mas fora do modo: ${orfas.join(", ")}`).toEqual([])
  })

  /** O que uma coluna recebe DE FATO na largura de referência: a largura é uma share. */
  const larguraReal = (key: string) =>
    Math.round(((TIER_MODE_COLUMN_WIDTHS[key] ?? 100) / somaDoModo()) * TIER_MODE_TABLE_WIDTH)

  it("🔴 a soma é a largura da TABELA — é isso que faz cada número valer px", () => {
    // Com a soma igual à largura medida, `natural ÷ soma × container` devolve o próprio
    // número escrito no mapa. Se a soma escorregar, todo valor de lá vira "mais ou menos",
    // e a comparação com o que a célula PEDE deixa de significar alguma coisa.
    expect(somaDoModo()).toBe(TIER_MODE_TABLE_WIDTH)
  })

  it("🔴 nenhuma coluna recebe menos do que a célula pede", () => {
    // O defeito que este teste existe para pegar é MUDO: `table-layout: fixed` + `overflow:
    // hidden` no td cortam o conteúdo sem barra de rolagem, sem erro e sem log. Foi assim que
    // Ano virou "20…", Votos virou "33,…" e a pílula do Veredito saiu cortada ao meio — três
    // colunas degradadas com a suíte verde.
    const faltando = chavesDoModo()
      .map((key) => ({ key, tem: larguraReal(key), pede: PEDE[key] ?? 0 }))
      .filter((c) => c.tem < c.pede)
    expect(
      faltando.map((c) => `${c.key}: tem ${c.tem}px, pede ${c.pede}px`),
      "para dar px a uma coluna é preciso tirar de outra — o orçamento é fechado",
    ).toEqual([])
  })

  it("o título continua legível — ele é a identidade da linha, e é quem absorve a sobra", () => {
    // Ele é o único que degrada bem, então o orçamento fecha nele: o que sobra depois de todo
    // mundo receber o que pede vai pro título. Sem o piso, "fechar" viraria comer o título.
    //
    // ⚠️ O piso é 250 e o título tem 255 — 5px de margem, e é o número mais apertado do modo.
    // O piso ANTERIOR (260) era um chute; este continua sendo escolha, mas com a medida ao
    // lado: a MEDIANA dos títulos pede 275px, ou seja mais da metade trunca de qualquer jeito.
    // Baixar daqui é decidir que o nome da obra deixa de identificar a linha.
    expect(larguraReal("title")).toBeGreaterThanOrEqual(250)
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

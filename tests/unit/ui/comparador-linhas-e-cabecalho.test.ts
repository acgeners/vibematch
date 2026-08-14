import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * O comparador (`WorkCompareDrawer`) tem uma régua só: o CABEÇALHO identifica a obra, as
 * LINHAS comparam. Estes testes guardam o que quebrou quando ela não existia — e todos os
 * casos abaixo passaram por `tsc` e pela suíte antes, porque nenhum é erro de tipo.
 *
 * ⚠️ Leitura de SOURCE de propósito: o drawer só monta com dado de banco e um grid sticky de
 * N colunas, e o que regride aqui é ESCOPO (o que mora onde), não cálculo. Onde dá para casar
 * o comportamento em vez da grafia, o teste casa o comportamento — ver o caso do `allEqual`.
 */
const raiz = process.cwd()
const drawer = readFileSync(join(raiz, "components/titles/work-compare-drawer.tsx"), "utf-8")
const action = readFileSync(join(raiz, "server/actions/compare.ts"), "utf-8")

describe("o que compara é LINHA, o que identifica é cabeçalho", () => {
  it("Publicação e Meu status são linhas separadas", () => {
    // Eram uma célula só com os dois badges: dimensões diferentes (uma é da obra, a outra é
    // sua), sem como ordenar ou esconder uma sem a outra — e, em coluna estreita, o
    // `flex-wrap` quebrava e esticava a altura de TODAS as colunas daquela linha.
    expect(drawer).toContain('{ key: "status:publicacao", label: "Publicação" }')
    expect(drawer).toContain('{ key: "status:pessoal", label: "Meu status" }')
    expect(drawer).not.toMatch(/\{ key: "status", label: "Status" \}/)
  })

  it("Interesse é linha, e não mora dentro do botão de Sinopse", () => {
    // Era o único número da tela fora de uma linha — logo o único que não dava pra ordenar,
    // esconder nem incluir no "só diferenças".
    expect(drawer).toContain('{ key: "interesse", label: "Interesse" }')
    expect(drawer).not.toMatch(/synopsisQuality=\{/)
    const sinopse = drawer.slice(drawer.indexOf("function SynopsisButton"))
    expect(sinopse.slice(0, 1200)).not.toContain("Interesse:")
  })

  it("o cabeçalho não repete o que já é linha, e o ↗ saiu junto do título-link", () => {
    const cabecalho = drawer.slice(
      drawer.indexOf("function CompareHeaderCell"),
      drawer.indexOf("function SynopsisButton")
    )
    // O título já é <Link target="_blank">: o ícone repetia a ação ocupando 22px.
    expect(cabecalho).toContain('target="_blank"')
    expect(cabecalho).not.toContain("<ExternalLink")
    // A faixa "Mover" custava ~26px por coluna para rotular um gesto cujo alvo é o card todo.
    expect(cabecalho).not.toMatch(/>Mover</)
  })

  it("o ano sai do padrão mas continua disponível — é o único jeito de ORDENAR por ano", () => {
    expect(drawer).toMatch(/hidden: \[\s*"ano",/)
    expect(drawer).toContain('{ key: "ano", label: "Ano" }')
    expect(drawer).toContain('sortControl("ano")')
  })

  it("a config salva é invalidada quando as CHAVES de linha mudam", () => {
    // `normalizeRowsConfig` descarta chave desconhecida: sem o bump, quem tinha "status"
    // escondido veria as duas linhas novas VISÍVEIS — a escolha da pessoa invertida em
    // silêncio. O bump zera a personalização, que é visível e refazível.
    expect(drawer).toContain('const ROWS_CONFIG_STORAGE_KEY = "compare_rows_config_v6"')
  })
})

describe("o filtro 'só diferenças' mede o que a célula mostra", () => {
  it("Capítulos compara e imprime o MESMO texto", () => {
    // 🔴 O filtro comparava `${chaptersRead}/${totalChapters}` e a célula imprimia só o
    // total: duas obras com 45 capítulos e leituras diferentes sobreviviam ao filtro e
    // apareciam como "45" e "45" — filtro aparentemente quebrado, sem erro nem log.
    expect(drawer).toContain("allEqual((w) => chaptersCellText(w))")
    expect(drawer).toContain("<span className=\"text-sm tabular-nums\">{chaptersCellText(w)}</span>")
    expect(drawer).not.toMatch(/allEqual\(\(w\) => `\$\{w\.chaptersRead/)
  })

  it("o progresso sai de tracks_progress, nunca de uma lista de nomes", () => {
    // Em Want to Read / Untracked / Not Now / Not Interested o "0 /" é o default de quem
    // nunca abriu a obra — desenhado como fração, lê como leitura abandonada.
    const fn = drawer.slice(drawer.indexOf("function chaptersCellText"))
    expect(fn.slice(0, 700)).toContain("PERSONAL_STATUSES_BY_ID")
    expect(fn.slice(0, 700)).toContain("tracksProgress")
  })
})

describe("dado que já vinha do banco e era descartado", () => {
  it("is_adult é mapeado — sem query nova", () => {
    // `WORK_WITH_RELATIONS_SELECT` é `select *`, então o campo já chegava em `mapWorkToCompare`.
    expect(action).toContain("isAdult: Boolean(work.is_adult)")
    expect(drawer).toContain("work.isAdult &&")
  })

  it("isFavorite aparece na capa", () => {
    expect(drawer).toContain("work.isFavorite &&")
  })
})

describe("cor de tema", () => {
  /**
   * ⚠️ Varre o source SEM comentários. A 1ª versão deste teste reprovou acusando o comentário
   * que explica a própria correção — o mesmo tropeço que o teste das abas da obra já teve.
   */
  const semComentarios = drawer
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")

  it("tom claro fixo sempre vem com par dark: na mesma classe", () => {
    // O selo de Interesse tinha `text-rose-600` no gatilho e `bg-rose-50 text-rose-700` no
    // popover — claros e SEM variante escura: no tema escuro, ♥ vermelho sobre fundo escuro
    // e um bloco quase branco. `text-rose-700 dark:text-rose-300` (o chip de stance) é o
    // caso legítimo, e por isso a régua é o PAR, não a cor.
    const linhas = semComentarios.split("\n")
    const claroDeFundo = linhas.filter(
      (l) => /bg-(?:rose|red|emerald|amber|sky)-(?:50|100|200)(?![0-9])/.test(l) && !/dark:bg-/.test(l)
    )
    expect(claroDeFundo, "fundo claro sem par dark: não sobrevive ao tema escuro").toEqual([])

    const textoEscuro = linhas.filter(
      (l) => /text-(?:rose|red|emerald|amber|sky)-(?:600|700|800|900)(?![0-9])/.test(l) && !/dark:text-/.test(l)
    )
    expect(textoEscuro, "texto escuro sem par dark: some no tema escuro").toEqual([])
  })
})

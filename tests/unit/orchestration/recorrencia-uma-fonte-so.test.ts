import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A recorrência aparece em DUAS pontas da mesma página: ela ORDENA a lista (no servidor,
 * dentro do `getRanking`) e é MOSTRADA na célula (no cliente, na coluna "Grupos"). Se cada
 * ponta contar por conta própria, a lista ordena por um número e exibe outro — a classe de
 * erro mais cara desta base ("DOIS critérios para o MESMO fato"), e a mais silenciosa: nada
 * quebra, a tela fica plausível e só quem conferir linha a linha percebe.
 *
 * ⚠️ Este teste captura o IDENTIFICADOR de que cada ponta deriva, em vez de casar o nome
 * `membership`: renomear a variável continua passando, dividir a fonte em duas reprova. Foi
 * conferido com uma sonda — trocar uma das pontas por outra chamada faz falhar.
 */

const PAGE = resolve(__dirname, "../../../app/favorites/[listId]/page.tsx")

function source(): string {
  // Sem os comentários: eles explicam a invariante (e citam os dois nomes), e a 1ª versão
  // deste teste passou verde lendo a própria explicação.
  return readFileSync(PAGE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

describe("recorrência: ordenar e exibir saem da MESMA leitura", () => {
  it("a contagem que ordena e a lista que a célula mostra derivam do mesmo objeto", () => {
    const s = source()

    const ordena = s.match(/groupCountByWorkId:\s*groupCountsFrom\(\s*(\w+)\s*\)/)
    const exibe = s.match(/groupsByWorkId=\{\s*(\w+)\.byWork\s*\}/)

    expect(ordena, "a página precisa passar a contagem ao getRanking").not.toBeNull()
    expect(exibe, "a página precisa passar os grupos à WorkTable").not.toBeNull()
    expect(ordena![1]).toBe(exibe![1])
  })

  it("a leitura é uma só — nada de um segundo mapa para a mesma pergunta", () => {
    const s = source()
    const chamadas = s.match(/getGroupMembership\(/g) ?? []
    expect(chamadas).toHaveLength(1)
  })

  it("“groups” é campo de ordenação VÁLIDO na página", () => {
    // Sem isto o clique no cabeçalho da coluna reescreve a URL, o `sortLevels` cai no
    // fallback `expected_score` e a lista não muda — um controle que parece quebrado.
    const s = source()
    const bloco = s.match(/const validSortFields = new Set<string>\(\[([\s\S]*?)\]\)/)
    expect(bloco).not.toBeNull()
    expect(bloco![1]).toMatch(/"groups"/)
  })

  it("a visão derivada abre ordenada por recorrência, com a Prevista desempatando", () => {
    // A recorrência tem ~5 valores possíveis: sozinha ela empata a lista quase inteira.
    const s = source()
    expect(s).toMatch(/isMulti\s*\?\s*"groups:desc,expected_score:desc"/)
  })

  it("o painel de filtros recebe o MESMO default de ordenação que o servidor usa", () => {
    // O painel tem `expected_score:desc` como default próprio. Sem receber este, ele
    // desenhava "N. Prevista · 1 nível" sobre uma lista ordenada por Grupos — e o
    // "Aplicar filtros" seguinte reescrevia a URL com a ordem errada. Medido na tela.
    const s = source()
    const servidor = s.match(/const (\w+) = isMulti \? "groups:desc/)
    expect(servidor, "o default de sort da página precisa ser uma constante").not.toBeNull()
    const nome = servidor![1]
    expect(s).toMatch(new RegExp(`const rawSort = str\\("sort"\\) \\?\\? ${nome}`))
    expect(s).toMatch(new RegExp(`defaultSort=\\{${nome}\\}`))
  })
})

describe("o getRanking sabe ordenar por recorrência", () => {
  it("o comparador usa a contagem recebida, e trata ausência como 0 (não -Infinity)", () => {
    const rank = readFileSync(resolve(__dirname, "../../../server/queries/ranking.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")

    const ramo = rank.match(/if \(field === "groups"\)[\s\S]{0,260}?\n\s{4}\}/)
    expect(ramo, "falta o ramo de ordenação por grupos").not.toBeNull()
    // "em nenhum grupo" é um fato, não um vazio: com -Infinity a ordem crescente começaria
    // pelas sem grupo em vez de por 0, 1, 2…
    expect(ramo![0]).toMatch(/\?\?\s*0/)
    expect(ramo![0]).not.toMatch(/-Infinity/)
  })
})

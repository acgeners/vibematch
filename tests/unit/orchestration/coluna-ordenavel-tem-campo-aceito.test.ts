import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

/**
 * Invariante arquitetural: TODO campo de ordenação que um cabeçalho de coluna emite
 * precisa (a) ser aceito pela whitelist da página que hospeda aquela tabela e (b) ter
 * ramo próprio no `compareByField` do `getRanking`.
 *
 * 🔴 Por que é invariante e não zelo: quando o campo não está na whitelist, a página
 * NÃO erra — ela troca em silêncio por `expected_score`. A lista recarrega, a seta some
 * do cabeçalho clicado e o resultado é plausível, então lê-se como "esta coluna não
 * ordena" em vez de "esta coluna ordena por outra coisa". É a família "dois critérios
 * pro mesmo fato": a tabela decide o que é ordenável, a página decide o que é aceito, e
 * as duas listas eram escritas à mão, uma em cada arquivo.
 *
 * Foi assim que `decision` e `synopsis_pred` — ordenáveis na WorkTable desde sempre —
 * ficaram fora da whitelist do /titles, e `synopsis_pred` fora também da do /favorites.
 * Achado em 2026-08-14, ao acrescentar a coluna "Minha nota (Real)" (`user_score`).
 *
 * O teste DERIVA os dois lados do source: whitelist nova ou coluna nova entra na
 * checagem sozinha, que é o caso que uma lista fixa aqui dentro não pegaria.
 */

const WORK_TABLE = "components/titles/work-table.tsx"
const RANKING_TABLE = "components/ranking/ranking-table.tsx"
const RANKING_QUERY = "server/queries/ranking.ts"

/**
 * Tabelas × páginas que as hospedam. A WorkTable serve /titles E /favorites.
 *
 * `campo` difere porque as duas tabelas guardam a mesma informação em formas diferentes:
 * a WorkTable num objeto `{ field, label }` e a RankingTable num mapa coluna → campo.
 */
const TABELAS = [
  {
    tabela: WORK_TABLE,
    marcador: "const sortableColumns",
    campo: /\bfield:\s*"([a-z_]+)"/g,
    paginas: ["app/titles/page.tsx", "app/favorites/[listId]/page.tsx"],
  },
  {
    tabela: RANKING_TABLE,
    marcador: "const COLUMN_TO_SORT_FIELD",
    campo: /^\s*[a-z_]+:\s*"([a-z_]+)"/gm,
    paginas: ["app/ranking/page.tsx"],
  },
] as const

function read(path: string): string {
  return readFileSync(path, "utf8")
}

/**
 * Recorta o objeto literal que vem depois do `= {`, casando chaves.
 *
 * ⚠️ Começar no primeiro `{` depois do marcador NÃO funciona: a anotação de tipo
 * (`Record<string, { field: string }>`) tem chaves próprias, e o recorte engolia o corpo
 * inteiro do componente — o teste passou a "achar" `align: "left"` como campo de
 * ordenação. Mesma classe de erro que ele existe pra pegar: um critério largo demais
 * respondendo por outro.
 */
function blocoDoObjeto(src: string, marcador: string, arquivo: string): string {
  const start = src.indexOf(marcador)
  expect(start, `${arquivo}: não achei "${marcador}"`).toBeGreaterThan(-1)
  const abre = src.indexOf("= {", start)
  expect(abre, `${arquivo}: não achei o "= {" de ${marcador}`).toBeGreaterThan(-1)
  let profundidade = 0
  for (let i = abre + 2; i < src.length; i++) {
    if (src[i] === "{") profundidade++
    else if (src[i] === "}" && --profundidade === 0) return src.slice(abre, i)
  }
  throw new Error(`${arquivo}: objeto de ${marcador} não fecha`)
}

/**
 * Campos emitidos SOB CONDIÇÃO de uma prop — `...(prop ? { col: { field: "x" } } : {})`.
 *
 * Uma tabela serve várias páginas, e há dado que só uma delas carrega (a coluna "Grupos"
 * precisa de `groupsByWorkId`, que só /favorites passa). Nesse caso o cabeçalho SÓ é
 * clicável onde a prop chega, então exigir o campo na whitelist das outras páginas seria
 * cobrar uma aceitação para um clique que não existe — e a saída preguiçosa (aceitar em
 * todas) devolveria o defeito: ordenar por um campo que ali é 0 em toda linha.
 *
 * Devolve campo → prop de que ele depende. A regra é derivada da FORMA do código, não de
 * uma lista de exceções: qualquer coluna condicional futura entra sozinha.
 */
function camposCondicionais(bloco: string): Map<string, string> {
  const porProp = new Map<string, string>()
  const re = /\.\.\.\(\s*(\w+)\s*\?\s*\{[^{}]*\{\s*field:\s*"([a-z_]+)"/g
  for (const [, prop, campo] of bloco.matchAll(re)) porProp.set(campo, prop)
  return porProp
}

/**
 * Os campos que a tabela manda pro servidor. Os `crit_*` ficam de fora: as três
 * whitelists os incluem via spread de `CRITERION_SLUGS`, e o comparador os trata por
 * prefixo — derivá-los aqui só reescreveria a mesma regra.
 */
function camposDeOrdenacao(
  arquivo: string,
  marcador: string,
  campo: RegExp,
): { sempre: string[]; condicionais: Map<string, string> } {
  const bloco = blocoDoObjeto(read(arquivo), marcador, arquivo)
  const condicionais = camposCondicionais(bloco)
  const campos = new Set<string>()
  for (const [, valor] of bloco.matchAll(new RegExp(campo.source, campo.flags))) {
    if (!valor.startsWith("crit_") && !condicionais.has(valor)) campos.add(valor)
  }
  expect(campos.size, `${arquivo}: nenhum campo de ordenação extraído`).toBeGreaterThan(5)
  return { sempre: [...campos], condicionais }
}

/** Todos os campos que a tabela pode emitir, condicionais inclusive. */
function todosOsCampos(arquivo: string, marcador: string, campo: RegExp): string[] {
  const { sempre, condicionais } = camposDeOrdenacao(arquivo, marcador, campo)
  return [...sempre, ...condicionais.keys()]
}

/** As strings literais de dentro do `new Set<string>([...])` da página. */
function whitelistDaPagina(pagina: string): Set<string> {
  const src = read(pagina)
  const start = src.indexOf("const validSortFields")
  expect(start, `${pagina}: não achei validSortFields`).toBeGreaterThan(-1)
  const fecha = src.indexOf("])", start)
  const bloco = src.slice(start, fecha)
  const campos = new Set<string>()
  for (const [, campo] of bloco.matchAll(/"([a-z_]+)"/g)) campos.add(campo)
  return campos
}

describe("arquitetura: coluna ordenável tem campo aceito na página e ramo no comparador", () => {
  for (const { tabela, marcador, campo, paginas } of TABELAS) {
    for (const pagina of paginas) {
      it(`${pagina} aceita todo campo que ${tabela} emite`, () => {
        const whitelist = whitelistDaPagina(pagina)
        const { sempre, condicionais } = camposDeOrdenacao(tabela, marcador, campo)
        const srcPagina = read(pagina)
        // Campo condicional só é cobrado de quem passa a prop — mas aí é cobrado igual.
        const exigidos = [
          ...sempre,
          ...[...condicionais].filter(([, prop]) => srcPagina.includes(`${prop}=`)).map(([c]) => c),
        ]
        const faltando = exigidos.filter((c) => !whitelist.has(c))
        expect(
          faltando,
          `${pagina}: ${faltando.join(", ")} cairia(m) em expected_score sem erro nenhum`,
        ).toEqual([])
      })
    }
  }

  it("o getRanking tem ramo pra cada campo emitido pelas tabelas", () => {
    const comparador = read(RANKING_QUERY)
    const tratados = new Set(
      [...comparador.matchAll(/field === "([a-z_]+)"/g)].map(([, campo]) => campo),
    )
    const emitidos = new Set(
      TABELAS.flatMap(({ tabela, marcador, campo }) => todosOsCampos(tabela, marcador, campo)),
    )
    const semRamo = [...emitidos].filter((campo) => !tratados.has(campo))
    // Sem ramo, `compareByField` devolve 0 pra TODO par: a lista sai na ordem do
    // desempate final, com a seta acesa no cabeçalho afirmando outra coisa.
    expect(semRamo, `${RANKING_QUERY}: sem ramo pra ${semRamo.join(", ")}`).toEqual([])
  })

  it("a coluna Minha nota (Real) está ordenável nas duas tabelas", () => {
    // Caso concreto que motivou o teste — protege contra a coluna ser adicionada ao
    // picker (que é só configuração) sem o campo do lado do servidor.
    for (const { tabela, marcador, campo } of TABELAS) {
      expect(todosOsCampos(tabela, marcador, campo)).toContain("user_score")
    }
  })
})

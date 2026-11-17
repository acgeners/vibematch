import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * A consulta (`getRanking`) ordena pela conversão de `effectiveSortLevels`: sem modelo,
 * "N. Prevista" vira Alinhamento. O painel e as duas tabelas têm de mostrar o MESMO campo, e
 * para isso recebem `sortBasis` da página.
 *
 * 🔴 A prop tem default "expected" (o /catalog não converte nada), então esquecê-la não dá erro
 * de tipo nem de runtime: o painel volta a dizer "N. Prevista" e a tabela volta a agrupar por
 * ela, sobre uma lista ordenada pelo Alinhamento. Por isso este teste exige a prop nas páginas
 * que usam `getRanking`.
 */

const raiz = resolve(__dirname, "../../..")

function semComentarios(arquivo: string): string {
  return readFileSync(resolve(raiz, arquivo), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
}

/** Do `<Componente` até o `/>` que fecha a tag. */
function tags(src: string, componente: string): string[] {
  const out: string[] = []
  const re = new RegExp(`<${componente}\\b`, "g")
  for (let m = re.exec(src); m; m = re.exec(src)) {
    const fim = src.indexOf("/>", m.index)
    out.push(src.slice(m.index, fim === -1 ? undefined : fim))
  }
  return out
}

const PAGINAS: Array<{ arquivo: string; componentes: string[] }> = [
  { arquivo: "app/ranking/page.tsx", componentes: ["RankingFiltersComponent", "RankingTable"] },
  { arquivo: "app/favorites/[listId]/page.tsx", componentes: ["RankingFiltersComponent", "WorkTable"] },
]

describe("a página entrega ao painel e à tabela a régua que ordena a lista", () => {
  for (const { arquivo, componentes } of PAGINAS) {
    it(`${arquivo}: \`sortBasis\` sai de \`resolveSortBasis\` e chega a ${componentes.join(" e ")}`, () => {
      const src = semComentarios(arquivo)
      expect(src).toMatch(/const sortBasis = resolveSortBasis\(/)
      for (const c of componentes) {
        const achadas = tags(src, c)
        expect(achadas.length, `${c} não é renderizado em ${arquivo}`).toBeGreaterThan(0)
        for (const t of achadas) expect(t, `${c} sem sortBasis em ${arquivo}`).toMatch(/\bsortBasis=\{sortBasis\}/)
      }
    })
  }
})

describe("as tabelas marcam e agrupam pelo campo que ordena de fato", () => {
  for (const arquivo of ["components/ranking/ranking-table.tsx", "components/titles/work-table.tsx"]) {
    it(`${arquivo}: o campo ativo vem de \`activeSortFieldFor\` com a régua recebida`, () => {
      const src = semComentarios(arquivo)
      expect(src).toMatch(/const activeSortField = activeSortFieldFor\(\s*\w+\s*,\s*sortBasis\s*\)/)
      // E o cabeçalho de um campo que ordenaria por outro não clica: a régua chega ao cabeçalho
      // (direto, ou pelo mapa coluna→campo do /ranking, que a repassa a `isSortFieldAvailable`).
      expect(src).toMatch(/isSortFieldAvailable\(/)
      expect(src).toMatch(/(isSortFieldAvailable|getSortFieldForColumn)\([^)]*,\s*sortBasis\s*\)/)
    })
  }
})

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = readFileSync(
  join(process.cwd(), "server/embeddings/refresh.ts"),
  "utf8",
)
// Comentários explicam JUSTAMENTE o bug (citam `.limit(2000)`, "1000 linhas") —
// varrer com eles dentro faria o teste reprovar a própria documentação da correção.
const CODIGO = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")

/**
 * As duas leituras do refresh de embeddings têm que ser PAGINADAS.
 *
 * 🔴 Cada uma quebrava de um jeito, e nenhum dos dois aparece em teste de unidade,
 * em `tsc` ou em runtime como erro:
 *
 * - `work_embeddings` não tinha `.range()` nem `.limit()` ⇒ corte default de 1000
 *   linhas do PostgREST. Medido em 2026-08-14: **985 linhas, 15 do estouro.** A
 *   partir de 1001 as linhas cortadas sumiriam do mapa de hashes, as obras
 *   correspondentes pareceriam "nunca embedadas" e seriam re-embedadas e re-pagas
 *   a cada execução — com o painel relatando sucesso.
 * - `works` vinha numa requisição só (8,6 MB, quatro joins), a maior resposta
 *   única do app e a suspeita do `TypeError: terminated` que o painel exibia.
 *
 * ⚠️ Este teste casa o FATO (a leitura passa por paginação), não a grafia de um
 * nome de variável: trocar `PAGE_SIZE` de nome não fura, tirar o `.range()` fura.
 */
describe("refresh de embeddings lê em páginas", () => {
  it("nenhuma leitura de catálogo usa `.limit(` de teto único", () => {
    // `.limit(N)` aqui era o opt-out explícito do corte de 1000 — e trocava um
    // truncamento silencioso por uma resposta gigante numa tacada.
    expect(CODIGO).not.toMatch(/\.limit\(\s*\d{3,}\s*\)/)
  })

  it("as duas tabelas são lidas com paginação", () => {
    for (const tabela of ["works", "work_embeddings"]) {
      const trecho = CODIGO.slice(CODIGO.indexOf(`.from("${tabela}")`))
      expect(
        trecho.slice(0, 400),
        `a leitura de ${tabela} precisa de .range() — sem ele o PostgREST corta em 1000 sem avisar`,
      ).toContain(".range(")
    }
  })

  it("usa o paginador compartilhado, não um laço próprio", () => {
    // Laço à mão é onde nasce o off-by-one que subconta — o helper já é testado.
    expect(CODIGO).toContain("fetchAllRows")
  })

  it("a falha de transporte ganha contexto antes de virar toast", () => {
    // Sem isto o usuário vê `TypeError: terminated` puro: não diz o que estava
    // sendo lido nem que a causa é rede, e manda procurar bug onde não há.
    expect(CODIGO).toContain("comContexto")
    expect(SRC).toMatch(/terminated/)
  })
})

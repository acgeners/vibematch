import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = readFileSync(join(process.cwd(), "server/queries/settings-pending.ts"), "utf8")
// Os comentários explicam JUSTAMENTE o bug (citam "1000 linhas", o `select` sem
// `.range()`), então varrer com eles dentro faria o teste reprovar a própria
// documentação da correção — mesma armadilha do teste irmão de embeddings.
const CODIGO = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")

/**
 * As contagens de pendência de /curation/settings alimentam TRÊS superfícies (badge da
 * sidebar, badge do tópico e a pílula do card), e todas leem `works`, que já passou
 * de 1000 linhas na nuvem. O `select` do PostgREST corta em 1000 SEM erro.
 *
 * 🔴 Medido em 2026-08-18 contra a nuvem: `countMissingEmbeddings` fazia a diferença
 * em JS entre dois selects truncados (1009 obras ativas × 1016 embeddings) e devolvia
 * **15 pendentes** onde o real é **0**. O badge ficava preso num número que nem rodar
 * "Atualizar embeddings" nem recarregar a página conseguiam zerar — não havia o que
 * resolver. No LOCAL (978 obras) os MESMOS selects davam 0: o defeito só nasce depois
 * do corte, e por isso não aparece em nenhuma medição feita na réplica.
 *
 * A régua é o FATO — toda leitura que traz LINHAS passa por paginação —, não a grafia:
 * renomear variável não fura, tirar o `.range()` fura.
 */
describe("contagens de pendência de /curation/settings não truncam em 1000", () => {
  // Cada `.from("<tabela>")` do arquivo, com o trecho que o segue (a query montada).
  const leituras = [...CODIGO.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => ({
    tabela: m[1],
    trecho: CODIGO.slice(m.index ?? 0, (m.index ?? 0) + 420),
  }))

  it("há leituras para varrer (o teste não é vacuamente verde)", () => {
    expect(leituras.length).toBeGreaterThan(0)
  })

  it.each(leituras.map((l, i) => [i, l.tabela] as const))(
    "leitura #%i (%s) pagina ou conta no servidor",
    (i) => {
      const { tabela, trecho } = leituras[i]
      const pagina = trecho.includes(".range(")
      // `count: "exact", head: true` não traz linha nenhuma — não há o que truncar.
      const contaNoServidor = /count:\s*"exact"/.test(trecho) && /head:\s*true/.test(trecho)
      expect(
        pagina || contaNoServidor,
        `a leitura de \`${tabela}\` precisa de .range() (paginada) ou de um count exato com head:true — ` +
          `sem isso o PostgREST corta em 1000 linhas e a contagem mente sem erro`,
      ).toBe(true)
    },
  )

  it("`countMissingEmbeddings` não volta a fazer diferença de conjunto entre duas tabelas", () => {
    const corpo = CODIGO.slice(
      CODIGO.indexOf("export async function countMissingEmbeddings"),
      CODIGO.indexOf("export interface SettingsPendingCounts"),
    )
    expect(corpo.length).toBeGreaterThan(50)
    // O `new Set(...)` sobre uma tabela inteira era o mecanismo do bug: ele exige ler
    // as duas tabelas por completo, e é aí que o corte de 1000 entra sem avisar.
    expect(
      corpo,
      "a contagem tem que ser feita pelo banco (LEFT JOIN + is null), não montando um Set em JS",
    ).not.toContain("new Set(")
    expect(corpo).toContain("work_embeddings!left")
    expect(corpo).toContain('.is("work_embeddings", null)')
  })

  it("erro de contagem NÃO vira zero silencioso dentro da própria função", () => {
    // Zero aqui quer dizer "nada pendente" — o lado errado pra falhar. Quem decide
    // engolir é o chamador (`getSettingsItemPending` já faz `.catch(() => 0)` pra
    // nunca derrubar o layout); a função em si tem que ser honesta.
    const corpo = CODIGO.slice(CODIGO.indexOf("export async function countMissingEmbeddings"))
    expect(corpo.slice(0, 600)).toMatch(/throw new Error/)
  })
})

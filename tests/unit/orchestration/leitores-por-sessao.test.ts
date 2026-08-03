import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariante arquitetural: os leitores de histórico PESSOAL escopam por sessão.
 *
 * Complementa `readers-sem-sessao.test.ts`, que trava os dois leitores centrais
 * (`getScoresReader`, `getPersonalStateReader`) no nível do ARQUIVO. Aqui a granularidade é a
 * FUNÇÃO, porque estes vivem em módulos que legitimamente usam `getCurrentUserId()` noutros
 * lugares (caminhos de escrita e de fundo, onde cair no dono é o comportamento certo) — travar
 * o arquivo inteiro daria falso positivo e o teste seria removido.
 *
 * As três falhavam de dois jeitos diferentes, e é por isso que as duas asserções existem:
 *
 *   - `listRecommendationRuns` e `getRecommendationRun` não tinham filtro NENHUM. Como
 *     "Recomendações" está no menu do topo para deslogado, um visitante anônimo via o
 *     histórico de gosto do dono — títulos, Veredito IA, datas. Medido em 2026-08-03.
 *   - `listAllDeepDives` TINHA `.eq("user_id", …)`, e mesmo assim vazava: resolvia o id por
 *     `getCurrentUserId()`, que sem sessão devolve o singleton (o dono). Filtro presente,
 *     proteção nenhuma — e invisível a scanner, porque o código contém `user_id`.
 *
 * Por isso não basta exigir o filtro: tem que exigir de ONDE vem o id.
 */

const READERS = [
  { file: "server/queries/recommendations.ts", fn: "listRecommendationRuns" },
  { file: "server/queries/recommendations.ts", fn: "getRecommendationRun" },
  { file: "server/queries/deep-dive.ts", fn: "listAllDeepDives" },
]

/** Comentários fora: as menções em prosa (inclusive a este próprio bug) são intencionais. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

/**
 * Corpo da função nomeada, delimitado por CONTAGEM DE CHAVES.
 *
 * A 1ª versão recortava "até a próxima declaração exportada" e capturava funções vizinhas
 * junto — o teste reprovava `getRecommendationRun` por um `getCurrentUserId()` que estava em
 * outra função. Um teste de arquitetura que acusa o arquivo errado é pior que nenhum: ensina
 * a ignorá-lo.
 */
function bodyOf(file: string, fn: string): string {
  const src = stripComments(readFileSync(join(process.cwd(), file), "utf8"))
  const start = src.search(new RegExp(`export\\s+async\\s+function\\s+${fn}\\b`))
  expect(start, `${fn} não encontrada em ${file}`).toBeGreaterThan(-1)

  const open = src.indexOf("{", start)
  expect(open, `${fn}: não achei o corpo`).toBeGreaterThan(-1)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1)
  }
  throw new Error(`${fn}: chaves não fecham em ${file}`)
}

describe("arquitetura: histórico pessoal é escopado por SESSÃO", () => {
  for (const { file, fn } of READERS) {
    it(`${fn} resolve o usuário por getSessionUserId (nunca getCurrentUserId)`, () => {
      const body = bodyOf(file, fn)
      expect(body, `${fn} deve usar getSessionUserId()`).toMatch(/getSessionUserId\s*\(/)
      expect(
        body,
        `${fn} não pode usar getCurrentUserId(): sem sessão ele devolve o DONO`,
      ).not.toMatch(/getCurrentUserId\s*\(/)
    })

    it(`${fn} filtra a query por user_id`, () => {
      const body = bodyOf(file, fn)
      expect(body, `${fn} precisa de .eq("user_id", …)`).toMatch(
        /\.eq\(\s*["']user_id["']/,
      )
    })

    it(`${fn} tem ramo explícito de "sem sessão"`, () => {
      const body = bodyOf(file, fn)
      // Sem o early-return, o resto assume que há usuário — e um `undefined` no `.eq()`
      // não é erro no PostgREST, é um filtro que não filtra.
      expect(body, `faltou o early-return de anônimo em ${fn}`).toMatch(
        /if\s*\(\s*!\s*userId\s*\)\s*return/,
      )
    })
  }
})

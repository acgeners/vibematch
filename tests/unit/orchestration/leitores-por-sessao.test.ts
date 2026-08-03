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
  // Os três Deep Dives da PÁGINA DA OBRA (medidos em 2026-08-03, Chrome sem cookies):
  // `getLastDeepDive` não tinha filtro NENHUM e a aba "Recomendações" servia o badge de match
  // e o one-liner do dono a visitante anônimo. `getDeepDiveById` é pior de outro jeito: o id
  // vem do cliente, então sem filtro qualquer um lê a análise de qualquer um sabendo o UUID.
  { file: "server/queries/deep-dive.ts", fn: "getLastDeepDive" },
  { file: "server/queries/deep-dive.ts", fn: "getDeepDiveHistory" },
  { file: "server/queries/deep-dive.ts", fn: "getDeepDiveById" },
  // Notas de gosto da obra. Resolvia por `getCurrentUserId()` — e a doc da função chamava isso
  // de design. As 8 notas do dono viajavam no payload (`"tasteScores":{…}`) sem aparecer na
  // tela, porque o gate de leitura escondia a seção. Invisível a olho nu, presente no HTML.
  { file: "server/queries/pilot-taste.ts", fn: "getTasteScoresForWork" },
  // Os 4 medidos depois, quando a varredura de `readers-sem-sessao.test.ts` os nomeou. Todos
  // vazavam PRA TELA, não só pro payload — `/favorites`, `/import` e `/ranking` são rotas
  // públicas, e as três mostravam dado do dono a quem chegasse sem cookie nenhum.
  { file: "server/queries/lists.ts", fn: "getListsWithSummary" },
  { file: "server/queries/lists.ts", fn: "getListDetail" },
  { file: "server/queries/lists.ts", fn: "getUngroupedFavorites" },
  { file: "server/queries/lists.ts", fn: "getListsForPicker" },
  { file: "server/queries/lists.ts", fn: "getFavoriteFolderMenu" },
  { file: "server/queries/lists.ts", fn: "countWorksInLists" },
  { file: "server/queries/imports.ts", fn: "getImportHistory" },
  { file: "server/queries/filter-presets.ts", fn: "getFilterPresets" },
  { file: "server/actions/enrich.ts", fn: "getPendingReviewWorks" },
  // Conversas do chat. Estas duas não tinham como filtrar até a migration 175 —
  // `recommendation_chats` não tinha coluna de dono. Eram invisíveis à auditoria que
  // achou as três acima: aquela varredura partia de "tabelas que TÊM dono".
  { file: "server/actions/recommendation-chat.ts", fn: "listChatsAction" },
  {
    file: "server/actions/recommendation-chat.ts",
    fn: "getChatAction",
    // Não consulta direto: repassa o `userId` para este helper, que é quem filtra. A
    // asserção do filtro corre no helper — exigi-la aqui reprovaria código correto, e um
    // teste que acusa o inocente é um teste que alguém apaga.
    delegatesTo: "loadChatBySlug",
  },
]

/** Comentários fora: as menções em prosa (inclusive a este próprio bug) são intencionais. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

/**
 * Onde o CORPO começa — que não é "a primeira `{` depois do nome".
 *
 * `async function f(id: string): Promise<{ scores: … }> {` tem uma chave no TIPO DE RETORNO,
 * e a versão ingênua recortava o tipo como se fosse o corpo. Aconteceu de verdade com
 * `getTasteScoresForWork`: as três asserções reprovaram uma função correta, apontando um
 * trecho que nem código é. Falhou alto, mas ensina a ignorar o teste — que é como um teste
 * de arquitetura morre.
 *
 * Estratégia: fecha a lista de parâmetros contando parênteses; depois disso, uma `{` só é o
 * corpo se estivermos fora de qualquer `<…>` de genérico (`=>` não conta como fechamento).
 */
function bodyStart(src: string, declStart: number): number {
  let i = src.indexOf("(", declStart)
  if (i < 0) return -1
  for (let depth = 0; i < src.length; i++) {
    if (src[i] === "(") depth++
    else if (src[i] === ")" && --depth === 0) break
  }
  let angle = 0
  for (i++; i < src.length; i++) {
    const c = src[i]
    if (c === "<") angle++
    else if (c === ">" && src[i - 1] !== "=") angle--
    else if (c === "{" && angle === 0) return i
  }
  return -1
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
  // Aceita helper privado também: o filtro pode morar numa função não exportada.
  const start = src.search(new RegExp(`(export\\s+)?async\\s+function\\s+${fn}\\b`))
  expect(start, `${fn} não encontrada em ${file}`).toBeGreaterThan(-1)

  const open = bodyStart(src, start)
  expect(open, `${fn}: não achei o corpo`).toBeGreaterThan(-1)
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1)
  }
  throw new Error(`${fn}: chaves não fecham em ${file}`)
}

describe("arquitetura: histórico pessoal é escopado por SESSÃO", () => {
  for (const { file, fn, delegatesTo } of READERS as Array<{
    file: string
    fn: string
    delegatesTo?: string
  }>) {
    it(`${fn} resolve o usuário por getSessionUserId (nunca getCurrentUserId)`, () => {
      const body = bodyOf(file, fn)
      expect(body, `${fn} deve usar getSessionUserId()`).toMatch(/getSessionUserId\s*\(/)
      expect(
        body,
        `${fn} não pode usar getCurrentUserId(): sem sessão ele devolve o DONO`,
      ).not.toMatch(/getCurrentUserId\s*\(/)
    })

    it(`${fn} filtra a query por user_id`, () => {
      if (delegatesTo) {
        // 1) repassa o userId adiante — sem isto o helper filtraria por outra coisa;
        // 2) o helper de fato filtra. As duas juntas fecham a cadeia.
        expect(
          bodyOf(file, fn),
          `${fn} deve repassar o userId para ${delegatesTo}`,
        ).toMatch(new RegExp(`${delegatesTo}\\([^)]*userId`))
        expect(
          bodyOf(file, delegatesTo),
          `${delegatesTo} precisa de .eq("user_id", …)`,
        ).toMatch(/\.eq\(\s*["']user_id["']/)
        return
      }
      // Aceita coluna QUALIFICADA (`imports.user_id`): `getPendingReviewWorks` filtra por
      // embed (`.eq("imports.user_id", …)`), que é filtro igual — exigir a forma nua reprovaria
      // código certo, e teste que acusa inocente é teste que alguém apaga.
      expect(bodyOf(file, fn), `${fn} precisa de .eq("[tabela.]user_id", …)`).toMatch(
        /\.eq\(\s*["'][\w]*\.?user_id["']/,
      )
    })

    it(`${fn} tem ramo explícito de "sem sessão"`, () => {
      const body = bodyOf(file, fn)
      // O guard tem que ser sobre a variável que RECEBEU o id da sessão — `lists.ts` chama a
      // dela de `viewerId`, e travar o nome "userId" reprovaria o arquivo inteiro por estilo.
      // Ancorar na atribuição também impede o falso positivo de um `if (!ids) return` vizinho
      // passar por proteção de sessão.
      const bind = /const\s+(\w+)\s*=\s*await\s+getSessionUserId\s*\(/.exec(body)
      expect(bind, `${fn} precisa atribuir getSessionUserId() a uma variável`).not.toBeNull()
      const id = bind![1]
      // Sem o early-return, o resto assume que há usuário — e um `undefined`/`null` no `.eq()`
      // não é erro no PostgREST, é um filtro que não filtra.
      expect(body, `faltou o early-return de anônimo (!${id}) em ${fn}`).toMatch(
        new RegExp(`if\\s*\\(\\s*!\\s*${id}\\s*\\)\\s*return`),
      )
    })
  }
})

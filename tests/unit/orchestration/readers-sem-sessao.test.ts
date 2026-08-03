import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * Invariante arquitetural: os dois leitores per-usuário resolvem quem está olhando por
 * `getSessionUserId()` (null sem sessão), NUNCA por `getCurrentUserId()`.
 *
 * Por que isto merece um teste e não só um comentário: `getCurrentUserId()` NÃO falha sem
 * sessão — ele devolve o singleton, ou seja, o DONO do catálogo (ver current-user.ts). Trocar
 * um pelo outro não quebra build, não quebra tipo, não gera erro em runtime e não aparece em
 * review: a página renderiza normalmente, só que com o dado de outra pessoa. Foi assim que o
 * visitante anônimo passou a ver a Nota Prevista, os favoritos, o status de leitura e os
 * capítulos lidos do dono como se fossem a avaliação do acervo — e o /ranking e o /titles
 * ordenam por `expected_score` por padrão, então era a ordem do catálogo inteiro que vinha
 * daí. Um erro que produz resultado, que é a classe mais cara deste projeto.
 */
const READERS = [
  { file: "server/queries/user-scores.ts", reader: "getScoresReader" },
  { file: "server/queries/user-work-state.ts", reader: "getPersonalStateReader" },
  // 3º leitor (2026-08-03): a PREVISÃO DE INTERESSE. `synopsis_quality_predictions` não tem
  // `user_id`, mas tem `taste_profile_id` — e ninguém usava esse vínculo, então a previsão
  // do DONO aparecia rotulada "SEU INTERESSE" para qualquer visitante, com a justificativa
  // descrevendo o gosto dele em prosa. Mesma classe dos outros dois, terceira ocorrência.
  { file: "server/queries/user-interest.ts", reader: "getInterestReader" },
]

/** Remove comentários de linha e de bloco — as menções em prosa são intencionais. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
}

describe("arquitetura: leitores per-usuário não caem no dono quando não há sessão", () => {
  for (const { file, reader } of READERS) {
    it(`${file} não usa getCurrentUserId() em código`, () => {
      const code = stripComments(readFileSync(join(process.cwd(), file), "utf8"))
      expect(code, `${reader} deve resolver por getSessionUserId()`).not.toMatch(
        /\bgetCurrentUserId\s*\(/,
      )
    })

    it(`${file} importa getSessionUserId`, () => {
      const code = stripComments(readFileSync(join(process.cwd(), file), "utf8"))
      expect(code).toMatch(/getSessionUserId/)
    })

    it(`${reader} tem ramo explícito para "sem sessão"`, () => {
      const code = stripComments(readFileSync(join(process.cwd(), file), "utf8"))
      // O ramo é `if (!sessionId)` — sem ele, o resto do leitor assume que há usuário.
      expect(code, "faltou o early-return de anônimo").toMatch(/if\s*\(\s*!\s*sessionId\s*\)/)
    })
  }

  it("o leitor de scores devolve hasModel: false para anônimo", () => {
    const code = stripComments(
      readFileSync(join(process.cwd(), "server/queries/user-scores.ts"), "utf8"),
    )
    // Recorta o ramo do anônimo e confere que ele não se declara com modelo — é o que faz o
    // ranking trocar os campos pessoais do sort por platform_avg (ranking.ts, PERSONAL_SORT_FIELDS).
    const branch = code.slice(code.indexOf("if (!sessionId)"))
    const untilNextReturn = branch.slice(0, branch.indexOf("const userId"))
    expect(untilNextReturn).toMatch(/hasModel:\s*false/)
    expect(untilNextReturn).toMatch(/isOwner:\s*false/)
  })
})

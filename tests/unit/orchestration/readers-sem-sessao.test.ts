import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
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
 * capítulos lidos do dono como se fossem a avaliação do acervo — e o /ranking e o /catalog
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

  /**
   * A brecha que deixou passar o vazamento de 2026-08-03: as regras acima travam o MECANISMO
   * (resolver por `getSessionUserId`, ter um ramo de anônimo) e o código cumpria as duas —
   * mas DENTRO do ramo do anônimo devolvia `userId: await getOwnerUserId()`, com um comentário
   * dizendo que era "só para satisfazer o tipo". Não era: `resolvePersonalFilterIds` filtrava
   * `user_work_state` por esse campo e `getFavoritesSummary` o usava como chave de cache, então
   * um visitante sem conta via em `/reading` a lista das obras que o dono acompanha.
   *
   * `getCurrentUserId` não estava envolvido — o id do dono entrou por uma função diferente e
   * legítima em outros contextos. Por isso a regra aqui é sobre o RESULTADO do ramo, não sobre
   * qual função foi chamada: sem sessão, `userId` é `null`.
   */
  for (const { file, reader } of READERS) {
    it(`${reader}: o ramo sem sessão devolve userId null, nunca o id do dono`, () => {
      const code = stripComments(readFileSync(join(process.cwd(), file), "utf8"))
      const i = code.indexOf("if (!sessionId)")
      expect(i, `${file}: não achei o ramo de anônimo`).toBeGreaterThan(-1)
      // Recorta só até o fim do return do ramo — o resto do leitor legitimamente usa ids.
      const branch = code.slice(i, i + 700)
      const ret = branch.slice(0, branch.indexOf("}\n") + 1 || branch.length)

      expect(ret, `${reader}: sem sessão o userId tem que ser null`).toMatch(/userId:\s*null/)
      expect(ret, `${reader}: o ramo de anônimo não pode derivar id do DONO`).not.toMatch(
        /getOwnerUserId|ownerId/,
      )
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

/**
 * VARREDURA (2026-08-03): nenhum arquivo novo combina `getCurrentUserId()` com `.select()`
 * sem passar por classificação humana.
 *
 * As duas listas acima travam leitores CONHECIDOS — e foi exatamente essa a limitação que
 * deixou passar os três vazamentos da página da obra: `getLastDeepDive` (sem filtro nenhum),
 * `getTasteScoresForWork` e o call site de `getExistingPostReadingAssessment` (filtro que
 * resolvia no dono). Nenhum dos três estava em lista nenhuma, e nada apontava pra eles.
 *
 * Este teste inverte o ônus: a varredura acha TODOS os candidatos, e cada um precisa de uma
 * linha dizendo por que está certo. Arquivo novo (ou renomeado) fica vermelho até ser
 * classificado — a falha traz a instrução.
 *
 * ⚠️ Estar em `JUSTIFICADOS` não é prova de ausência de vazamento; é uma AFIRMAÇÃO de quem
 * classificou, com o motivo à vista pra ser contestada. `PENDENTES` é a lista honesta do que
 * ninguém mediu ainda — ela pode encolher, nunca crescer.
 */
const JUSTIFICADOS: Record<string, string> = {
  "server/queries/current-user.ts": "é a casa do próprio getCurrentUserId",
  "server/actions/calculations.ts":
    "recalculateAll: fila global do DONO, roda sem sessão em background (CLAUDE.md)",
  "lib/server/predictions/record-prediction.ts":
    "ledger de previsões: escrita em after()/cascata, sem sessão por definição; mede o modelo do dono",
  "lib/server/predictions/resolve-prediction.ts": "idem record-prediction (resolve/relabel do ledger)",
  "server/queries/deep-dive.ts":
    "único uso restante é getBiasMap na GERAÇÃO do dive (write path, dentro da action paga)",
  "server/queries/recommendations.ts":
    "funções do RANKER (candidatos, bias, perfil): geração, chamada de dentro da action; os dois leitores de HISTÓRICO já foram escopados e vivem em leitores-por-sessao.test.ts",
  "lib/ai-recommendation/taste-profile.ts":
    "loadCurrentTasteProfile aceita userId explícito (recalc passa o dele); o consumo na página da obra é server-side — medido 2026-08-03 numa obra com tag declarada pelo dono: nada do perfil dele no payload anônimo",
  "server/queries/tag-preferences.ts":
    "getTagPreferenceRows aceita userIdOverride (recalc per-user usa); consumo na página da obra medido junto com o taste_profile, sem vazamento",
  "server/queries/attribute-bias.ts":
    "getAttributeBiasOverview só renderiza em /curation/settings (console), gateada no middleware",
  "server/queries/calibration-guards.ts": "métricas do modelo: rota de console, gateada no middleware",
}

/**
 * Os 4 que entraram aqui como "NÃO MEDIDO" em 2026-08-03 foram medidos no mesmo dia — e os 4
 * vazavam. `/favorites` mostrava os nomes das pastas do dono e "109 favoritos cadastrados" a
 * visitante anônimo; `/import`, o histórico dele ("Última importação anteontem · Lista de
 * títulos"); `/ranking`, "Salvos (1)" com o nome do preset no payload; e a fila de revisão
 * levava o título da obra dele. Todos corrigidos e agora travados por função em
 * `leitores-por-sessao.test.ts`.
 *
 * A lista está VAZIA de propósito. Ela volta a ter item quando alguém achar um candidato e não
 * puder medir na hora — nunca como estacionamento de dívida.
 */
const PENDENTES: Record<string, string> = {}

function sweep(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(".") || entry === "node_modules") continue
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) sweep(p, out)
    else if (/\.tsx?$/.test(p)) {
      const code = stripComments(readFileSync(p, "utf8"))
      if (/getCurrentUserId\s*\(/.test(code) && /\.select\s*\(/.test(code)) out.push(p)
    }
  }
  return out
}

describe("arquitetura: quem mistura getCurrentUserId com .select() está classificado", () => {
  const encontrados = ["server", "app", "lib", "components"]
    .flatMap((d) => sweep(join(process.cwd(), d)))
    .map((p) => p.slice(process.cwd().length + 1))
    .sort()

  const classificados = new Set([...Object.keys(JUSTIFICADOS), ...Object.keys(PENDENTES)])

  it("não há arquivo NOVO sem classificação", () => {
    const novos = encontrados.filter((f) => !classificados.has(f))
    expect(
      novos,
      `Arquivo(s) novo(s) combinando getCurrentUserId() + .select().\n` +
        `getCurrentUserId() devolve o DONO quando não há sessão — numa LEITURA que a página ` +
        `renderiza, isso serve o dado dele a quem não é ele.\n` +
        `Se for leitura per-usuário: troque por getSessionUserId() + early-return.\n` +
        `Se for escrita/background (recalc, after(), cascata): adicione em JUSTIFICADOS com o motivo.`,
    ).toEqual([])
  })

  it("a lista não guarda arquivo que não existe mais", () => {
    const fantasmas = [...classificados].filter((f) => !encontrados.includes(f))
    expect(fantasmas, "classificação obsoleta — remova destas listas").toEqual([])
  })

  it("a lista de PENDENTES continua vazia", () => {
    // Zerou em 2026-08-03, quando os 4 candidatos foram medidos (os 4 vazavam) e corrigidos.
    // Subir daqui é decisão explícita de quem não puder medir na hora — e some no teste.
    expect(Object.keys(PENDENTES)).toEqual([])
  })
})

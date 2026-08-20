import {
  clampAdultContentScore,
  type AdultContentBounds,
} from "@/lib/ai-evaluation/adult-content-rules"
import { realinharFaixaCitada } from "@/lib/criteria/justification"

/**
 * DONO ÚNICO do par (nota, texto) quando um limite de `adult_content` age.
 *
 * 🔴 Existiam DOIS caminhos escrevendo a mesma nota, e só um escrevia a explicação. O fluxo de
 * avaliação (`enforceAdultContentBounds`) anexava a razão e realinhava a faixa citada; o
 * `scripts/adult-content-retroactive-bounds.ts` fazia `update({ score })` e ia embora. Como o
 * script roda toda vez que uma tag ganha `adult_score_tier` — e há ~119 tags no backlog de
 * revisão —, ele reabastecia o defeito sozinho. Medido na nuvem em 2026-08-20, nas 987 notas de
 * `adult_content` com texto:
 *
 * | | |
 * |---|---|
 * | notas FORA do piso/teto vigente | **0** — os números estavam certos |
 * | nota movida e o texto sem razão nenhuma | **89** |
 * | o texto cita um limite DIFERENTE do que vale hoje | **7** |
 * | o MODELO narra a regra determinística na prosa | **81** |
 *
 * 🔴 **A raiz das três últimas linhas é a mesma: a razão da regra estava sendo escrita pelo
 * MODELO.** Ele não tem como saber qual camada venceu — e narrou errado em 5 casos conferidos um
 * a um, sempre no sentido caro: obra com teto 6,0 pela tag "R15 but Based on a R19 Novel" com a
 * prosa afirmando *"aplica piso obrigatório de 7.0"*, que é exatamente o contrário do que a
 * precedência manda. A razão tem um dono (`computeAdultContentBounds().reasons`) e é ele quem
 * precisa aparecer.
 *
 * ⚠️ **Isto NÃO reescreve o argumento do modelo** — mesma régua do `backfill-faixa-citada`. A
 * análise dele fica inteira, inclusive quando contradiz o limite: é ela a evidência de que a
 * regra e a leitura da obra discordam, e é isso que faz a curadora olhar o caso. O que se
 * acrescenta é quem decidiu o número.
 */
export interface LimiteAdultoAplicado {
  score: number
  justification: string
  /** O limite MOVEU a nota? `false` quando ela já estava dentro da faixa. */
  aplicou: boolean
  /** A razão foi acrescentada ao texto agora? `false` quando já estava lá. */
  razaoAcrescentada: boolean
}

/**
 * Apaga o CONTEÚDO dos parênteses, mantendo o resto — é o que torna duas razões da mesma
 * camada comparáveis.
 *
 * ⚠️ Sem isto a comparação por igualdade literal não basta, e o motivo é medido: as razões
 * carregam a lista de tags que acionou a camada (`tag "Masturbation"; tag "Anal Sex"`), e essa
 * lista muda quando UMA tag é revisada (`adult_score_tier`). Como o script roda de novo a cada
 * revisão de tier, sem normalizar ele empilharia uma segunda razão quase idêntica no mesmo
 * parágrafo, para sempre.
 *
 * 🔴 Só o miolo dos parênteses é neutralizado — a frase da camada e o NÚMERO do limite ficam.
 * É isso que faz "piso 7,0 por rótulo" e "piso 9,0 por ato explícito" continuarem sendo razões
 * DIFERENTES: quando a camada muda, a razão nova precisa mesmo entrar.
 */
function semListaDeTags(texto: string): string {
  return texto.replace(/\([^)]*\)/g, "()")
}

/** O texto já carrega esta razão? Compara por uma ASSINATURA estável, não pela string inteira. */
function jaTemRazao(justificativa: string, razao: string): boolean {
  if (!razao) return true
  if (justificativa.includes(razao)) return true
  return semListaDeTags(justificativa).includes(semListaDeTags(razao))
}

/**
 * Aplica piso/teto à nota E acerta o texto que a acompanha.
 *
 * Devolve a nota inalterada e o texto inalterado quando não há limite ou quando ele não move
 * nada — com UMA exceção deliberada: se o limite existe e a nota já está na faixa **porque um
 * clamp anterior a colocou lá**, o texto continua precisando dizer isso. Quem distingue os dois
 * casos é o `baseline`: a nota que o MODELO propôs.
 *
 * @param baseline nota que a avaliação entregou (`ai_evaluation_scores.suggested_score`).
 *   🔴 Não passe a nota já persistida: `clampAdultContentScore` só empurra PARA DENTRO da faixa,
 *   então reaplicá-lo sobre a nota ajustada é idempotente para piso que sobe e **inerte para
 *   piso que desce** — o script diria "nada a fazer" e um limite obsoleto ficaria congelado.
 */
export function aplicarLimiteAdulto(
  baseline: number,
  justificativa: string,
  bounds: Pick<AdultContentBounds, "floor" | "ceiling" | "reasons">,
): LimiteAdultoAplicado {
  const clamped = clampAdultContentScore(baseline, bounds)
  const razao = bounds.reasons.join(" ")
  const moveu = clamped !== baseline

  // Sem limite nenhum: não há o que dizer, e acrescentar texto seria inventar procedência.
  if (bounds.floor == null && bounds.ceiling == null) {
    return { score: clamped, justification: justificativa, aplicou: false, razaoAcrescentada: false }
  }

  const precisaRazao = moveu && !jaTemRazao(justificativa, razao)
  const comRazao = precisaRazao ? `${justificativa.trimEnd()} ${razao}` : justificativa

  return {
    score: clamped,
    /**
     * ⚠️ A ordem (anexar → realinhar) é INDIFERENTE hoje, e isto está conferido com sonda:
     * inverter mantém as 10 asserções verdes. `realinharFaixaCitada` casa a PRIMEIRA "Faixa
     * X-Y" do texto, e nenhuma das razões de `computeAdultContentBounds` usa esse formato —
     * elas dizem "adult_content ≥ 9.0", "TETO 6.0", "a faixa correta é 9-10".
     *
     * 🔴 Escrevi aqui que a ordem importava ANTES de testar, e a sonda me desmentiu. Fica o
     * registro porque a dependência é real e frágil: no dia em que uma razão citar "Faixa
     * X-Y" literalmente, anexá-la antes do realinhamento faz o regex casar DENTRO da razão. É
     * uma linha para não reescrever no automático, não uma invariante que o teste protege.
     */
    justification: moveu ? realinharFaixaCitada(comRazao, clamped) : comRazao,
    aplicou: moveu,
    razaoAcrescentada: precisaRazao,
  }
}

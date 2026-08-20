/**
 * QUEM decidiu a nota que a ficha exibe.
 *
 * 🔴 A régua desta base é "nota trocada diz QUEM trocou" — e ela tinha um buraco de terceiro
 * autor. A página creditava `ai_edited` ("Ajustada por você") e `ai_calibrated` ("Ajustada pela
 * auditoria"), mas a nota movida pelo LIMITE de `adult_content` fica com `source: ai_accepted`
 * e não dizia nada. Medido na nuvem em 2026-08-20: **85 obras** com a nota movida e o limite
 * explicando exatamente o valor, **83** sem nenhum outro autor possível.
 *
 * ⚠️ Este módulo existe porque a resposta é consumida por DOIS lados que precisam concordar: o
 * card da obra (que imprime o crédito) e `scripts/coherence-audit.ts --tela` (que audita se
 * alguma ficha ficou órfã). Com a régua escrita duas vezes, a auditoria aprovaria exatamente as
 * fichas que a tela deixa sem autor — o instrumento confirmaria o defeito que existe para pegar.
 */
export type AutorDaNota =
  /** A nota é a que o modelo propôs. */
  | "modelo"
  /** A curadora trocou o número (`ai_edited`). */
  | "curadoria"
  /** A auditoria de calibração reescreveu (`ai_calibrated`). */
  | "auditoria"
  /** Um piso/teto obrigatório moveu a nota — o `source` continua `ai_accepted`. */
  | "limite"
  /**
   * A nota foi movida e NINGUÉM assume.
   *
   * 🔴 Isto é um valor próprio, não `"modelo"`, e a diferença é o ponto do módulo: na tela os
   * dois se parecem (nenhum crédito aparece), mas só um é defeito. Colapsá-los faria a
   * auditoria contar ficha órfã como saudável — o instrumento aprovando o que existe para pegar.
   */
  | "orfa"

/** Diferença mínima para dizer que alguém MOVEU a nota (as notas andam de 0,5 em 0,5). */
const EPSILON = 0.05

export function autorDaNota(args: {
  /** `category_scores.source`. */
  source: string | null | undefined
  /** A nota que a tela mostra (`category_scores.score`). */
  exibida: number | null | undefined
  /** A nota que a avaliação entregou (`ai_evaluation_scores.suggested_score`). */
  proposta: number | null | undefined
  /**
   * O piso/teto vigente explica EXATAMENTE a nota exibida?
   * 🔴 "A nota subiu e existe um piso" NÃO basta — quem decide é
   * `clampAdultContentScore(proposta, bounds) === exibida`. Medido: 4 notas do catálogo estão
   * movidas por caminhos que este crédito não deve reivindicar.
   */
  limiteExplica: boolean
}): AutorDaNota {
  const { source, exibida, proposta, limiteExplica } = args
  if (exibida == null || proposta == null) return "modelo"
  if (Math.abs(exibida - proposta) < EPSILON) return "modelo"

  /**
   * ⚠️ A ORDEM é humano → auditoria → limite, e não é arbitrária: quando a curadora escolhe o
   * mesmo número que o limite imporia — aconteceu em 2 obras —, nenhum dado distingue quem
   * decidiu, e creditar a máquina por uma decisão dela é o mais caro dos dois erros.
   */
  if (source === "ai_edited") return "curadoria"
  if (source === "ai_calibrated") return "auditoria"
  if (limiteExplica) return "limite"

  return "orfa"
}

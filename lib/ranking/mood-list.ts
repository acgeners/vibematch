/**
 * Mood aplicado a uma LISTA (não a um cluster de tier) — dono único.
 *
 * O refino nasceu como desempate de um punhado de obras empatadas, aberto pelo
 * divisor de tier. Aplicá-lo à lista inteira é a mesma conta, mas com uma
 * diferença que NÃO é detalhe: `computeMoodFit` normaliza cada dimensão pelo
 * min/max do CONJUNTO que recebe, então o mesmo mood sobre conjuntos diferentes
 * produz ordens diferentes.
 *
 * 🔴 Medido em 2026-08-16 sobre as 126 favoritas do clone local: aplicando o
 * mesmo mood à lista inteira × a janelas de 5 obras, a ordem das mesmas 5 obras
 * DIVERGE em até 17 de 25 janelas (combo de 4 dimensões; 14/25 com dois
 * atributos). Ou seja, se a lista ordenar por um conjunto e o comparador
 * recalcular por outro, as duas telas discordam sobre a mesma pergunta — a
 * família "mesma função, CONJUNTOS diferentes" do `/descobrir`.
 *
 * Daí este módulo devolver, além da ordem, o MAPA de valores ajustados: quem
 * abrir o comparador a partir da lista herda os números daqui em vez de
 * recalcular sobre o subconjunto selecionado.
 *
 * ⚠️ A ordem das duas operações importa e é a mesma da prévia: EXCLUIR primeiro,
 * normalizar depois. Uma obra excluída não pode participar do min/max de uma
 * dimensão — senão ela continua esticando a régua de uma lista da qual ela saiu.
 */

import {
  computeMoodAdjusted,
  filterMoodWorks,
  isMoodActive,
  type MoodCriterionRanges,
  type MoodRefine,
  type MoodWork,
} from "@/lib/calculations/mood-refine"

export interface MoodListResult<T extends MoodWork> {
  /** As obras que sobreviveram às exclusões, na ordem da Prioridade ajustada. */
  works: T[]
  /**
   * Prioridade ajustada por obra. Vazio quando não há mood ativo — e vazio é o
   * sinal de "mostre o número base", nunca "o ajuste deu zero".
   */
  adjusted: Map<string, number | null>
  active: boolean
}

/**
 * Aplica o mood a uma lista: filtra as exclusões, calcula a Prioridade ajustada
 * sobre o que sobrou e devolve a lista reordenada.
 *
 * Sem mood ativo devolve a entrada INTACTA (mesma referência de ordem), porque
 * a ordenação escolhida pela pessoa é quem manda enquanto não há refino.
 */
export function applyMoodToList<T extends MoodWork>(
  works: T[],
  mood: MoodRefine | null | undefined,
  ranges?: MoodCriterionRanges,
): MoodListResult<T> {
  if (!mood || !isMoodActive(mood)) {
    return { works, adjusted: new Map(), active: false }
  }

  const kept = filterMoodWorks(works, mood)
  const adjusted = computeMoodAdjusted(kept, mood, ranges)
  const ordered = [...kept].sort((a, b) => {
    const av = adjusted.get(a.id)
    const bv = adjusted.get(b.id)
    return (bv ?? -Infinity) - (av ?? -Infinity)
  })

  return { works: ordered, adjusted, active: true }
}

/**
 * Quantas dimensões o mood tem ligadas — o número que o chip da barra mostra.
 * Conta o que MOVE a ordem (atributos, práticas, capítulos) separado do que
 * TIRA obras da lista, porque as duas coisas se desfazem por caminhos
 * diferentes e somá-las num número só esconde qual delas está agindo.
 */
export function moodDimensionCount(mood: MoodRefine | null | undefined): {
  weights: number
  exclusions: number
} {
  if (!mood) return { weights: 0, exclusions: 0 }
  return {
    weights:
      Object.keys(mood.attributes ?? {}).length +
      Object.keys(mood.practical ?? {}).length +
      (mood.chapters ? 1 : 0),
    exclusions: mood.exclude?.length ?? 0,
  }
}

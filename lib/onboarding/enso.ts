/**
 * A meta do ensō: com 20 notas a Nota Prevista liga. É o `MIN_TRAIN_EXPECTED` do treino
 * (`lib/calculations/expected.ts`), copiado aqui porque aquele módulo arrasta o Ridge para o
 * navegador; `tests/unit/onboarding/enso-meta.test.ts` reprova se os dois divergirem.
 */
export const ENSO_GOAL = 20

/**
 * Depois das 20 notas o ensō deixa de contar até a meta e passa a mostrar quantas obras da pessoa
 * já têm nota: "252 de 290 obras". Numerador e denominador são do MESMO conjunto — toda obra com
 * nota (em qualquer status, inclusive Untracked) mais as lidas ou começadas sem nota. Com só as lidas
 * no denominador, "252 de 286" contaria em cima obras que não estão embaixo e poderia passar de 100%.
 */
export interface RateCoverage {
  /** Obras com nota: as que já tinham ao abrir mais as dadas nesta visita. */
  rated: number
  /** Sem nota, com a escala liberada, na lista. */
  waiting: number
  /** Sem nota e ainda no começo (escala travada), na lista. */
  early: number
  /** Sem nota e FORA da lista, que mostra só as mais recentes (`IMPORTED_UNRATED_LIMIT`). */
  beyond: number
  total: number
  /** Para baixo: nunca diz 100% antes da hora. */
  pct: number
}

export function rateCoverage(input: {
  ratedAtOpen: number
  ratedHere: number
  waiting: number
  early: number
  /** Lidas sem nota ao abrir, contadas no servidor (sem o teto da lista). */
  unratedAtOpen: number
  /** Quantas dessas a lista trouxe ao abrir. */
  listedAtOpen: number
}): RateCoverage {
  const rated = input.ratedAtOpen + input.ratedHere
  const beyond = Math.max(0, input.unratedAtOpen - input.listedAtOpen)
  const total = rated + input.waiting + input.early + beyond
  const pct = total > 0 ? Math.floor((rated / total) * 100) : 0
  return { rated, waiting: input.waiting, early: input.early, beyond, total, pct }
}

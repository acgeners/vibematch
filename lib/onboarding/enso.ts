/**
 * A meta do ensō: com 20 notas a Nota Prevista liga. É o `MIN_TRAIN_EXPECTED` do treino
 * (`lib/calculations/expected.ts`), copiado aqui porque aquele módulo arrasta o Ridge para o
 * navegador; `tests/unit/onboarding/enso-meta.test.ts` reprova se os dois divergirem.
 */
export const ENSO_GOAL = 20

/**
 * Depois das 20 notas o ensō deixa de contar até a meta e passa a mostrar quantas obras que a pessoa
 * PODE avaliar já têm nota: "259 de 263 obras". Numerador e denominador são do MESMO conjunto — toda
 * obra com nota (em qualquer status, inclusive Untracked) mais as lidas sem nota que já passam na trava
 * de leitura (`canRateReadingState`). As travadas (até 20% lido) ficam FORA da conta (decisão de
 * 22/11/2026): contá-las prometia uma porcentagem que a pessoa não tem como alcançar agora.
 */
export interface RateCoverage {
  /** Obras com nota: as que já tinham ao abrir mais as dadas nesta visita. */
  rated: number
  /** Sem nota, com a escala liberada, na lista. */
  waiting: number
  /** Sem nota e liberadas, FORA da lista (que mostra só as mais recentes, `IMPORTED_UNRATED_LIMIT`). */
  beyond: number
  /** Sem nota e travadas (até 20% lido), na lista e fora dela — fora da conta, só informadas. */
  early: number
  total: number
  /** Para baixo: nunca diz 100% antes da hora. */
  pct: number
}

export function rateCoverage(input: {
  ratedAtOpen: number
  ratedHere: number
  /** Agora, na lista: sem nota e liberadas, e travadas. */
  waiting: number
  early: number
  /** Lidas sem nota ao abrir, contadas no servidor sem o teto da lista e separadas pela trava. */
  unrated: { rateable: number; locked: number }
  /** As mesmas duas contagens, só das obras que a lista trouxe ao abrir. */
  listed: { rateable: number; locked: number }
}): RateCoverage {
  const rated = input.ratedAtOpen + input.ratedHere
  const beyond = Math.max(0, input.unrated.rateable - input.listed.rateable)
  const early = input.early + Math.max(0, input.unrated.locked - input.listed.locked)
  const total = rated + input.waiting + beyond
  const pct = total > 0 ? Math.floor((rated / total) * 100) : 0
  return { rated, waiting: input.waiting, beyond, early, total, pct }
}

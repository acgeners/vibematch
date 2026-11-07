/**
 * A régua ÚNICA de "esta resposta traz os 11 critérios": cada critério canônico exatamente uma vez,
 * nenhum desconhecido, nota e justificativa válidas. Dona de três decisões que antes moravam em
 * lugares diferentes, com réguas diferentes:
 *
 * - aceitar a resposta da tool (`interpretarRespostaDaTool`) — o Zod de lá só confere o FORMATO de
 *   cada registro, não o conjunto;
 * - recuperar um payload recusado (`tool-payload-recovery.ts`) — as regras novas exigem os 11;
 * - servir uma avaliação gravada como cache (`readDbCache`).
 *
 * 🔴 Por que existe: até 2026-10-23 a montagem completava o critério ausente com nota 5 e
 * "Não avaliado." em silêncio, e a resposta entrava como avaliação completa. Observado no piloto
 * v32 × v3.1 (24/10): o modelo mandou 1 dos 11 atributos e o produto teria aceitado os outros 10
 * inventados. No backup de 19/10 o caso aparece 1 vez em 2.645 avaliações (v20, julho).
 *
 * Pura e sem log: quem chama decide o que fazer com a conferência.
 */

/** O texto que a montagem antiga escrevia no critério ausente. Uma justificativa com ESTE texto é
 *  marca de preenchimento, não de avaliação — inclusive numa linha antiga lida do banco. */
export const JUSTIFICATIVA_DE_PREENCHIMENTO = "Não avaliado."

export interface ConferenciaDosCriterios {
  /** Os 11, cada um uma vez, com nota e justificativa válidas, e nenhum critério a mais. */
  completa: boolean
  /** Critérios canônicos recebidos uma única vez e válidos, na ordem em que vieram. */
  recebidos: string[]
  /** Critérios canônicos que não vieram nenhuma vez. */
  ausentes: string[]
  /** Critérios canônicos que vieram mais de uma vez — nenhuma das cópias é usada. */
  duplicados: string[]
  /** Registros cujo critério não é canônico (o valor recebido) ou que nem trazem critério. */
  desconhecidos: string[]
  /** Critérios canônicos recebidos uma vez, com nota ou justificativa inválida. */
  invalidos: string[]
}

const SEM_CRITERIO = "(registro sem critério)"

function notaValida(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10
}

function justificativaValida(v: unknown): v is string {
  if (typeof v !== "string") return false
  const t = v.trim()
  return t.length > 0 && t !== JUSTIFICATIVA_DE_PREENCHIMENTO
}

/**
 * Confere um `scores` qualquer (o da tool, já parseado, ou as linhas gravadas convertidas para a mesma
 * forma `{ criterion, score, justification }`) contra a lista canônica. Não lança e não altera nada.
 */
export function conferirCriterios(scores: unknown, criterionSlugs: readonly string[]): ConferenciaDosCriterios {
  const canonicos = new Set(criterionSlugs)
  const ocorrencias = new Map<string, unknown[]>()
  const ordem: string[] = []
  const desconhecidos: string[] = []

  for (const s of Array.isArray(scores) ? scores : []) {
    const r = s !== null && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : null
    const criterion = r?.criterion
    if (typeof criterion !== "string") {
      desconhecidos.push(SEM_CRITERIO)
      continue
    }
    if (!canonicos.has(criterion)) {
      desconhecidos.push(criterion)
      continue
    }
    if (!ocorrencias.has(criterion)) {
      ocorrencias.set(criterion, [])
      ordem.push(criterion)
    }
    ocorrencias.get(criterion)!.push(r)
  }

  const recebidos: string[] = []
  const duplicados: string[] = []
  const invalidos: string[] = []
  for (const criterion of ordem) {
    const regs = ocorrencias.get(criterion)!
    if (regs.length > 1) {
      duplicados.push(criterion)
      continue
    }
    const r = regs[0] as Record<string, unknown>
    if (notaValida(r.score) && justificativaValida(r.justification)) recebidos.push(criterion)
    else invalidos.push(criterion)
  }
  const ausentes = criterionSlugs.filter((c) => !ocorrencias.has(c))

  return {
    completa:
      Array.isArray(scores) &&
      recebidos.length === criterionSlugs.length &&
      desconhecidos.length === 0 &&
      duplicados.length === 0 &&
      invalidos.length === 0,
    recebidos,
    ausentes,
    duplicados,
    desconhecidos,
    invalidos,
  }
}

/** Uma frase para log e diagnóstico, com só os grupos que não estão vazios. */
export function descreverConferencia(c: ConferenciaDosCriterios, total: number): string {
  const partes = [`veio ${c.recebidos.length} de ${total} critérios válidos`]
  if (c.ausentes.length) partes.push(`ausentes: ${c.ausentes.join(", ")}`)
  if (c.duplicados.length) partes.push(`repetidos: ${c.duplicados.join(", ")}`)
  if (c.desconhecidos.length) partes.push(`desconhecidos: ${c.desconhecidos.join(", ")}`)
  if (c.invalidos.length) partes.push(`nota ou justificativa inválida: ${c.invalidos.join(", ")}`)
  return partes.join("; ")
}

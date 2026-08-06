import { computeWorkForces, classifyArchetypeByPercentile } from "@/lib/calculations/forces"
import type { ForceArchetype } from "@/lib/calculations/forces"

/**
 * DE QUE um tier é feito — a composição por tipo de aposta.
 *
 * O divisor de tier diz hoje "38 obras de prioridade equivalente" e para. Só que
 * "equivalente" é verdade só na Nota Prevista: dentro do mesmo tier convivem 13
 * apostas arriscadas, 10 de nicho, 8 pra pular e 7 seguras (medido no acervo em
 * 2026-08-06). Este módulo devolve essa contagem para o cabeçalho mostrá-la.
 *
 * ⚠️ **Percentil sobre o CONJUNTO EXIBIDO, não sobre o tier.** É a mesma escolha
 * da Bússola, e por um motivo forte: o arquétipo precisa querer dizer a mesma
 * coisa em todos os tiers da mesma tela. Se cada tier normalizasse por si, o
 * mediano do tier 1 e o mediano do tier 5 receberiam o mesmo rótulo — e eles não
 * são a mesma aposta.
 *
 * Puro, sem I/O.
 */

export type { ForceArchetype }

export interface CompositionInput {
  chanceScore: number | null
  platformAvg: number | null
  totalVotes: number | null
}

/**
 * Rótulo de cada arquétipo no divisor de tier.
 *
 * 🔴 **Divergência conhecida, de propósito.** A Bússola (`bussola-plane.tsx`) tem
 * a própria cópia com outra redação — "Aposta segura", "Alto potencial", "Teu
 * nicho", "Provável pular" — e ela também nomeia os cantos de cada face. Não
 * unifiquei aqui para não reescrever, de carona, a copy de uma view que este
 * trabalho não toca. Ao mexer na Bússola, apagar o mapa de lá e importar este.
 */
export const ARCHETYPE_LABEL: Record<ForceArchetype, string> = {
  safe: "pode ir sem medo",
  upside: "vale o risco",
  niche: "só teu gosto",
  skip: "fica pra depois",
}

/** Ordem de exibição: da aposta mais acionável para a menos. */
export const ARCHETYPE_ORDER: readonly ForceArchetype[] = ["safe", "upside", "niche", "skip"] as const

/** midrank — empate divide a posição, igual ao percentil da Bússola. */
function percentileFn(values: number[]): (v: number | null) => number {
  const sorted = [...values].sort((a, b) => a - b)
  return (v) => {
    if (v == null || sorted.length === 0) return 50
    let less = 0
    let eq = 0
    for (const x of sorted) {
      if (x < v) less++
      else if (x === v) eq++
    }
    return ((less + eq / 2) / sorted.length) * 100
  }
}

/**
 * Arquétipo de cada obra, na ordem de entrada. `null` quando faltam as duas
 * forças que o definem (Chance e Avaliação) — sem elas não há aposta a nomear.
 */
export function archetypesOf(items: readonly CompositionInput[]): (ForceArchetype | null)[] {
  const forces = items.map((i) =>
    computeWorkForces({
      chanceScore: i.chanceScore,
      platformAvg: i.platformAvg,
      totalVotes: i.totalVotes,
    }),
  )
  const pctChance = percentileFn(forces.map((f) => f.chance).filter((v): v is number => v != null))
  const pctAval = percentileFn(forces.map((f) => f.avaliacao).filter((v): v is number => v != null))

  return forces.map((f) => {
    if (f.chance == null && f.avaliacao == null) return null
    return classifyArchetypeByPercentile(pctChance(f.chance), pctAval(f.avaliacao))
  })
}

export type ArchetypeComposition = Array<{ archetype: ForceArchetype; count: number }>

/**
 * Contagem por arquétipo de um subconjunto (um tier), em `ARCHETYPE_ORDER` e
 * **omitindo os zerados** — um chip "0 vale o risco" só ocuparia espaço.
 */
export function compositionOf(archetypes: readonly (ForceArchetype | null)[]): ArchetypeComposition {
  const counts = new Map<ForceArchetype, number>()
  for (const a of archetypes) {
    if (a == null) continue
    counts.set(a, (counts.get(a) ?? 0) + 1)
  }
  return ARCHETYPE_ORDER.filter((a) => counts.has(a)).map((a) => ({ archetype: a, count: counts.get(a)! }))
}

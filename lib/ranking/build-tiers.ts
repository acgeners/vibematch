import { tierBandWidthSchema } from "./tier-config"

/**
 * Formação de tiers (bandas) do ranking — função PURA e testável.
 *
 * Regras:
 *  - Tier ancorado na PRIMEIRA obra do tier (não encadeado): uma obra entra no
 *    tier corrente sse `anchorScore - score <= bandWidth` (limite INCLUSIVO).
 *    Assim `[8.0, 7.7, 7.4]` com banda 0.5 vira `[8.0, 7.7] / [7.4]` (e nunca as
 *    três juntas por encadeamento 8.0↔7.7↔7.4).
 *  - Scores inválidos (`null`/`undefined`/`NaN`/`±Infinity`) NÃO quebram os tiers:
 *    vão todos para um ÚLTIMO tier.
 *  - Não depende da ordem acidental da entrada: ordena internamente por score
 *    desc (estável por índice) para COMPUTAR os tiers, mas devolve o resultado
 *    ALINHADO à ordem de entrada.
 *
 * 🔴 **`getScore` TEM que ser a MESMA chave pela qual a lista está ordenada.**
 * Quem consome agrupa RUNS CONSECUTIVOS de tier igual; se o score do tier não for
 * o da ordenação, um mesmo tier reaparece várias vezes ao longo da lista e vira
 * vários blocos "Tier N" — sem erro, só com a tela mentindo sobre quantas faixas
 * existem. Medido (2026-08-06): o /ranking ordena pela nota EXIBIDA
 * (`roundToDisplayScore`) e bandava pela CRUA → **2 tiers reais viravam 8 blocos**
 * nas 40 primeiras obras, e 3 viravam 27 em 200. Na view Faixas isso ainda
 * duplicava a React key (`band-${tier}`).
 */
export interface TieredItem<T> {
  item: T
  /** Tier 1-based; tiers maiores = scores menores; inválidos no último tier. */
  tier: number
}

export function buildRankingTiers<T>(
  items: readonly T[],
  getScore: (item: T) => number | null | undefined,
  bandWidth: number,
): TieredItem<T>[] {
  const parsed = tierBandWidthSchema.safeParse(bandWidth)
  if (!parsed.success) {
    throw new Error(`buildRankingTiers: bandWidth inválido (${String(bandWidth)}); esperado entre 0.05 e 2`)
  }
  const bw = parsed.data

  const result = new Array<TieredItem<T>>(items.length)
  const valid: Array<{ idx: number; score: number }> = []
  const invalid: number[] = []

  items.forEach((item, idx) => {
    const s = getScore(item)
    if (typeof s === "number" && Number.isFinite(s)) valid.push({ idx, score: s })
    else invalid.push(idx)
  })

  // Ordena por score desc; empate → preserva ordem de entrada (estável por idx).
  valid.sort((a, b) => b.score - a.score || a.idx - b.idx)

  let tier = 0
  let anchor: number | null = null
  for (const v of valid) {
    if (anchor === null || anchor - v.score > bw) {
      tier += 1
      anchor = v.score
    }
    result[v.idx] = { item: items[v.idx], tier }
  }

  if (invalid.length > 0) {
    tier += 1
    for (const idx of invalid) result[idx] = { item: items[idx], tier }
  }

  return result
}

/** Campos mínimos para o desempate dentro do tier. */
export interface TieBreakFields {
  /** Overlap de tags do perfil efetivo (LLM + declaradas). Sinal primário. */
  tagOverlapNet: number | null
  /** Nota Prevista — desempate secundário (sutil, pois dentro do tier é ~igual). */
  expectedScore: number | null
}

const finiteOr = (v: number | null | undefined, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback

/**
 * Comparador PURO do desempate DENTRO de um tier (obras ~empatadas em expected).
 *
 * Ordena por `tagOverlapNet` desc — overlap de tags do perfil EFETIVO (LLM +
 * preferências declaradas). Substitui `personal_fit` nesse papel (auditoria
 * 2026-06: personal_fit ~constante e ordena pior que o acaso intra-tier; o
 * overlap de tags separa melhor). Empate → desempata por `expectedScore` desc.
 * Sem `tagOverlapNet` (perfil stub/sem tags) → afunda para o fim do tier.
 */
export function compareWithinTierTieBreak(a: TieBreakFields, b: TieBreakFields): number {
  const an = finiteOr(a.tagOverlapNet, -Infinity)
  const bn = finiteOr(b.tagOverlapNet, -Infinity)
  if (an !== bn) return bn - an
  return finiteOr(b.expectedScore, -Infinity) - finiteOr(a.expectedScore, -Infinity)
}

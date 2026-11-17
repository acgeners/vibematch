/**
 * Grupos da similaridade entre obras ("Obras parecidas", aba Recomendações da obra).
 *
 * A similaridade é medida no espaço CENTRALIZADO (mig 225): 0% é o que duas obras quaisquer dão,
 * e o par mais parecido do catálogo fica em ~66%. Nessa escala o % cru não se lê sozinho ("36%"
 * parece fraco e é uma vizinha normal), então a tela mostra o GRUPO e deixa o número no tooltip.
 *
 * Os cortes são os percentis p90 · p75 · p50 · p25 das 8 vizinhas de cada uma das 1.085 obras
 * ativas (8.680 pares), medidos na nuvem em 2026-11-16, depois do re-embed sem título. Re-embedar
 * com outro texto ou outro modelo muda a distribuição: remeça antes de manter estes números.
 *
 * Cor: uma por grupo, a mesma na barra, no rótulo e na legenda. Os de cima seguem a família do
 * Veredito (violeta = combina muito, azul = combina); os dois de baixo são neutros, porque "pouco
 * em comum" não é defeito da obra, só a vizinha mais distante. Sem âmbar (é o "desatualizado" do
 * app) e sem verde (colidiria com o selo da Prevista, na mesma coluna).
 */

export type SimilarityBandId = "muito" | "bem" | "parecida" | "algo" | "pouco"

export interface SimilarityBand {
  id: SimilarityBandId
  label: string
  /**
   * Limite inferior INCLUSIVO, em % INTEIRO — o mesmo número que a tela imprime. Comparar o
   * decimal cru deixaria 41,99% sair "42%" no tooltip e cair no grupo de baixo.
   * O último grupo não tem piso.
   */
  min: number | null
  /** Parte das 8.680 vizinhas medidas que cai neste grupo. */
  share: string
  /** Fundo e texto do rótulo. */
  chipClass: string
  /** Segmento aceso da barra. */
  barClass: string
}

/** Do mais parecido para o menos. A ordem é a do nível (5 → 1). */
export const SIMILARITY_BANDS: readonly SimilarityBand[] = [
  {
    id: "muito",
    label: "Muito parecida",
    min: 42,
    share: "10%",
    chipClass: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
    barClass: "bg-violet-500",
  },
  {
    id: "bem",
    label: "Bem parecida",
    min: 37,
    share: "17%",
    chipClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
    barClass: "bg-blue-500",
  },
  {
    id: "parecida",
    label: "Parecida",
    min: 33,
    share: "23%",
    chipClass: "bg-cyan-500/15 text-cyan-800 dark:text-cyan-300",
    barClass: "bg-cyan-500",
  },
  {
    id: "algo",
    label: "Algo em comum",
    min: 29,
    share: "24%",
    chipClass: "bg-slate-400/15 text-slate-700 dark:text-slate-300",
    barClass: "bg-slate-400",
  },
  {
    id: "pouco",
    label: "Pouco em comum",
    min: null,
    share: "25%",
    chipClass: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
    barClass: "bg-slate-600",
  },
]

/** O % inteiro que a tela imprime. Grupo e tooltip leem este número, nunca o decimal cru. */
export function similarityPercent(similarity: number): number {
  return Math.round(similarity * 100)
}

export function similarityBand(similarity: number): SimilarityBand {
  const shown = similarityPercent(similarity)
  for (const band of SIMILARITY_BANDS) {
    if (band.min == null || shown >= band.min) return band
  }
  return SIMILARITY_BANDS[SIMILARITY_BANDS.length - 1]
}

/** Nível de 1 (menos parecida) a N (mais), para a barra de segmentos. */
export function similarityBandLevel(band: SimilarityBand): number {
  return SIMILARITY_BANDS.length - SIMILARITY_BANDS.indexOf(band)
}

/** "42% ou mais" · "37% a 42%" · "abaixo de 29%" — derivado dos cortes, nunca escrito à mão. */
export function similarityBandRange(band: SimilarityBand): string {
  const i = SIMILARITY_BANDS.indexOf(band)
  const above = i > 0 ? SIMILARITY_BANDS[i - 1].min : null
  if (band.min == null) return `abaixo de ${SIMILARITY_BANDS[i - 1].min ?? 0}%`
  if (above == null) return `${band.min}% ou mais`
  return `${band.min}% a ${above - 1}%`
}

export function formatSimilarity(similarity: number): string {
  return `${similarityPercent(similarity)}%`
}

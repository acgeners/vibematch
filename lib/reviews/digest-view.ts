import type { ReviewDigest, ReviewDigestTrait } from "@/lib/ai-recommendation/types"

/**
 * Camada de VISÃO do `review_digest`: transforma o que o modelo devolve no que o card
 * "O que dizem as reviews" desenha. Puro, sem I/O — o componente só renderiza.
 *
 * O motivo de existir: até 2026-08-09 o card agrupava os traços por POLARIDADE
 * (Elogios/Ressalvas/Críticas), que responde "a internet gostou?" — pergunta que a média de
 * plataforma já responde melhor. O `axis` de cada traço, que responde "ela é boa NO QUE ME
 * IMPORTA?", existia no dado e vivia só no atributo `title=` do chip: invisível.
 * Medido no clone local (841 obras com digest, 6.178 traços): cada obra mistura **6 eixos
 * distintos em 8 traços** (mediana), então quase todo chip falava de outro assunto.
 */

/** Rótulo de tela por eixo. 8 valores cobrem 99,1% dos traços medidos. */
const AXIS_LABELS: Record<string, string> = {
  personagens: "Personagens",
  ritmo: "Ritmo",
  romance: "Romance",
  tom: "Tom",
  arte: "Arte",
  moralidade: "Moralidade",
  originalidade: "Originalidade",
  mundo: "Mundo",
  // A cauda (55 ocorrências em 6.178) entra com rótulo próprio em vez de ser forçada
  // num dos 8: inventar um mapa "execução → arte" mentiria sobre o que a review disse.
  execução: "Execução",
  escrita: "Escrita",
  roteiro: "Roteiro",
  conteúdo: "Conteúdo",
}

/**
 * Normaliza o eixo cru. Só duas operações, ambas seguras: caixa/espaços e o primeiro
 * segmento antes da barra (`execução/publicação` → `execução`). Valor desconhecido **não**
 * é descartado nem remapeado — vira um eixo próprio com a primeira letra maiúscula.
 */
export function normalizeAxis(raw: string | null | undefined): { key: string; label: string } {
  const cleaned = (raw ?? "").trim().toLowerCase().split("/")[0]?.trim() ?? ""
  if (!cleaned) return { key: "outros", label: "Outros" }
  const known = AXIS_LABELS[cleaned]
  if (known) return { key: cleaned, label: known }
  return { key: cleaned, label: cleaned.charAt(0).toUpperCase() + cleaned.slice(1) }
}

export type AxisTone = "positive" | "negative" | "mixed"

export interface AxisGroup {
  key: string
  label: string
  traits: ReviewDigestTrait[]
  /** Saldo = positivos − negativos. Define o tom e a ordem da régua. */
  balance: number
  tone: AxisTone
  /** "elogiado" | "criticado" | "dividido" — a palavra que acompanha o glifo. */
  verdict: string
  /**
   * Quantos traços do tom DOMINANTE existem — vira a repetição do glifo (▼▼), que é
   * intensidade. Não confundir com `traits.length`, que é o total do eixo e inclui os
   * mistos: Moralidade com 1 negativo + 1 misto sai como "▼ criticado" com contador 2.
   */
  intensity: number
}

function toneOf(polarity: string): AxisTone {
  return polarity === "positive" ? "positive" : polarity === "negative" ? "negative" : "mixed"
}

/**
 * Agrupa os traços por eixo e ordena do que mais agrada ao que mais incomoda.
 * Desempate: mais traços primeiro, depois a ordem em que o modelo os citou (que é a ordem
 * de saliência) — nunca alfabética, que jogaria "Arte" na frente por acaso.
 */
export function groupTraitsByAxis(traits: ReviewDigestTrait[] | null | undefined): AxisGroup[] {
  const order: string[] = []
  const byKey = new Map<string, { label: string; traits: ReviewDigestTrait[] }>()

  for (const trait of traits ?? []) {
    if (!trait?.trait?.trim()) continue
    const { key, label } = normalizeAxis(trait.axis)
    const existing = byKey.get(key)
    if (existing) existing.traits.push(trait)
    else {
      byKey.set(key, { label, traits: [trait] })
      order.push(key)
    }
  }

  const groups: AxisGroup[] = order.map((key) => {
    const { label, traits: list } = byKey.get(key)!
    const pos = list.filter((t) => toneOf(t.polarity) === "positive").length
    const neg = list.filter((t) => toneOf(t.polarity) === "negative").length
    const balance = pos - neg
    const tone: AxisTone = balance > 0 ? "positive" : balance < 0 ? "negative" : "mixed"
    return {
      key,
      label,
      traits: list,
      balance,
      tone,
      verdict: tone === "positive" ? "elogiado" : tone === "negative" ? "criticado" : "dividido",
      intensity: tone === "positive" ? pos : tone === "negative" ? neg : list.length,
    }
  })

  return groups.sort((a, b) => {
    if (b.balance !== a.balance) return b.balance - a.balance
    if (b.traits.length !== a.traits.length) return b.traits.length - a.traits.length
    return order.indexOf(a.key) - order.indexOf(b.key)
  })
}

/**
 * Eixo que o painel de detalhe abre por padrão: o MAIS CITADO (empate → ordem da régua).
 * Abrir no primeiro da lista deixaria a caixa com uma frase e um vão embaixo, já que o topo
 * da régua costuma ter um traço só.
 */
export function defaultAxisKey(groups: AxisGroup[]): string | null {
  if (groups.length === 0) return null
  return groups.reduce((best, g) => (g.traits.length > best.traits.length ? g : best), groups[0]).key
}

/* ------------------------------------------------------------------ */
/* Força do sinal                                                      */
/* ------------------------------------------------------------------ */

export type SignalStrength = "forte" | "moderado" | "fraco"

/**
 * Um consenso de 155 reviews e um de 1 review eram desenhados exatamente igual — o leitor
 * não tinha como saber quanta fé depositar no parágrafo. Medido nas 841 obras com digest:
 * mediana de 21 reviews, 65% com ≥3 fontes, e **206 obras (24,5%) com síntese feita a partir
 * de menos de 10 reviews** (26 delas com ≤3). Os cortes abaixo são escolha de produto sobre
 * essa distribuição, não uma medição — mudar aqui muda o rótulo em toda a base.
 */
export function reviewSignal(reviewCount: number, sourceCount: number): {
  strength: SignalStrength
  bars: number
} {
  if (reviewCount >= 20 && sourceCount >= 3) return { strength: "forte", bars: 4 }
  if (reviewCount >= 8 && sourceCount >= 2) return { strength: "moderado", bars: 3 }
  if (reviewCount >= 4) return { strength: "fraco", bars: 2 }
  return { strength: "fraco", bars: 1 }
}

/* ------------------------------------------------------------------ */
/* Distribuição das notas de leitor                                    */
/* ------------------------------------------------------------------ */

/** Abaixo disto a distribuição não sustenta um gráfico e o bloco não aparece. */
export const MIN_RATINGS_FOR_HISTOGRAM = 5

export interface RatingBin {
  /** Nota inteira do bin (ex.: 8 cobre [8, 9)). */
  score: number
  count: number
  tone: "low" | "mid" | "high"
}

/**
 * Histograma por ponto inteiro, do menor ao maior bin com nota — **incluindo os vazios do
 * meio**, senão a escala mente sobre a distância entre os grupos (era o caso do 9 vazio
 * entre 8,5 e 10 na obra que serviu de piloto).
 *
 * ⚠️ Só 17,9% das reviews trazem nota (4.722 de 26.368) e apenas 291 das 882 obras com
 * review têm cinco ou mais — por isso isto é um bloco CONDICIONAL, nunca a espinha do card.
 */
export function ratingHistogram(ratings: number[]): { bins: RatingBin[]; total: number } {
  const valid = ratings.filter((r) => Number.isFinite(r) && r >= 0 && r <= 10)
  if (valid.length < MIN_RATINGS_FOR_HISTOGRAM) return { bins: [], total: valid.length }

  const counts = new Map<number, number>()
  for (const r of valid) {
    const bin = Math.min(10, Math.floor(r))
    counts.set(bin, (counts.get(bin) ?? 0) + 1)
  }
  const min = Math.min(...counts.keys())
  const max = Math.max(...counts.keys())

  const bins: RatingBin[] = []
  for (let score = min; score <= max; score++) {
    bins.push({
      score,
      count: counts.get(score) ?? 0,
      tone: score <= 5 ? "low" : score >= 8 ? "high" : "mid",
    })
  }
  return { bins, total: valid.length }
}

/** Resumo em uma frase, para o rótulo acessível do gráfico. */
export function describeRatings(bins: RatingBin[], total: number): string {
  const low = bins.filter((b) => b.tone === "low").reduce((s, b) => s + b.count, 0)
  const high = bins.filter((b) => b.tone === "high").reduce((s, b) => s + b.count, 0)
  return `${total} notas de leitor: ${low} abaixo de 6, ${high} de 8 pra cima`
}

/** Reúne as notas das reviews externas de um snapshot (as manuais não têm nota). */
export function collectUserRatings(
  bySource: { reviews: { userRating: number | null }[] }[],
): number[] {
  return bySource.flatMap((s) => s.reviews.map((r) => r.userRating).filter((r): r is number => r != null))
}

/** Só vale desenhar a régua de eixos quando o digest tem traço com eixo. */
export function digestHasAxes(digest: ReviewDigest | null): boolean {
  return (digest?.salient_traits?.length ?? 0) > 0
}

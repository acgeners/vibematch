/**
 * A régua de "Mais como estas" (`/descobrir`): combina PARECENÇA com as obras-semente e
 * ALINHAMENTO com o perfil de quem olha, num número só.
 *
 * Puro de propósito (sem `server-only`, sem I/O): o mesmo cálculo roda no servidor, na
 * reordenação do cliente quando o slider se move, e nos testes.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════
 * 🔴 POR QUE A COMBINAÇÃO É ENTRE PERCENTIS, E NUNCA ENTRE OS VALORES CRUS
 *
 * Os dois eixos vivem em escalas incompatíveis. Medido no clone local em 2026-08-13:
 *
 *   similaridade centralizada  →  faixa útil 0,23 – 0,41
 *   personal_fit cru           →  satura perto de 0,55 mesmo nas melhores obras
 *
 * `0.5 * sim + 0.5 * fit` sobre esses números não significa "meio a meio" — significa
 * "o eixo de maior amplitude decide". Em percentil, o peso do slider é o peso de fato.
 *
 * É a mesma razão pela qual `calculated_scores` guarda `personal_fit_percentile` ao lado
 * do cru, e a UI mostra o percentil: o comentário da migration 071 registra que o cru tem
 * teto ~0,55 e por isso não serve para leitura direta.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════
 * 🔴 O QUE **NÃO** ENTRA NA CONTA, e por quê — medido, não estilo
 *
 * `expected_score` (Nota Prevista): corr(personal_fit, expected_score) = **0,72**. Somar os
 * dois é contar o mesmo eixo duas vezes e afogar a parecença, que é ortogonal aos dois
 * (corr ≈ −0,04 com ambos). Ele acompanha o resultado como COLUNA, para leitura.
 *
 * `alignment_score` (Veredito IA): existe em **510 das 988** obras. Entrar no score puniria
 * em silêncio metade do catálogo por ainda não ter passado pelo re-rank — o mesmo erro de
 * tratar ausência de medição como medição ruim. Também é só coluna.
 */

/** Uma obra candidata, já com os dois eixos brutos resolvidos. */
export interface BlendCandidate {
  workId: string
  /** Similaridade média às sementes, espaço centralizado (~−0,1 a 0,45). */
  simPos: number
  /** Similaridade média às anti-sementes; 0 quando não há nenhuma. */
  simNeg: number
  /**
   * Percentil de Alinhamento (0–100) de QUEM OLHA — `personal_fit_percentile` do overlay.
   * `null` quando a pessoa não tem perfil/modelo: ver `NEUTRAL_FIT_PCT`.
   */
  fitPercentile: number | null
}

export interface BlendedWork extends BlendCandidate {
  /** Similaridade efetiva: `simPos − ANTI_WEIGHT × simNeg`. */
  simEffective: number
  /** Percentil de `simEffective` DENTRO do conjunto avaliado (0–100, midrank). */
  simPercentile: number
  /** O que ordena a lista (0–100). */
  score: number
}

/**
 * Peso da anti-semente na similaridade efetiva.
 *
 * ⚠️ 0,5 e não 1,0: "menos como esta" é uma RESSALVA, não uma negação simétrica. Com peso 1
 * uma anti-semente próxima do eixo das sementes zera obras que o usuário pediu — ele disse
 * "quero vilãs, mas menos harém", não "descarte tudo que lembre harém".
 */
export const ANTI_WEIGHT = 0.5

/**
 * Alinhamento atribuído a quem não tem percentil.
 *
 * 🔴 Neutro (50) e não 0. Sem perfil de gosto — o caso COMUM de conta nova, já que o perfil
 * exige ≥5 obras avaliadas — `personal_fit_percentile` é null para o catálogo inteiro. Com 0,
 * o eixo de alinhamento não ficaria "desligado": ficaria empatado em ZERO, e qualquer peso
 * `w < 1` achataria o score de todas as obras igualmente, fazendo a lista parecer quebrada.
 * Com 50 o eixo simplesmente não desempata, e a parecença decide — que é a degradação certa.
 *
 * ⚠️ Isto NÃO substitui avisar na tela: o slider continua sem efeito visível, e é obrigação
 * da UI dizer por quê (`DiscoveryResult.fitAvailable`).
 */
export const NEUTRAL_FIT_PCT = 50

/** Peso padrão do slider: meio a meio. */
export const DEFAULT_SIM_WEIGHT = 0.5

/**
 * Percentil midrank (0–100) de cada valor dentro do próprio conjunto.
 *
 * ⚠️ Midrank, não posição: valores EMPATADOS têm que receber o mesmo percentil, senão a
 * ordem de chegada vira desempate invisível. É a mesma regra do `personal_fit_percentile`
 * (migration 071) — e vale mais aqui, porque a distribuição de similaridade é densa.
 */
export function midrankPercentiles(values: number[]): number[] {
  const n = values.length
  if (n === 0) return []
  if (n === 1) return [NEUTRAL_FIT_PCT]

  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const out = new Array<number>(n)

  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && order[j + 1].v === order[i].v) j++
    // Média das posições do bloco empatado, normalizada em [0, 100].
    const rank = (i + j) / 2
    const pct = (rank / (n - 1)) * 100
    for (let k = i; k <= j; k++) out[order[k].i] = pct
    i = j + 1
  }

  return out
}

/**
 * Combina os dois eixos e devolve a lista ORDENADA (melhor primeiro).
 *
 * @param weight 0 = só alinhamento, 1 = só parecença. Fora de [0,1] é clampado.
 *
 * ⚠️ O percentil de similaridade é calculado sobre TODOS os candidatos recebidos. Filtre
 * (não lidas, adulto, etc.) ANTES de chamar: filtrar depois compara cada obra contra um
 * universo que não é o exibido, e o slider passa a mentir sobre "quão parecida".
 */
export function blendCandidates(
  candidates: BlendCandidate[],
  weight: number = DEFAULT_SIM_WEIGHT,
): BlendedWork[] {
  const w = Math.min(1, Math.max(0, weight))
  if (candidates.length === 0) return []

  const effective = candidates.map((c) => c.simPos - ANTI_WEIGHT * c.simNeg)
  const simPcts = midrankPercentiles(effective)

  return candidates
    .map((c, i) => {
      const fitPct = c.fitPercentile ?? NEUTRAL_FIT_PCT
      return {
        ...c,
        simEffective: effective[i],
        simPercentile: simPcts[i],
        score: w * simPcts[i] + (1 - w) * fitPct,
      }
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        // Desempate estável: parecença, depois o id. Sem a 2ª chave, dois scores iguais
        // saem em ordem de chegada do banco e a lista "pula" entre recargas.
        b.simPercentile - a.simPercentile ||
        a.workId.localeCompare(b.workId),
    )
}

/**
 * Os pesos que o slider pode assumir. Discreto de propósito — 11 paradas de 10 em 10.
 *
 * 🔴 É isto que permite o slider reordenar SEM ida ao servidor. A página traz metadados da
 * UNIÃO dos top-N destes pesos (`unionOfTops`), então qualquer parada que o usuário escolha
 * já tem os dados na mão. Com peso contínuo não haveria conjunto finito a pré-carregar: ou
 * o slider viraria um round-trip por pixel arrastado, ou apareceria obra sem título na lista.
 *
 * 10 pontos percentuais é mais fino que a diferença que os dois eixos produzem — medido no
 * catálogo, a lista costuma mudar a cada ~20 pontos de peso.
 */
export const WEIGHT_STEPS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] as const

/** Arredonda um peso arbitrário para a parada mais próxima do slider. */
export function snapWeight(weight: number): number {
  const w = Math.min(1, Math.max(0, Number.isFinite(weight) ? weight : DEFAULT_SIM_WEIGHT))
  return WEIGHT_STEPS.reduce((best, s) => (Math.abs(s - w) < Math.abs(best - w) ? s : best), 0.5)
}

/**
 * Todas as obras que aparecem no top-N de ALGUM peso do slider, sem repetir.
 *
 * A ordem devolvida é a do peso corrente (primeiro os que o usuário vê agora); o resto vem
 * atrás para que a página possa carregar metadados de tudo numa query só.
 */
export function unionOfTops(
  candidates: BlendCandidate[],
  topN: number,
  currentWeight: number,
): BlendedWork[] {
  if (candidates.length === 0) return []

  const seen = new Set<string>()
  const out: BlendedWork[] = []

  // O peso corrente primeiro: é a lista que a tela mostra antes de qualquer interação.
  for (const b of blendCandidates(candidates, currentWeight).slice(0, topN)) {
    seen.add(b.workId)
    out.push(b)
  }
  for (const step of WEIGHT_STEPS) {
    for (const b of blendCandidates(candidates, step).slice(0, topN)) {
      if (seen.has(b.workId)) continue
      seen.add(b.workId)
      out.push(b)
    }
  }

  return out
}

/**
 * Quantas obras do top-N mudam entre as duas pontas do slider.
 *
 * Não é enfeite: é o que responde "esse controle faz alguma coisa?". Quando o número é
 * baixo, as sementes e o perfil concordam e o slider é decorativo naquela busca — vale
 * dizer isso em vez de deixar a pessoa arrastar à toa.
 */
export function extremesDivergence(candidates: BlendCandidate[], topN: number): number {
  if (candidates.length === 0) return 0
  const onlySim = blendCandidates(candidates, 1).slice(0, topN).map((c) => c.workId)
  const onlyFit = new Set(blendCandidates(candidates, 0).slice(0, topN).map((c) => c.workId))
  return onlySim.filter((id) => !onlyFit.has(id)).length
}

/**
 * Faixas de coesão das sementes (`seeds_diagnostics.cohesion`).
 *
 * Os cortes vêm de medição, não de gosto (2026-08-13): sementes vizinhas entre si dão
 * coesão ~0,33 e um top-10 com similaridade 0,266; sementes aleatórias dão ~0,00 e 0,169 —
 * **36% mais fraco**. No espaço centralizado o acaso é exatamente 0, então "perto de zero"
 * é literalmente "estas obras não têm nada em comum".
 */
export const COHESION_WEAK = 0.15
export const COHESION_STRONG = 0.28

export type CohesionLevel = "unknown" | "weak" | "fair" | "strong"

export function classifyCohesion(cohesion: number | null): CohesionLevel {
  if (cohesion == null) return "unknown"
  if (cohesion < COHESION_WEAK) return "weak"
  if (cohesion < COHESION_STRONG) return "fair"
  return "strong"
}

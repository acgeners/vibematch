/**
 * Métricas de ORDENAÇÃO sobre um grupo comparável de previsões resolvidas
 * (ex.: as obras de UM ranking_snapshot que depois foram avaliadas).
 *
 * Funções PURAS. NÃO devem ser aplicadas entre previsões de contextos/momentos
 * diferentes — só dentro de um mesmo grupo comparável (ver AUDIT_REPORT P1,
 * Etapa 8). Operam sobre pares (predicted, actual) alinhados por índice.
 */

export interface RankedPair {
  predicted: number
  actual: number
}

/** Ranks médios (tie → média das posições). 1-based. */
function averageRanks(values: number[]): number[] {
  const idx = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const ranks = new Array<number>(values.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++
    // posições i..j (0-based) → ranks (i+1)..(j+1); média:
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg
    i = j + 1
  }
  return ranks
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length
  if (n < 2) return null
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let dx = 0
  let dy = 0
  for (let i = 0; i < n; i++) {
    const ax = xs[i] - mx
    const ay = ys[i] - my
    num += ax * ay
    dx += ax * ax
    dy += ay * ay
  }
  if (dx === 0 || dy === 0) return null
  return num / Math.sqrt(dx * dy)
}

/** Spearman: Pearson sobre os ranks (com tie correction via ranks médios). */
export function spearman(pairs: RankedPair[]): number | null {
  if (pairs.length < 2) return null
  return pearson(
    averageRanks(pairs.map((p) => p.predicted)),
    averageRanks(pairs.map((p) => p.actual)),
  )
}

/** Kendall tau-b (corrige empates) sobre todos os pares. */
export function kendallTau(pairs: RankedPair[]): number | null {
  const n = pairs.length
  if (n < 2) return null
  let concordant = 0
  let discordant = 0
  let tiesPred = 0
  let tiesActual = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dp = Math.sign(pairs[i].predicted - pairs[j].predicted)
      const da = Math.sign(pairs[i].actual - pairs[j].actual)
      if (dp === 0 && da === 0) {
        tiesPred++
        tiesActual++
      } else if (dp === 0) {
        tiesPred++
      } else if (da === 0) {
        tiesActual++
      } else if (dp === da) {
        concordant++
      } else {
        discordant++
      }
    }
  }
  const n0 = (n * (n - 1)) / 2
  const denom = Math.sqrt((n0 - tiesPred) * (n0 - tiesActual))
  if (denom === 0) return null
  return (concordant - discordant) / denom
}

/**
 * Acurácia par-a-par: dentre os pares com `actual` diferente, fração em que a
 * previsão ordena na mesma direção. Empate na previsão conta 0,5.
 */
export function pairwiseAccuracy(pairs: RankedPair[]): number | null {
  const n = pairs.length
  if (n < 2) return null
  let comparable = 0
  let score = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const da = pairs[i].actual - pairs[j].actual
      if (da === 0) continue
      comparable++
      const dp = pairs[i].predicted - pairs[j].predicted
      if (dp === 0) score += 0.5
      else if (Math.sign(dp) === Math.sign(da)) score += 1
    }
  }
  return comparable === 0 ? null : score / comparable
}

/**
 * NDCG@k: ordena por `predicted` desc, ganho = relevância (default = actual),
 * desconto log2. Normaliza pelo ideal (ordenação por relevância). Relevâncias
 * negativas são clampadas a 0.
 */
export function ndcgAtK(pairs: RankedPair[], k: number, relevance?: (actual: number) => number): number | null {
  if (pairs.length === 0 || k <= 0) return null
  const rel = relevance ?? ((a: number) => a)
  const dcg = (rels: number[]) =>
    rels.slice(0, k).reduce((acc, r, i) => acc + Math.max(0, r) / Math.log2(i + 2), 0)
  const byPred = [...pairs].sort((a, b) => b.predicted - a.predicted).map((p) => rel(p.actual))
  const ideal = [...pairs].map((p) => rel(p.actual)).sort((a, b) => b - a)
  const idcg = dcg(ideal)
  if (idcg === 0) return null
  return dcg(byPred) / idcg
}

/**
 * Precision@k: fração dos top-k (por previsão) que são "relevantes"
 * (`actual >= relevanceThreshold`).
 */
export function precisionAtK(pairs: RankedPair[], k: number, relevanceThreshold: number): number | null {
  if (pairs.length === 0 || k <= 0) return null
  const topK = [...pairs].sort((a, b) => b.predicted - a.predicted).slice(0, k)
  if (topK.length === 0) return null
  const relevant = topK.filter((p) => p.actual >= relevanceThreshold).length
  return relevant / topK.length
}

/**
 * Regret@k: quanto se "perde" em nota real escolhendo os top-k pela PREVISÃO em
 * vez dos top-k reais. = média(actual dos k melhores reais) − média(actual dos
 * k escolhidos pela previsão). 0 = escolha ótima; maior = pior.
 */
export function regretAtK(pairs: RankedPair[], k: number): number | null {
  if (pairs.length === 0 || k <= 0) return null
  const kk = Math.min(k, pairs.length)
  const meanTopBy = (sortKey: (p: RankedPair) => number) => {
    const top = [...pairs].sort((a, b) => sortKey(b) - sortKey(a)).slice(0, kk)
    return top.reduce((acc, p) => acc + p.actual, 0) / top.length
  }
  const optimal = meanTopBy((p) => p.actual)
  const chosen = meanTopBy((p) => p.predicted)
  return optimal - chosen
}

export interface RankingMetrics {
  count: number
  spearman: number | null
  kendallTau: number | null
  pairwiseAccuracy: number | null
  ndcgAt5: number | null
  ndcgAt10: number | null
  precisionAt5: number | null
  precisionAt10: number | null
  regretAt5: number | null
  regretAt10: number | null
}

/**
 * Calcula todas as métricas de ordenação para UM grupo comparável.
 * `relevanceThreshold` define "relevante" pro Precision@k (default 8 — mesmo
 * critério do AUDIT_REPORT §7.1).
 */
export function computeRankingMetrics(pairs: RankedPair[], relevanceThreshold = 8): RankingMetrics {
  return {
    count: pairs.length,
    spearman: spearman(pairs),
    kendallTau: kendallTau(pairs),
    pairwiseAccuracy: pairwiseAccuracy(pairs),
    ndcgAt5: ndcgAtK(pairs, 5),
    ndcgAt10: ndcgAtK(pairs, 10),
    precisionAt5: precisionAtK(pairs, 5, relevanceThreshold),
    precisionAt10: precisionAtK(pairs, 10, relevanceThreshold),
    regretAt5: regretAtK(pairs, 5),
    regretAt10: regretAtK(pairs, 10),
  }
}

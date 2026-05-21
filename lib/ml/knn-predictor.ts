/**
 * kNN predictor sobre embeddings — predição via média ponderada por kernel
 * Gaussiano dos k vizinhos rotulados mais próximos no espaço semântico.
 *
 * Diferente do Ridge (feature-based): aqui o "modelo" é o próprio dataset
 * rotulado. Pra prever a nota de uma obra, pega obras parecidas que VOCÊ
 * já avaliou e calcula uma média ponderada pelo quanto cada uma é parecida.
 *
 * Vantagens vs Ridge:
 *   - Não-paramétrico: captura padrões locais que Ridge não consegue (ex:
 *     "obras com twist específico A+B" tem nota Y, mesmo que A e B sozinhos
 *     tenham efeito Z).
 *   - Erros não-correlacionados com Ridge — bom pro stacker (Passo 6).
 *
 * Desvantagens:
 *   - Sensível a outliers no conjunto de vizinhos.
 *   - Sem nenhum vizinho próximo (obra "OOD"), predição vira média ruidosa.
 *     `confidence` reflete isso via `distance_to_5th_neighbor`.
 */

export interface KnnNeighbor {
  workId: string
  /** Cosine similarity 0–1 com a obra-alvo. */
  similarity: number
  /** manual_score do vizinho (real, não previsto). */
  manualScore: number
}

export interface KnnPrediction {
  /** Predição da nota (0–10) — média ponderada dos vizinhos. NULL se não houver vizinhos. */
  prediction: number | null
  /** Vizinhos usados, com peso de cada um (soma = 1). Útil pra explicar. */
  neighbors: Array<KnnNeighbor & { weight: number }>
  /** Distância (1 - similarity) ao 5º vizinho mais próximo. Sinal de densidade local. */
  distanceTo5thNeighbor: number | null
}

const MIN_NEIGHBORS_FOR_PREDICTION = 3
const DEFAULT_K = 10

/**
 * Aplica kernel Gaussiano: weight_i = exp(-d_i² / σ²), com σ = mediana das
 * distâncias dos vizinhos. Adaptativo — bandwidth muda por obra-alvo.
 */
function gaussianWeights(distances: number[]): number[] {
  if (distances.length === 0) return []
  // σ = mediana das distâncias (bandwidth adaptativa)
  const sorted = [...distances].sort((a, b) => a - b)
  const sigma = sorted[Math.floor(sorted.length / 2)]
  // Se todas as distâncias são zero (caso patológico), peso uniforme
  if (sigma === 0) return distances.map(() => 1 / distances.length)

  const weights = distances.map((d) => Math.exp(-(d * d) / (sigma * sigma)))
  const total = weights.reduce((a, b) => a + b, 0)
  return total > 0 ? weights.map((w) => w / total) : weights.map(() => 1 / weights.length)
}

/**
 * Prediz a nota de uma obra a partir dos seus k vizinhos rotulados.
 * Retorna `prediction: null` quando há menos de MIN_NEIGHBORS_FOR_PREDICTION.
 */
export function predictKnn(neighbors: KnnNeighbor[]): KnnPrediction {
  const valid = neighbors.filter(
    (n) =>
      Number.isFinite(n.similarity) &&
      Number.isFinite(n.manualScore) &&
      n.similarity >= 0 &&
      n.similarity <= 1,
  )

  if (valid.length < MIN_NEIGHBORS_FOR_PREDICTION) {
    return { prediction: null, neighbors: [], distanceTo5thNeighbor: null }
  }

  // Distância cosine = 1 - similarity. Clamp em 0 pra evitar negativos por float error.
  const distances = valid.map((n) => Math.max(0, 1 - n.similarity))
  const weights = gaussianWeights(distances)

  let weightedSum = 0
  for (let i = 0; i < valid.length; i++) {
    weightedSum += weights[i] * valid[i].manualScore
  }
  const prediction = Math.max(0, Math.min(10, weightedSum))

  // Distância ao 5º vizinho (índice 4) — proxy de densidade local. Quando
  // alta, mesmo o 5º vizinho está longe e a predição é menos confiável.
  const sortedDist = [...distances].sort((a, b) => a - b)
  const distanceTo5thNeighbor = sortedDist[4] ?? sortedDist[sortedDist.length - 1] ?? null

  return {
    prediction,
    neighbors: valid.map((n, i) => ({ ...n, weight: Math.round(weights[i] * 10000) / 10000 })),
    distanceTo5thNeighbor,
  }
}

export { MIN_NEIGHBORS_FOR_PREDICTION, DEFAULT_K }

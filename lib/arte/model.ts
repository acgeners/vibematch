/**
 * O MODELO de arte: estima `like_art_score` a partir do sinal barato, e converte a estimativa
 * na grandeza que a UI pode usar (percentil e faixa).
 *
 * 🔴 O que este módulo NÃO é: feature da Nota Prevista. Medido em 2026-08-12
 * (`scripts/diag-arte-na-nota-prevista.ts`), plugado no Ridge dá ΔMAE −0,005 com IC95%
 * excluindo até o +0,007 teórico — `like_art_score` é 1/7 do `user_score`, logo entra no
 * rótulo com a variância dividida por 49 (3,2% do total). Também NÃO é desempate automático:
 * rumo ao gosto acerta 55,8% [52,4–59,1], quase moeda, e reordenaria 94,9% do catálogo.
 *
 * O que ele É (medido no mesmo dia, `scripts/diag-arte-desempate.ts`, OOF sobre 200 rótulos):
 * critério de decisão EXPLÍCITO. Spearman 0,531 · AUC "arte ≥ 9" 0,765 · direção certa em
 * 67,7% dos pares com a mesma Nota Prevista exibida (n=541) · o fundo 20% concentra 2,6× a
 * arte fraca.
 *
 * 🔴 A estimativa de uma obra COM rótulo tem que vir de `artOutOfFoldEstimates`. O modelo
 * treina nos rótulos de arte, e a obra rotulada que se auto-estima devolve número inflado —
 * numa medição isso mente, e numa tela ela aparece boa demais justamente onde há verdade
 * pra conferir.
 */
import { StandardScaler } from "@/lib/ml/preprocessing"
import { fitRidge, fitRidgeCV } from "@/lib/ml/ridge"
import { kFoldIndices } from "@/lib/ml/logistic"
import { artFeatureVector, hasArtEvidence, type ArtSignal } from "@/lib/arte/signal"

/** Os mesmos α da medição — trocar aqui desliga a comparabilidade com o retrato de 2026-08-12. */
const ALPHAS = [0.3, 1, 3, 10, 30, 100, 300]
const FOLDS = 5
const SEED = 42

/**
 * Piso de rótulos abaixo do qual NÃO há estimativa (null, não a média).
 *
 * ⚠️ Este número não é medido — o único ponto que existe é n=200, onde o modelo entrega
 * Spearman 0,531. 50 é um piso conservador escolhido para que, abaixo dele, a feature se
 * desligue inteira em vez de publicar um modelo sobre o qual não há evidência nenhuma.
 * Medir de verdade exigiria uma curva de aprendizado por tamanho de amostra.
 */
export const ART_MIN_TRAIN = 50

/** A escala do rótulo. A estimativa é comprimida (~0,49× o σ do rótulo) e NÃO é comparável em pontos. */
const SCORE_MIN = 0
const SCORE_MAX = 10

export interface ArtSample {
  /** Vetor de `artFeatureVector`. */
  features: number[]
  /** `pilot_taste_scores.like_art_score`. */
  label: number
}

export interface ArtPredictor {
  predict(features: number[][]): number[]
  trainSize: number
  alpha: number
}

function clampScore(v: number): number {
  // Monotônico ⇒ não altera ordem nem percentil; existe só para a estimativa não sair da
  // escala do rótulo que ela imita.
  return Math.max(SCORE_MIN, Math.min(SCORE_MAX, v))
}

/**
 * Treina sobre TODOS os rótulos. Use para obra SEM rótulo de arte — para as rotuladas, o
 * caminho é `artOutOfFoldEstimates`.
 */
export function trainArtPredictor(samples: ArtSample[]): ArtPredictor | null {
  if (samples.length < ART_MIN_TRAIN) return null
  const scaler = new StandardScaler().fit(samples.map((s) => s.features))
  const X = scaler.transform(samples.map((s) => s.features))
  const y = samples.map((s) => s.label)
  const model = fitRidgeCV(X, y, ALPHAS, Math.min(FOLDS, samples.length))
  return {
    trainSize: samples.length,
    alpha: model.alpha,
    predict(features) {
      if (features.length === 0) return []
      return scaler
        .transform(features)
        .map((row) => clampScore(model.intercept + row.reduce((a, x, j) => a + x * model.coefficients[j], 0)))
    },
  }
}

/**
 * Estimativa OUT-OF-FOLD para as obras rotuladas: cada uma recebe a predição de um modelo que
 * não a viu. Padronização e escolha de α acontecem DENTRO do fold de treino — fitar qualquer
 * um dos dois no conjunto todo vaza o rótulo pelo pré-processamento, sem nada acusar.
 */
export function artOutOfFoldEstimates(samples: ArtSample[], kFolds = FOLDS): number[] | null {
  const n = samples.length
  if (n < ART_MIN_TRAIN) return null
  const folds = kFoldIndices(n, Math.max(2, Math.min(kFolds, n)), SEED)
  const out = new Array<number>(n).fill(NaN)

  for (const fold of folds) {
    const testIdx = new Set(fold)
    const trainIdx = [...Array(n).keys()].filter((i) => !testIdx.has(i))
    if (!trainIdx.length || !fold.length) continue

    const scaler = new StandardScaler().fit(trainIdx.map((i) => samples[i].features))
    const Xtr = scaler.transform(trainIdx.map((i) => samples[i].features))
    const ytr = trainIdx.map((i) => samples[i].label)
    const alpha = fitRidgeCV(Xtr, ytr, ALPHAS, Math.min(4, Xtr.length)).alpha
    const model = fitRidge(Xtr, ytr, alpha)

    const Xte = scaler.transform(fold.map((i) => samples[i].features))
    fold.forEach((idx, k) => {
      out[idx] = clampScore(
        model.intercept + Xte[k].reduce((a, x, j) => a + x * model.coefficients[j], 0),
      )
    })
  }
  return out
}

/**
 * Percentil (0–1) da estimativa dentro do catálogo, com MIDRANK — empatados recebem o mesmo
 * percentil, senão a ordem de chegada decidiria a faixa de quem tem o mesmo valor.
 *
 * `null` entra e sai `null`: obra sem estimativa não tem posição, e enfiá-la no meio da
 * distribuição é exatamente o erro que a coluna existe para evitar.
 */
export function computeArtPercentiles(estimates: Array<number | null>): Array<number | null> {
  const validos = estimates
    .map((v, i) => ({ v, i }))
    .filter((r): r is { v: number; i: number } => r.v != null && Number.isFinite(r.v))
  const n = validos.length
  const out = new Array<number | null>(estimates.length).fill(null)
  if (n === 0) return out

  const ordenado = [...validos].sort((a, b) => a.v - b.v)
  let k = 0
  while (k < n) {
    let j = k
    while (j + 1 < n && ordenado[j + 1].v === ordenado[k].v) j++
    // midrank: posição média do bloco de empatados, normalizada para (0, 1]
    const midrank = (k + j) / 2 + 1
    const pct = midrank / n
    for (let t = k; t <= j; t++) out[ordenado[t].i] = pct
    k = j + 1
  }
  return out
}

/**
 * Cortes, rótulos e classificação de faixa moram em `./bands` — módulo LEVE, sem `lib/ml`.
 * Re-exportados aqui porque este era o endereço deles e sete arquivos já o citam; o motivo da
 * separação (o painel de filtros é `"use client"` e não pode arrastar o Ridge) está lá.
 */
export { ART_BAND_CUTOFFS, ART_BAND_LABELS, artBandFromPercentile } from "./bands"
export type { ArtBand } from "./bands"

export interface ArtCatalogInput {
  id: string
  /** `works.art_signal` já parseado. `null` = nunca extraído ⇒ obra fica sem estimativa. */
  signal: ArtSignal | null
  tagSlugs: Iterable<string>
  /** `pilot_taste_scores.like_art_score` DO DONO, quando existe. */
  label?: number | null
}

export interface ArtCatalogResult {
  estimate: number | null
  percentile: number | null
}

/**
 * O passo de catálogo: treina no que está rotulado e estima o resto, numa passada.
 *
 * 🔴 Vive FORA do `computeRecalc` de propósito. Aquela função tem 14 chamadores (o recalc, o
 * per-user e 12 scripts de diagnóstico) e é o coração da Nota Prevista; a arte não entra em
 * nenhum cálculo dela — enfiá-la lá dentro daria à estimativa um alcance que a medição não
 * autoriza, e faria toda a bateria de diagnóstico carregar um passo que não usa.
 *
 * Três estados de saída, e a diferença entre eles importa:
 *   modelo abaixo do piso   → TUDO null (nem sinal nem falso zero)
 *   obra sem evidência      → null (2,4% do catálogo — ver `hasArtEvidence`)
 *   obra COM rótulo         → estimativa out-of-fold, nunca a in-sample
 */
export function computeArtForCatalog(inputs: ArtCatalogInput[]): Map<string, ArtCatalogResult> {
  const vazio = (): Map<string, ArtCatalogResult> =>
    new Map(inputs.map((i) => [i.id, { estimate: null, percentile: null }]))

  // Só entra no modelo quem tem alguma evidência — sem isso a obra receberia a média do
  // treino, que num filtro vira um fato que ninguém apurou.
  const elegiveis = inputs.map((i) => (i.signal ? hasArtEvidence(i.signal, i.tagSlugs) : false))
  const features = inputs.map((i, k) =>
    elegiveis[k] ? artFeatureVector(i.signal as ArtSignal, i.tagSlugs) : null,
  )

  const treinoIdx: number[] = []
  for (let k = 0; k < inputs.length; k++) {
    const lab = inputs[k].label
    if (features[k] && lab != null && Number.isFinite(lab)) treinoIdx.push(k)
  }
  if (treinoIdx.length < ART_MIN_TRAIN) return vazio()

  const amostras: ArtSample[] = treinoIdx.map((k) => ({
    features: features[k] as number[],
    label: inputs[k].label as number,
  }))
  const oof = artOutOfFoldEstimates(amostras)
  const preditor = trainArtPredictor(amostras)
  if (!oof || !preditor) return vazio()

  // O modelo cheio serve SÓ a quem não tem rótulo; a obra rotulada usa o out-of-fold dela.
  const noTreino = new Set(treinoIdx)
  const semRotulo = inputs
    .map((_, k) => k)
    .filter((k) => features[k] != null && !noTreino.has(k))
  const cheias = preditor.predict(semRotulo.map((k) => features[k] as number[]))

  const estimativas = new Array<number | null>(inputs.length).fill(null)
  treinoIdx.forEach((k, pos) => {
    estimativas[k] = oof[pos]
  })
  semRotulo.forEach((k, pos) => {
    estimativas[k] = cheias[pos]
  })

  const percentis = computeArtPercentiles(estimativas)
  return new Map(
    inputs.map((i, k) => [i.id, { estimate: estimativas[k], percentile: percentis[k] }]),
  )
}

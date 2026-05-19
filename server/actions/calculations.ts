"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import { getPublicationStatusNameById } from "@/lib/constants/status-lookups"
import {
  normalizeGPT,
  sumVotes,
  calculatePlatformAvg,
  computeGlobalPlatformMean,
  normalizeChapters,
  calculateNotaCalc,
  calculateNotaFinal,
} from "@/lib/calculations"
import { calculateGPTWithDiagnostics } from "@/lib/calculations/gpt"
import { trainPredictor, type PredictionInput } from "@/lib/calculations/prediction"
import { computeCalibration } from "@/lib/calculations/calibration"
import { percentile } from "@/lib/ml/preprocessing"
import type {
  CategoryScoreMap,
  ScoreWeight,
  PlatformRating,
  FormulaConfig,
  PublicationStatus,
  SynopsisQuality,
} from "@/types/domain"

interface RawWork {
  id: string
  publication_status_id: number | null
  total_chapters: number | null
  synopsis_quality: string | null
  observation_adjustment: number
  manual_score: number | null
  is_archived: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  category_scores: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  platform_ratings: any[]
}

interface WorkComputed {
  id: string
  manualScore: number | null
  publicationStatus: string
  totalChapters: number | null
  synopsisQuality: SynopsisQuality | null
  observationAdjustment: number
  categoryScores: CategoryScoreMap
  platformRatings: PlatformRating[]
  totalVotes: number
  // calculados em memória
  iaEvalRaw: number
  iaEvalNormalized: number
  chaptersNormalized: number
  platformAvg: number | null
  calcScore: number
  predictedScore: number | null
  predictionDistance: number | null
  finalScore: number | null
}

function buildWork(raw: RawWork): WorkComputed {
  const categoryScores: CategoryScoreMap = {}
  for (const cs of raw.category_scores ?? []) {
    categoryScores[cs.criterion_slug] = Number(cs.score)
  }
  const platformRatings: PlatformRating[] = (raw.platform_ratings ?? []).map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p: any) => ({
      id: p.id ?? "",
      work_id: raw.id,
      platform: p.platform,
      rating: p.rating == null ? null : Number(p.rating),
      vote_count: Number(p.vote_count ?? 0),
    })
  )

  return {
    id: raw.id,
    manualScore: raw.manual_score == null ? null : Number(raw.manual_score),
    publicationStatus: getPublicationStatusNameById(raw.publication_status_id) ?? "Unknown",
    totalChapters: raw.total_chapters,
    synopsisQuality: raw.synopsis_quality as SynopsisQuality | null,
    observationAdjustment: Number(raw.observation_adjustment ?? 0),
    categoryScores,
    platformRatings,
    totalVotes: sumVotes(platformRatings),
    iaEvalRaw: 0,
    iaEvalNormalized: 0,
    chaptersNormalized: 0,
    platformAvg: null,
    calcScore: 0,
    predictedScore: null,
    predictionDistance: null,
    finalScore: null,
  }
}

function buildPredictionInput(w: WorkComputed): PredictionInput {
  return {
    categoryScores: w.categoryScores,
    iaEvalNormalized: w.iaEvalNormalized,
    platformAvg: w.platformAvg,
    totalVotes: w.totalVotes,
    totalChapters: w.totalChapters,
    synopsisQuality: w.synopsisQuality,
    observationAdjustment: w.observationAdjustment,
    publicationStatus: w.publicationStatus,
  }
}

/**
 * Reprocessa TODA a base:
 *   1. Calcula percentis de #Votos -> atualiza pseudo_votes_*
 *   2. Calcula GPT.N, Nota.M, Cps.N, Nota.Calc para todos
 *   3. Treina Ridge nos títulos com manual_score e prediz Nota.Pr para todos
 *   4. Calcula MAEs reais -> atualiza mae_calc, mae_predicted
 *   5. Calcula NotaFinal com MAEs novos
 *   6. Bulk upsert em calculated_scores
 *   7. Persiste novo formula_config
 */
export async function recalculateAll() {
  const supabase = createAdminClient()

  const [worksRes, weightsRes, configRes] = await Promise.all([
    supabase
      .from("works")
      .select(
        `id, publication_status_id, total_chapters, synopsis_quality,
         observation_adjustment, manual_score, is_archived,
         category_scores(criterion_slug, score),
         platform_ratings(id, platform, rating, vote_count)`
      )
      .eq("is_archived", false)
      .limit(2000),
    supabase.from("score_weights").select("*").eq("is_active", true),
    supabase.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
  ])

  if (worksRes.error) throw new Error(worksRes.error.message)
  if (weightsRes.error) throw new Error(weightsRes.error.message)
  if (configRes.error) throw new Error(configRes.error.message)

  const works = (worksRes.data as RawWork[]).map(buildWork)
  const weights = weightsRes.data as ScoreWeight[]
  let config = (configRes.data?.[0] ?? null) as FormulaConfig | null

  if (!config) {
    const { data: insertedConfig, error: insertConfigError } = await supabase
      .from("formula_config")
      .insert({ formula_version: "v1" })
      .select("*")
      .limit(1)

    if (insertConfigError) throw new Error(insertConfigError.message)
    config = (insertedConfig?.[0] ?? null) as FormulaConfig | null
    if (!config) throw new Error("formula_config não encontrado")
  }

  if (works.length === 0) {
    return { recalculated: 0, calibration: null }
  }

  // ---------- 1) Percentis de votos -> pseudo_votes_* ----------
  // Calculamos cedo pra usar nas demais etapas
  const interimCalibration = computeCalibration(
    works.map((w) => ({
      workId: w.id,
      manualScore: w.manualScore,
      calcScore: null,
      predictedScore: null,
      finalScore: null,
      totalVotes: w.totalVotes,
    }))
  )

  // pseudo_votes pode ser null se houver <5 works com votos. Esse caso é
  // extremamente improvável em produção, mas mantém defaults sanos pra não
  // quebrar o Bayesian blend.
  const pseudoVotesNotaM = interimCalibration.pseudoVotesNotaM ?? 1000
  const pseudoVotesBlend = interimCalibration.pseudoVotesBlend ?? 600

  // ---------- 2) GPT, GPT.N, Cps.N, Nota.M, Nota.Calc ----------
  let gptClampHits = 0
  const gptNegativeActivations: Record<string, number> = {}
  for (const w of works) {
    const { value, diagnostics } = calculateGPTWithDiagnostics(w.categoryScores, weights)
    w.iaEvalRaw = value
    w.iaEvalNormalized = normalizeGPT(value)
    w.chaptersNormalized = normalizeChapters(w.totalChapters)
    if (diagnostics.clampHit) gptClampHits += 1
    for (const [slug, activated] of Object.entries(diagnostics.negativeActivations)) {
      if (!activated) continue
      gptNegativeActivations[slug] = (gptNegativeActivations[slug] ?? 0) + 1
    }
  }

  // Global mean precisa dos platform_avg de todos. Calcular em 2 passes:
  // pass 1: platform_avg "local" (prior = 8.0 default), só pra ter algo
  const tempGlobalMean = 8.0
  for (const w of works) {
    w.platformAvg = calculatePlatformAvg(w.platformRatings, tempGlobalMean, pseudoVotesNotaM)
  }
  // pass 2: usar a média desses como prior real
  const realGlobalMean = computeGlobalPlatformMean(
    works.map((w) => w.platformAvg).filter((v): v is number => v != null)
  )
  for (const w of works) {
    w.platformAvg = calculatePlatformAvg(w.platformRatings, realGlobalMean, pseudoVotesNotaM)
  }

  // Nota.Calc
  for (const w of works) {
    w.calcScore = calculateNotaCalc({
      iaEvalNormalized: w.iaEvalNormalized,
      platformAvg: w.platformAvg,
      totalVotes: w.totalVotes,
      chaptersNormalized: w.chaptersNormalized,
      publicationStatus: (w.publicationStatus as PublicationStatus) ?? "Unknown",
      synopsisQuality: w.synopsisQuality,
      observationAdjustment: w.observationAdjustment,
      pseudoVotesBlend,
    })
  }

  // ---------- 3) Treinar Ridge e prever Nota.Pr ----------
  const trainSet = works.filter((w) => w.manualScore != null)
  const trainInputs = trainSet.map(buildPredictionInput)
  const trainTargets = trainSet.map((w) => w.manualScore as number)

  const predictor = trainPredictor(trainInputs, trainTargets)
  const allInputs = works.map(buildPredictionInput)
  const { predictions, distances } = predictor.predictWithDistance(allInputs)
  for (let i = 0; i < works.length; i++) {
    works[i].predictedScore = predictions[i]
    works[i].predictionDistance = distances[i]
  }

  // Threshold de outlier por percentil: P95 das distâncias do treino ao
  // próprio centróide. Robusto a dimensionalidade — não depende de "distância
  // absoluta" que escala com √k. Obras com d ≤ P95 mantêm factor = 1 (sem
  // penalidade); acima cai suavemente via exp(-(d - p95)/p95).
  const trainDistances = predictor.isStub
    ? []
    : predictor.predictWithDistance(trainInputs).distances
  const distanceP95: number | null =
    trainDistances.length > 0 ? Number(percentile(trainDistances, 0.95).toFixed(4)) : null

  function distanceFactor(distance: number | null): number {
    if (distance == null || distanceP95 == null || predictor.isStub) return 1
    if (distance <= distanceP95) return 1
    return Math.exp(-(distance - distanceP95) / distanceP95)
  }

  // ---------- 4) Calibrar MAEs com Nota.Calc + Nota.Pr ----------
  const calibrationAfterPr = computeCalibration(
    works.map((w) => ({
      workId: w.id,
      manualScore: w.manualScore,
      calcScore: w.calcScore,
      predictedScore: w.predictedScore,
      finalScore: null,
      totalVotes: w.totalVotes,
    }))
  )
  const newMaeCalc = calibrationAfterPr.maeCalc
  const newMaePredicted = calibrationAfterPr.maePredicted
  const newRmseCalc = calibrationAfterPr.rmseCalc
  const newRmsePredicted = calibrationAfterPr.rmsePredicted

  // ---------- 5) NotaFinal com RMSEs novos ----------
  // Quando calibração é insuficiente (RMSE null) ou predição é stub,
  // calculateNotaFinal cai pra calcScore puro — sem blend baseado em chute.
  // Distância ao centróide reduz o peso de Nota.Pr pra outliers.
  for (const w of works) {
    if (w.predictedScore == null || predictor.isStub) {
      w.finalScore = w.calcScore
    } else {
      w.finalScore = calculateNotaFinal(
        w.calcScore,
        w.predictedScore,
        newRmseCalc,
        newRmsePredicted,
        distanceFactor(w.predictionDistance)
      )
    }
  }

  // Recalibração final só pra reportar mae_final (não vai pro config)
  const finalCalibration = computeCalibration(
    works.map((w) => ({
      workId: w.id,
      manualScore: w.manualScore,
      calcScore: w.calcScore,
      predictedScore: w.predictedScore,
      finalScore: w.finalScore,
      totalVotes: w.totalVotes,
    }))
  )

  // ---------- 6) Bulk upsert calculated_scores ----------
  const rows = works.map((w) => ({
    work_id: w.id,
    total_votes: w.totalVotes,
    platform_avg: w.platformAvg,
    ia_eval: w.iaEvalRaw,
    ia_eval_normalized: w.iaEvalNormalized,
    chapters_normalized: w.chaptersNormalized,
    calc_score: w.calcScore,
    predicted_score: w.predictedScore,
    predicted_is_stub: predictor.isStub,
    final_score: w.finalScore,
    mae_calc: newMaeCalc,
    mae_predicted: newMaePredicted,
    rmse_calc: newRmseCalc,
    rmse_predicted: newRmsePredicted,
    prediction_distance: w.predictionDistance,
    formula_version: config.formula_version,
    calculated_at: new Date().toISOString(),
  }))

  const { error: upsertErr } = await supabase
    .from("calculated_scores")
    .upsert(rows, { onConflict: "work_id" })
  if (upsertErr) throw new Error(upsertErr.message)

  // Atualiza calculated_scores.confidence como pass-through da
  // ai_evaluations.confidence mais recente. Função criada na migration 022.
  // Falha aqui não invalida o resto do recalculate.
  const { error: confidenceErr } = await supabase.rpc("refresh_calculated_scores_confidence")
  if (confidenceErr) {
    console.warn("[recalculateAll] refresh_calculated_scores_confidence falhou:", confidenceErr.message)
  }

  // Agregar diagnósticos antes do persist
  const negativeActivationRate: Record<string, number> = {}
  for (const [slug, count] of Object.entries(gptNegativeActivations)) {
    negativeActivationRate[slug] = count / works.length
  }
  const gptClampHitRate = gptClampHits / works.length

  // ---------- 7) Persistir novo formula_config ----------
  const { error: configUpdateErr } = await supabase
    .from("formula_config")
    .update({
      mae_calc: newMaeCalc,
      mae_predicted: newMaePredicted,
      rmse_calc: newRmseCalc,
      rmse_predicted: newRmsePredicted,
      pseudo_votes_nota_m: pseudoVotesNotaM,
      pseudo_votes_blend: pseudoVotesBlend,
      gpt_clamp_hit_rate: gptClampHitRate,
      negative_activation_rate: negativeActivationRate,
      distance_p95: distanceP95,
      last_recalculated_at: new Date().toISOString(),
    })
    .eq("id", config.id)
  if (configUpdateErr) throw new Error(configUpdateErr.message)

  revalidatePath("/titles")
  revalidatePath("/ranking")
  revalidatePath("/settings")
  revalidatePath("/")
  revalidateTag("score-color-thresholds", "max")

  return {
    recalculated: works.length,
    diagnostics: {
      gptClampHits,
      gptClampHitRate,
      negativeActivationCounts: gptNegativeActivations,
      negativeActivationRate,
    },
    calibration: {
      trainSize: predictor.trainSize,
      isStub: predictor.isStub,
      alpha: predictor.model.alpha,
      cvMAE: predictor.model.cvMAE,
      cvRMSE: predictor.model.cvRMSE,
      maeCalc: newMaeCalc,
      maePredicted: newMaePredicted,
      maeFinal: finalCalibration.maeFinal,
      rmseCalc: newRmseCalc,
      rmsePredicted: newRmsePredicted,
      rmseFinal: finalCalibration.rmseFinal,
      pseudoVotesNotaM,
      pseudoVotesBlend,
      featureNames: predictor.featureNames,
      coefficients: predictor.model.coefficients,
    },
  }
}

/**
 * Recalcula de forma incremental — wrapper compatível com a API antiga.
 * Como Nota.Pr depende de Ridge treinado em todos, recalcular um único
 * título sem retreinar não faz sentido. Reaproveitamos recalculateAll().
 */
export async function recalculateWork(workId: string) {
  void workId
  return recalculateAll()
}

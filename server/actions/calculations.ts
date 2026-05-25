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
} from "@/lib/calculations"
import { calculateNotaFinalChoosing } from "@/lib/calculations/final"
import { calculateGPTWithDiagnostics } from "@/lib/calculations/gpt"
import {
  ridgeOutOfFoldPredictions,
  trainPredictor,
  type PredictionInput,
} from "@/lib/calculations/prediction"
import { computeCalibration } from "@/lib/calculations/calibration"
import { calculateFinalScoreConfidence } from "@/lib/calculations/confidence"
import { fitStacker, type StackerCoefficients } from "@/lib/calculations/stacker"
import { predictKnn, DEFAULT_K, type KnnNeighbor } from "@/lib/ml/knn-predictor"
import { getKnnNeighborsBatch } from "@/server/queries/knn-neighbors"
import { percentile } from "@/lib/ml/preprocessing"
import {
  computePersonalFit,
  criterionAlignment,
  weightedTagOverlap,
} from "@/lib/ai-recommendation/personal-fit"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import type {
  CategoryScoreMap,
  ScoreWeight,
  PlatformRating,
  FormulaConfig,
  SynopsisQuality,
} from "@/types/domain"

const POST_SCORE_FIELDS = [
  "post_story_score",
  "post_fl_score",
  "post_ml_score",
  "post_character_development_score",
  "post_pacing_score",
  "post_art_visual_score",
  "post_impact_immersion_score",
  "post_originality_score",
] as const

interface RawWork {
  id: string
  publication_status_id: number | null
  total_chapters: number | null
  synopsis_quality: string | null
  observation_adjustment: number
  manual_score: number | null
  is_archived: boolean
  post_story_score: number | null
  post_fl_score: number | null
  post_ml_score: number | null
  post_character_development_score: number | null
  post_pacing_score: number | null
  post_art_visual_score: number | null
  post_impact_immersion_score: number | null
  post_originality_score: number | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  category_scores: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  platform_ratings: any[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  work_tags?: any[]
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
  tags: Array<{ name: string; group: string | null }>
  /** Média simples dos 8 post-reading-scores setados. `null` se nenhum. */
  meanPostScore: number | null
  // sinais derivados do TasteProfile (preenchidos quando profile não é stub)
  lovedTagOverlap: number | null
  avoidedTagOverlap: number | null
  criterionFitScore: number | null
  // calculados em memória
  iaEvalRaw: number
  iaEvalNormalized: number
  chaptersNormalized: number
  platformAvg: number | null
  calcScore: number
  predictedScore: number | null
  predictionDistance: number | null
  finalScore: number | null
  personalFit: number | null
  finalScoreConfidence: number | null
  // kNN sobre embeddings (Passo 5) — null quando obra não tem embedding ou < 3 vizinhos rotulados
  knnScore: number | null
  knnNeighbors: Array<KnnNeighbor & { weight: number }> | null
  knnDistanceTo5thNeighbor: number | null
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
  const tags: Array<{ name: string; group: string | null }> = (raw.work_tags ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((wt: any) => wt?.tags)
    .filter((t: { name?: string | null } | null | undefined): t is { name: string; tag_group_id?: string | null } => Boolean(t?.name))
    .map((t: { name: string; tag_group_id?: string | null }) => ({
      name: t.name,
      group: t.tag_group_id ? TAG_GROUP_ID_TO_NORMALIZED_SLUG[t.tag_group_id] ?? null : null,
    }))

  // Média simples dos post-reading-scores presentes. Quando nenhum é setado,
  // fica null — o MedianImputer cuida no Ridge.
  const postValues: number[] = []
  for (const field of POST_SCORE_FIELDS) {
    const v = raw[field]
    if (v != null) postValues.push(Number(v))
  }
  const meanPostScore = postValues.length > 0
    ? postValues.reduce((a, b) => a + b, 0) / postValues.length
    : null

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
    tags,
    meanPostScore,
    lovedTagOverlap: null,
    avoidedTagOverlap: null,
    criterionFitScore: null,
    iaEvalRaw: 0,
    iaEvalNormalized: 0,
    chaptersNormalized: 0,
    platformAvg: null,
    calcScore: 0,
    predictedScore: null,
    predictionDistance: null,
    finalScore: null,
    personalFit: null,
    finalScoreConfidence: null,
    knnScore: null,
    knnNeighbors: null,
    knnDistanceTo5thNeighbor: null,
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
    meanPostScore: w.meanPostScore,
    lovedTagOverlap: w.lovedTagOverlap,
    avoidedTagOverlap: w.avoidedTagOverlap,
    criterionFitScore: w.criterionFitScore,
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

  const [worksRes, weightsRes, configRes, tasteProfile] = await Promise.all([
    supabase
      .from("works")
      .select(
        `id, publication_status_id, total_chapters, synopsis_quality,
         observation_adjustment, manual_score, is_archived,
         post_story_score, post_fl_score, post_ml_score,
         post_character_development_score, post_pacing_score,
         post_art_visual_score, post_impact_immersion_score,
         post_originality_score,
         category_scores(criterion_slug, score),
         platform_ratings(id, platform, rating, vote_count),
         work_tags(tags(name, tag_group_id))`
      )
      .eq("is_archived", false)
      .limit(2000),
    supabase.from("score_weights").select("*").eq("is_active", true),
    supabase.from("formula_config").select("*").order("updated_at", { ascending: false }).limit(1),
    loadCurrentTasteProfile(),
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
      synopsisQuality: w.synopsisQuality,
      observationAdjustment: w.observationAdjustment,
      pseudoVotesBlend,
    })
  }

  // ---------- 2b) Features derivadas do TasteProfile pro Ridge ----------
  // Pré-computa loved/avoided tag overlap e criterion_fit a partir do perfil
  // atual. Quando o perfil é stub ou inexistente, todas ficam null e o
  // MedianImputer lida no pipeline. Mesmo profile usado em personal_fit (5b).
  const profileForFeatures = tasteProfile && !tasteProfile.is_stub ? tasteProfile.profile : null
  if (profileForFeatures) {
    for (const w of works) {
      w.lovedTagOverlap = weightedTagOverlap(w.tags, profileForFeatures.loved_tags)
      w.avoidedTagOverlap = weightedTagOverlap(w.tags, profileForFeatures.avoided_tags)
      w.criterionFitScore = criterionAlignment(w.categoryScores, profileForFeatures.criterion_preferences)
    }
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

  // ---------- 3b) kNN sobre embeddings ----------
  // Pra cada obra, busca os k vizinhos rotulados mais próximos no espaço
  // de embeddings e prediz via kernel Gaussiano. Quando a obra-alvo também
  // é rotulada, a RPC exclui ela mesma do conjunto candidato — efetivamente
  // leave-one-out por construção (sem leakage no stacker).
  //
  // Tolerante a falhas: obras sem embedding (ou se a RPC falhar) ficam com
  // knnScore = null e são tratadas pelo stacker como ausência de feature.
  const allWorkIds = works.map((w) => w.id)
  let knnBatch: Map<string, KnnNeighbor[]>
  try {
    knnBatch = await getKnnNeighborsBatch(allWorkIds, DEFAULT_K)
  } catch (err) {
    console.warn(
      "[recalculateAll] kNN batch falhou — seguindo sem essa feature:",
      err instanceof Error ? err.message : err,
    )
    knnBatch = new Map()
  }
  for (const w of works) {
    const neighbors = knnBatch.get(w.id) ?? []
    const knnResult = predictKnn(neighbors)
    w.knnScore = knnResult.prediction
    w.knnNeighbors = knnResult.neighbors.length > 0 ? knnResult.neighbors : null
    w.knnDistanceTo5thNeighbor = knnResult.distanceTo5thNeighbor
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

  // ---------- 4b) Fit do stacker (Ridge segundo-nível) ----------
  // Usa out-of-fold predictions do Ridge pra evitar leakage. Trainset == obras
  // com manual_score. Stacker fica como NULL quando treino < 30 ou Ridge é stub.
  //
  // kNN entra como 3ª feature SE estiver disponível pra TODAS as obras de
  // treino (knnScore não-null em todas). Caso contrário, treina com 2 features
  // (Calc + Ridge) — fail-safe pra obras de treino sem embedding ou com poucos
  // vizinhos rotulados.
  let stackerCoefs: StackerCoefficients | null = null
  if (!predictor.isStub && trainSet.length >= 30) {
    const oofRidge = ridgeOutOfFoldPredictions(trainInputs, trainTargets)
    if (oofRidge) {
      const trainKnnComplete = trainSet.every((w) => w.knnScore != null)
      stackerCoefs = fitStacker(
        trainSet.map((w, i) => ({
          calc: w.calcScore,
          ridge: oofRidge[i],
          knn: trainKnnComplete ? (w.knnScore as number) : null,
          manual: w.manualScore as number,
        })),
      )
    }
  }

  // ---------- 5) NotaFinal — stacker (se habilitado e disponível) ou inverse-variance ----------
  const useStacker = (config.stacker_enabled ?? false) && stackerCoefs != null
  for (const w of works) {
    if (w.predictedScore == null || predictor.isStub) {
      // Calibração insuficiente em qualquer caminho — cai pra Calc puro.
      w.finalScore = w.calcScore
    } else {
      w.finalScore = calculateNotaFinalChoosing(
        w.calcScore,
        w.predictedScore,
        newRmseCalc,
        newRmsePredicted,
        distanceFactor(w.predictionDistance),
        useStacker,
        stackerCoefs,
        w.knnScore,
      )
    }
  }

  // ---------- 5b) Personal fit (determinístico, a partir do TasteProfile) ----------
  // Quando o perfil é stub ou inexistente, personalFit fica null pra todas
  // as obras — o ranking pode cair pra final_score como fallback.
  const profilePayload = tasteProfile && !tasteProfile.is_stub ? tasteProfile.profile : null
  if (profilePayload) {
    for (const w of works) {
      w.personalFit = computePersonalFit(profilePayload, {
        tags: w.tags,
        categoryScores: w.categoryScores,
      })
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

  // ---------- 5c) Confiança individual na Nota.Final ----------
  // Computada agora porque depende de rmse_final (vindo do calibration acima),
  // distance_p95 e do flag de stub. Persistida pra evitar recomputar a cada
  // render e permitir sort/filter "alta confiança".
  for (const w of works) {
    w.finalScoreConfidence = calculateFinalScoreConfidence({
      rmseFinal: finalCalibration.rmseFinal,
      predictedIsStub: predictor.isStub,
      predictionDistance: w.predictionDistance,
      distanceP95,
    })
  }

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
    personal_fit: w.personalFit,
    final_score_confidence: w.finalScoreConfidence,
    knn_score: w.knnScore,
    knn_neighbors: w.knnNeighbors,
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
      stacker_coefficients: stackerCoefs
        ? {
            intercept: stackerCoefs.intercept,
            calcWeight: stackerCoefs.calcWeight,
            ridgeWeight: stackerCoefs.ridgeWeight,
            knnWeight: stackerCoefs.knnWeight,
            trainSize: stackerCoefs.trainSize,
            cvMAE: stackerCoefs.cvMAE,
          }
        : null,
      last_recalculated_at: new Date().toISOString(),
    })
    .eq("id", config.id)
  if (configUpdateErr) throw new Error(configUpdateErr.message)

  // Snapshot histórico — append-only. Falha aqui não invalida o recálculo;
  // só perde uma entrada do gráfico de tendência.
  const { error: historyErr } = await supabase.from("calibration_history").insert({
    formula_version: config.formula_version,
    stacker_enabled: useStacker,
    mae_loocv_stacker: stackerCoefs?.cvMAE ?? null,
    mae_final: finalCalibration.maeFinal,
    mae_calc: newMaeCalc,
    mae_predicted: newMaePredicted,
    train_size: predictor.trainSize,
    total_works: works.length,
    stacker_coefficients: stackerCoefs
      ? {
          intercept: stackerCoefs.intercept,
          calcWeight: stackerCoefs.calcWeight,
          ridgeWeight: stackerCoefs.ridgeWeight,
          knnWeight: stackerCoefs.knnWeight,
          trainSize: stackerCoefs.trainSize,
          cvMAE: stackerCoefs.cvMAE,
        }
      : null,
  })
  if (historyErr) {
    console.warn("[recalculateAll] calibration_history insert falhou:", historyErr.message)
  }

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
      stacker: stackerCoefs
        ? {
            enabled: useStacker,
            intercept: stackerCoefs.intercept,
            calcWeight: stackerCoefs.calcWeight,
            ridgeWeight: stackerCoefs.ridgeWeight,
            knnWeight: stackerCoefs.knnWeight,
            trainSize: stackerCoefs.trainSize,
            cvMAE: stackerCoefs.cvMAE,
          }
        : null,
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

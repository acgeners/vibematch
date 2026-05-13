"use server"

import { revalidatePath } from "next/cache"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  calculateGPT,
  normalizeGPT,
  sumVotes,
  calculatePlatformAvg,
  computeGlobalPlatformMean,
  normalizeChapters,
  calculateNotaCalc,
  calculateNotaFinal,
} from "@/lib/calculations"
import { trainPredictor, type PredictionInput } from "@/lib/calculations/prediction"
import { computeCalibration } from "@/lib/calculations/calibration"
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
  publication_status: string
  personal_status: string
  total_chapters: number | null
  synopsis_quality: string | null
  observation_penalty: number
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
  observationPenalty: number
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
    publicationStatus: raw.publication_status,
    totalChapters: raw.total_chapters,
    synopsisQuality: raw.synopsis_quality as SynopsisQuality | null,
    observationPenalty: Number(raw.observation_penalty ?? 0),
    categoryScores,
    platformRatings,
    totalVotes: sumVotes(platformRatings),
    iaEvalRaw: 0,
    iaEvalNormalized: 0,
    chaptersNormalized: 0,
    platformAvg: null,
    calcScore: 0,
    predictedScore: null,
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
    observationPenalty: w.observationPenalty,
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
        `id, publication_status, personal_status, total_chapters, synopsis_quality,
         observation_penalty, manual_score, is_archived,
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

  const pseudoVotesNotaM = interimCalibration.pseudoVotesNotaM
  const pseudoVotesBlend = interimCalibration.pseudoVotesBlend

  // ---------- 2) GPT, GPT.N, Cps.N, Nota.M, Nota.Calc ----------
  for (const w of works) {
    w.iaEvalRaw = calculateGPT(w.categoryScores, weights)
    w.iaEvalNormalized = normalizeGPT(w.iaEvalRaw)
    w.chaptersNormalized = normalizeChapters(w.totalChapters)
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
      observationPenalty: w.observationPenalty,
      pseudoVotesBlend,
    })
  }

  // ---------- 3) Treinar Ridge e prever Nota.Pr ----------
  const trainSet = works.filter((w) => w.manualScore != null)
  const trainInputs = trainSet.map(buildPredictionInput)
  const trainTargets = trainSet.map((w) => w.manualScore as number)

  const predictor = trainPredictor(trainInputs, trainTargets)
  const allInputs = works.map(buildPredictionInput)
  const predictions = predictor.predict(allInputs)
  for (let i = 0; i < works.length; i++) {
    works[i].predictedScore = predictions[i]
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

  // ---------- 5) NotaFinal com MAEs novos ----------
  for (const w of works) {
    if (w.predictedScore == null) {
      w.finalScore = null
    } else {
      w.finalScore = calculateNotaFinal(w.calcScore, w.predictedScore, newMaeCalc, newMaePredicted)
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
    formula_version: config.formula_version,
    calculated_at: new Date().toISOString(),
  }))

  const { error: upsertErr } = await supabase
    .from("calculated_scores")
    .upsert(rows, { onConflict: "work_id" })
  if (upsertErr) throw new Error(upsertErr.message)

  // ---------- 7) Persistir novo formula_config ----------
  const { error: configUpdateErr } = await supabase
    .from("formula_config")
    .update({
      mae_calc: newMaeCalc,
      mae_predicted: newMaePredicted,
      pseudo_votes_nota_m: pseudoVotesNotaM,
      pseudo_votes_blend: pseudoVotesBlend,
    })
    .eq("id", config.id)
  if (configUpdateErr) throw new Error(configUpdateErr.message)

  revalidatePath("/titles")
  revalidatePath("/ranking")
  revalidatePath("/settings")
  revalidatePath("/")

  return {
    recalculated: works.length,
    calibration: {
      trainSize: predictor.trainSize,
      isStub: predictor.isStub,
      alpha: predictor.model.alpha,
      cvMAE: predictor.model.cvMAE,
      cvRMSE: predictor.model.cvRMSE,
      maeCalc: newMaeCalc,
      maePredicted: newMaePredicted,
      maeFinal: finalCalibration.maeFinal,
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

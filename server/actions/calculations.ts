"use server"

import { revalidatePath, revalidateTag } from "next/cache"
import { after } from "next/server"
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
import { calculateGPTWithDiagnostics, calculateGPT } from "@/lib/calculations/gpt"
import { getCurrentUserId, getCurrentPlan } from "@/server/queries/current-user"
import { planAllows } from "@/lib/plans/capabilities"
import { getBiasMap } from "@/lib/calculations/attribute-bias"
import {
  applyBiasToCategoryScores,
  type AttributeBiasMap,
  type CategoryScoreWithSource,
} from "@/lib/ai-recommendation/calibrated-scores"
import {
  ridgeOutOfFoldPredictions,
  trainPredictor,
  type PredictionInput,
} from "@/lib/calculations/prediction"
import {
  trainExpectedPredictor,
  type ExpectedScoreInput,
} from "@/lib/calculations/expected"
import {
  inferScoreWeights,
  type WeightInferenceInput,
  type CurrentWeight,
  type WeightInferenceResult,
} from "@/lib/ml/weight-inference"
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
import {
  CRITERION_SLUGS,
  type CategoryScoreMap,
  type CriterionSlug,
  type ScoreWeight,
  type PlatformRating,
  type FormulaConfig,
  type SynopsisQuality,
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

/**
 * Ajuste manual de observação aplicado de forma determinística sobre a Nota
 * Esperada — clamp ∈ [-0.30, +0.30], soma direta em pontos de nota, resultado
 * clampado em [0, 10]. Restaura o comportamento do legado Nota.Calc agora que
 * `ObsAdjustment` não é mais feature do Ridge (ver lib/calculations/expected.ts).
 */
function applyObsAdjustment(expected: number, observationAdjustment: number): number {
  const obs = Math.min(Math.max(observationAdjustment, -0.3), 0.3)
  return Math.max(0, Math.min(10, expected + obs))
}

interface RawWork {
  id: string
  publication_status_id: number | null
  total_chapters: number | null
  synopsis_quality: string | null
  observation_adjustment: number
  user_score: number | null
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
  userScore: number | null
  publicationStatus: string
  totalChapters: number | null
  synopsisQuality: SynopsisQuality | null
  observationAdjustment: number
  categoryScores: CategoryScoreMap
  /**
   * categoryScores com offset de atributos aplicado (Fase 1.5). Usado nos
   * features do Ridge, criterionFit e personalFit — NÃO no calc_score (Nota.IA
   * fica como opinião crua da IA). Idêntico a categoryScores quando o biasMap
   * é zero (obras sem nenhum atributo de origem IA, ou sem bias coletado).
   */
  categoryScoresCalibrated: CategoryScoreMap
  platformRatings: PlatformRating[]
  totalVotes: number
  tags: Array<{ name: string; group: string | null }>
  /** Média simples dos 8 post-reading-scores setados. `null` se nenhum. */
  meanPostScore: number | null
  /** Map field → value pros 8 post-reading scores (input do Stage 2). */
  postScores: Partial<Record<(typeof POST_SCORE_FIELDS)[number], number | null>>
  // sinais derivados do TasteProfile (preenchidos quando profile não é stub)
  lovedTagOverlap: number | null
  avoidedTagOverlap: number | null
  criterionFitScore: number | null
  // calculados em memória
  iaEvalRaw: number
  iaEvalNormalized: number
  /** iaEvalNormalized derivado dos categoryScoresCalibrated — feature do Ridge. */
  iaEvalNormalizedCalibrated: number
  chaptersNormalized: number
  platformAvg: number | null
  calcScore: number
  predictedScore: number | null
  predictionDistance: number | null
  finalScore: number | null
  /** Shadow mode: L1 expected_score (2-stage: baseline + quality adj). */
  expectedScore: number | null
  /** Stage 1 puro (baseline a partir do perfil). */
  expectedBaseline: number | null
  /** Stage 2 puro (ajuste de qualidade ±). 0 quando Stage 2 não rodou. */
  expectedQualityAdj: number | null
  expectedIsStub: boolean
  personalFit: number | null
  /** Percentil (0–100) do personalFit dentro da biblioteca (migration 071). */
  personalFitPercentile: number | null
  finalScoreConfidence: number | null
  // kNN sobre embeddings (Passo 5) — null quando obra não tem embedding ou < 3 vizinhos rotulados
  knnScore: number | null
  knnNeighbors: Array<KnnNeighbor & { weight: number }> | null
  knnDistanceTo5thNeighbor: number | null
}

function buildWork(raw: RawWork, biasMap: AttributeBiasMap): WorkComputed {
  const categoryScores: CategoryScoreMap = {}
  const withSource: Partial<Record<CriterionSlug, CategoryScoreWithSource>> = {}
  for (const cs of raw.category_scores ?? []) {
    categoryScores[cs.criterion_slug] = Number(cs.score)
    withSource[cs.criterion_slug as CriterionSlug] = {
      value: Number(cs.score),
      source: (cs.source ?? "imported") as CategoryScoreWithSource["source"],
    }
  }
  // Offset de atributos aplicado on-read (Fase 1.5). Só corrige notas de
  // origem IA (ai_accepted/ai_calibrated); demais passam intactas. Slugs
  // ausentes viram null → omitidos do map calibrado.
  const calibrated = applyBiasToCategoryScores(withSource, biasMap)
  const categoryScoresCalibrated: CategoryScoreMap = {}
  for (const slug of CRITERION_SLUGS) {
    const v = calibrated[slug as CriterionSlug]
    if (v != null) categoryScoresCalibrated[slug] = v
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

  const postScores: Partial<Record<(typeof POST_SCORE_FIELDS)[number], number | null>> = {}
  for (const field of POST_SCORE_FIELDS) {
    const v = raw[field]
    postScores[field] = v == null ? null : Number(v)
  }

  return {
    id: raw.id,
    userScore: raw.user_score == null ? null : Number(raw.user_score),
    publicationStatus: getPublicationStatusNameById(raw.publication_status_id) ?? "Unknown",
    totalChapters: raw.total_chapters,
    synopsisQuality: raw.synopsis_quality as SynopsisQuality | null,
    observationAdjustment: Number(raw.observation_adjustment ?? 0),
    categoryScores,
    categoryScoresCalibrated,
    platformRatings,
    totalVotes: sumVotes(platformRatings),
    tags,
    meanPostScore,
    postScores,
    lovedTagOverlap: null,
    avoidedTagOverlap: null,
    criterionFitScore: null,
    iaEvalRaw: 0,
    iaEvalNormalized: 0,
    iaEvalNormalizedCalibrated: 0,
    chaptersNormalized: 0,
    platformAvg: null,
    calcScore: 0,
    predictedScore: null,
    predictionDistance: null,
    finalScore: null,
    expectedScore: null,
    expectedBaseline: null,
    expectedQualityAdj: null,
    expectedIsStub: true,
    personalFit: null,
    personalFitPercentile: null,
    finalScoreConfidence: null,
    knnScore: null,
    knnNeighbors: null,
    knnDistanceTo5thNeighbor: null,
  }
}

function buildPredictionInput(w: WorkComputed): PredictionInput {
  return {
    categoryScores: w.categoryScoresCalibrated,
    iaEvalNormalized: w.iaEvalNormalizedCalibrated,
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
 * Input pro L1 (expected_score) — arquitetura 2-stage:
 *   - Stage 1 (baseline) usa features de perfil/tipo (incl. IA(n), tag overlaps,
 *     CriterionFitScore — tudo que descreve "que tipo de obra é essa").
 *   - Stage 2 (quality adj) usa os 8 post-reading scores granulares.
 */
function buildExpectedInput(w: WorkComputed): ExpectedScoreInput {
  return {
    categoryScores: w.categoryScoresCalibrated,
    iaEvalNormalized: w.iaEvalNormalizedCalibrated,
    platformAvg: w.platformAvg,
    totalVotes: w.totalVotes,
    totalChapters: w.totalChapters,
    synopsisQuality: w.synopsisQuality,
    observationAdjustment: w.observationAdjustment,
    publicationStatus: w.publicationStatus,
    lovedTagOverlap: w.lovedTagOverlap,
    avoidedTagOverlap: w.avoidedTagOverlap,
    criterionFitScore: w.criterionFitScore,
    postScores: w.postScores,
  }
}

/**
 * Reprocessa TODA a base:
 *   1. Calcula percentis de #Votos -> atualiza pseudo_votes_*
 *   2. Calcula GPT.N, Nota.M, Cps.N, Nota.Calc para todos
 *   3. Treina Ridge nos títulos com user_score e prediz Nota.Pr para todos
 *   4. Calcula MAEs reais -> atualiza mae_calc, mae_predicted
 *   5. Calcula NotaFinal com MAEs novos
 *   6. Bulk upsert em calculated_scores
 *   7. Persiste novo formula_config
 */
export async function recalculateAll() {
  const supabase = createAdminClient()

  // Offset de atributos (Fase 1.5) — carregado uma vez e aplicado on-read.
  const userId = await getCurrentUserId(supabase)
  const biasMap = await getBiasMap(userId, supabase)

  // L0+ (Bloco 2.1, Pago): incluiria as 8 features de qualidade no Ridge.
  // DESLIGADO: medição honesta mostrou que o estimador de qualidade via
  // sinopse/tags adiciona RUÍDO — MAE CV 0.63 vs baseline 0.54 (ver
  // plan-arquitetura-notas.md). A qualidade de execução não é prevísivel
  // pré-leitura a partir da mesma info que o modelo já tem. Infra (tabela,
  // estimador, backfill) mantida parada; reativar SÓ com um estimador
  // reviews-based (L0+ v2), flipando o flag abaixo.
  const L0_QUALITY_ENABLED = false
  const plan = await getCurrentPlan(supabase)
  const includeQuality = L0_QUALITY_ENABLED && planAllows(plan, "l0_quality_eval")

  const [worksRes, weightsRes, configRes, tasteProfile] = await Promise.all([
    supabase
      .from("works")
      .select(
        `id, publication_status_id, total_chapters, synopsis_quality,
         observation_adjustment, user_score, is_archived,
         post_story_score, post_fl_score, post_ml_score,
         post_character_development_score, post_pacing_score,
         post_art_visual_score, post_impact_immersion_score,
         post_originality_score,
         category_scores(criterion_slug, score, source),
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

  const works = (worksRes.data as RawWork[]).map((raw) => buildWork(raw, biasMap))

  // L0+ (Pago): pra obras SEM pós-leitura do user (não-lidas), preenche
  // postScores com a estimativa de qualidade da IA (ai_quality_predictions).
  // Só afeta as features de qualidade do expected_score (Nota.Pr usa meanPostScore,
  // que NÃO é tocado). Read works mantêm os valores reais do user.
  // Mapa work_id → qualidade estimada pela IA (todas as obras que tiverem).
  // Usado pra (1) preencher postScores das não-lidas e (2) o MAE CV honesto.
  const aiQualityByWork = new Map<string, Record<string, number>>()
  if (includeQuality) {
    const { data: qpred } = await supabase
      .from("ai_quality_predictions")
      .select("work_id, field, score")
    for (const r of (qpred ?? []) as Array<{ work_id: string; field: string; score: number | string }>) {
      const m = aiQualityByWork.get(r.work_id) ?? {}
      m[r.field] = Number(r.score)
      aiQualityByWork.set(r.work_id, m)
    }
    for (const w of works) {
      if (w.meanPostScore != null) continue // lida (tem pós-leitura real) — não sobrescreve
      const pred = aiQualityByWork.get(w.id)
      if (!pred) continue
      for (const field of POST_SCORE_FIELDS) {
        if (pred[field] != null) w.postScores[field] = pred[field]
      }
    }
  }
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
      userScore: w.userScore,
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

  // ---------- 1b) Pesos automáticos (opcional) ----------
  // Quando config.score_weights_auto = true (default desde migration 069),
  // inferimos pesos via Ridge sobre os 9 critérios contra user_score e
  // usamos no lugar dos manuais persistidos em score_weights. Pesos manuais
  // ficam preservados na tabela como fallback. Inferência cai pra os manuais
  // automaticamente quando treino < 20 (isStub).
  let effectiveWeights: ScoreWeight[] = weights
  let inferenceSnapshot: WeightInferenceResult | null = null
  if (config.score_weights_auto) {
    const inferenceInputs: WeightInferenceInput[] = works
      .filter((w) => w.userScore != null)
      .map((w) => ({
        workId: w.id,
        categoryScores: w.categoryScores,
        userScore: w.userScore as number,
      }))
    const knownSlugs = new Set<string>(CRITERION_SLUGS as readonly string[])
    const currentWeights: CurrentWeight[] = weights
      .filter((w): w is ScoreWeight & { slug: CriterionSlug } => knownSlugs.has(w.slug))
      .map((w) => ({ slug: w.slug as CriterionSlug, weight: w.weight }))
    inferenceSnapshot = inferScoreWeights(inferenceInputs, currentWeights)
    if (!inferenceSnapshot.isStub) {
      const weightBySlug = new Map<string, number>(
        inferenceSnapshot.suggestions.map((s) => [s.slug, s.suggestedWeight]),
      )
      effectiveWeights = weights.map((w) => ({
        ...w,
        weight: weightBySlug.get(w.slug) ?? w.weight,
      }))
    }
  }

  // ---------- 2) GPT, GPT.N, Cps.N, Nota.M, Nota.Calc ----------
  let gptClampHits = 0
  const gptNegativeActivations: Record<string, number> = {}
  for (const w of works) {
    const { value, diagnostics } = calculateGPTWithDiagnostics(w.categoryScores, effectiveWeights)
    w.iaEvalRaw = value
    w.iaEvalNormalized = normalizeGPT(value)
    // Versão calibrada do mesmo agregado, só pra feature do Ridge. calc_score
    // (Nota.IA) continua usando o valor cru acima.
    w.iaEvalNormalizedCalibrated = normalizeGPT(
      calculateGPT(w.categoryScoresCalibrated, effectiveWeights),
    )
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
      w.criterionFitScore = criterionAlignment(w.categoryScoresCalibrated, profileForFeatures.criterion_preferences)
    }
  }

  // ---------- 3) Treinar Ridge e prever Nota.Pr ----------
  const trainSet = works.filter((w) => w.userScore != null)
  const trainInputs = trainSet.map(buildPredictionInput)
  const trainTargets = trainSet.map((w) => w.userScore as number)

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

  // ---------- 3c) L1 novo: expected_score (single Ridge + decomposição) ----------
  // UM Ridge com 22 features (14 baseline + 8 quality granulares + Status one-hot)
  // treinado conjuntamente contra user_score. Decomposição "baseline + quality"
  // é computada pós-hoc via atribuição linear (intercept + Σ coef × x por grupo).
  // Mantém precisão do legacy (ratio ~0.98×) E dá interpretabilidade da
  // contribuição de cada axis pra o waterfall.
  const expectedTrainInputs = trainSet.map(buildExpectedInput)
  const expectedAllInputs = works.map(buildExpectedInput)
  const expectedPredictor = trainExpectedPredictor(expectedTrainInputs, trainTargets, includeQuality)
  const expectedPredictions = expectedPredictor.predict(expectedAllInputs)
  for (let i = 0; i < works.length; i++) {
    const p = expectedPredictions[i]
    // observation_adjustment volta a ser um ajuste manual DETERMINÍSTICO (±0.30)
    // somado sobre a Nota Esperada — não é mais feature do Ridge (ver
    // lib/calculations/expected.ts). Embute só no expected_score entregue;
    // baseline/qualityAdj permanecem a decomposição crua do modelo, e o MAE/CV
    // continuam medindo só o poder preditivo do modelo (sem o nudge manual).
    works[i].expectedScore = applyObsAdjustment(p.expected, works[i].observationAdjustment)
    works[i].expectedBaseline = p.baseline
    works[i].expectedQualityAdj = p.qualityAdj
    works[i].expectedIsStub = expectedPredictor.isStub
  }

  // MAE in-sample decomposto: baseline-only, combined (baseline+qualityAdj).
  // Mesma metodologia de mae_calc/mae_predicted pra comparação direta.
  let maeExpected: number | null = null
  let rmseExpected: number | null = null
  let maeExpectedBaseline: number | null = null
  if (!expectedPredictor.isStub && trainSet.length > 0) {
    const trainPreds = expectedPredictor.predict(expectedTrainInputs)
    let sumAbsCombined = 0
    let sumSqCombined = 0
    let sumAbsBaseline = 0
    for (let i = 0; i < trainSet.length; i++) {
      const manual = trainSet[i].userScore as number
      const diffCombined = trainPreds[i].expected - manual
      const diffBaseline = trainPreds[i].baseline - manual
      sumAbsCombined += Math.abs(diffCombined)
      sumSqCombined += diffCombined * diffCombined
      sumAbsBaseline += Math.abs(diffBaseline)
    }
    maeExpected = sumAbsCombined / trainSet.length
    rmseExpected = Math.sqrt(sumSqCombined / trainSet.length)
    maeExpectedBaseline = sumAbsBaseline / trainSet.length
  }

  // MAE CV HONESTO (Pago/includeQuality): k-fold onde as obras held-out são
  // previstas com a qualidade ESTIMADA pela IA (como nas não-lidas), NÃO com os
  // post-scores reais. Quebra a circularidade (user_score = média dos post-scores)
  // que torna o cv_mae do modelo otimista. Sem estimativa IA pra a obra held-out,
  // cai pra qualidade vazia (mediana) → conservador até o backfill cobrir as lidas.
  let honestCvMae: number | null = null
  if (includeQuality && !expectedPredictor.isStub && trainSet.length >= 20) {
    const idx = trainSet.map((_, i) => i)
    let state = 42
    const rand = () => {
      state = (state * 1664525 + 1013904223) >>> 0
      return state / 0x100000000
    }
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[idx[i], idx[j]] = [idx[j], idx[i]]
    }
    const k = trainSet.length < 50 ? trainSet.length : 5
    const folds: number[][] = Array.from({ length: k }, () => [])
    idx.forEach((v, i) => folds[i % k].push(v))
    let sumAbs = 0
    let count = 0
    for (const fold of folds) {
      const testSet = new Set(fold)
      const trIn: ExpectedScoreInput[] = []
      const trTg: number[] = []
      for (let i = 0; i < trainSet.length; i++) {
        if (testSet.has(i)) continue
        trIn.push(expectedTrainInputs[i]) // treino com qualidade real
        trTg.push(trainSet[i].userScore as number)
      }
      if (trIn.length < 20) continue
      const foldPred = trainExpectedPredictor(trIn, trTg, true)
      if (foldPred.isStub) continue
      const heldInputs = fold.map((i) => ({
        ...expectedTrainInputs[i],
        postScores: (aiQualityByWork.get(trainSet[i].id) ?? {}) as ExpectedScoreInput["postScores"],
      }))
      const preds = foldPred.predict(heldInputs)
      for (let j = 0; j < fold.length; j++) {
        sumAbs += Math.abs(preds[j].expected - (trainSet[fold[j]].userScore as number))
        count++
      }
    }
    if (count > 0) honestCvMae = sumAbs / count
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
      userScore: w.userScore,
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
  // com user_score. Stacker fica como NULL quando treino < 30 ou Ridge é stub.
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
          manual: w.userScore as number,
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
        categoryScores: w.categoryScoresCalibrated,
      })
    }

    // Percentil dentro da biblioteca (migration 071). O personalFit cru tem
    // teto matematicamente baixo (~0.55 mesmo nas melhores obras) — o
    // percentil comunica "Top X%" que é mais honesto na UI.
    const fits = works
      .map((w) => w.personalFit)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b)
    if (fits.length > 0) {
      // Ranks por valor (primeira ocorrência) — tie-break por midpoint.
      const rankByValue = new Map<number, number>()
      for (let i = 0; i < fits.length; i++) {
        if (!rankByValue.has(fits[i])) rankByValue.set(fits[i], i)
      }
      const countByValue = new Map<number, number>()
      for (const v of fits) countByValue.set(v, (countByValue.get(v) ?? 0) + 1)

      for (const w of works) {
        if (w.personalFit == null) continue
        const firstIdx = rankByValue.get(w.personalFit) ?? 0
        const tieCount = countByValue.get(w.personalFit) ?? 1
        // Midpoint percentile: (firstIdx + tieCount/2) / N × 100
        const pct = ((firstIdx + tieCount / 2) / fits.length) * 100
        w.personalFitPercentile = Math.round(pct * 100) / 100
      }
    }
  }

  // Recalibração final só pra reportar mae_final (não vai pro config)
  const finalCalibration = computeCalibration(
    works.map((w) => ({
      workId: w.id,
      userScore: w.userScore,
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
    expected_score: w.expectedScore,
    expected_baseline: w.expectedBaseline,
    expected_quality_adj: w.expectedQualityAdj,
    expected_is_stub: w.expectedIsStub,
    mae_calc: newMaeCalc,
    mae_predicted: newMaePredicted,
    rmse_calc: newRmseCalc,
    rmse_predicted: newRmsePredicted,
    prediction_distance: w.predictionDistance,
    personal_fit: w.personalFit,
    personal_fit_percentile: w.personalFitPercentile,
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

  // Headline "Precisão da previsão". Pago: MAE CV honesto (held-out com
  // qualidade estimada pela IA — não-circular). Free: cvMAE do modelo
  // (sem qualidade, já honesto). Fallback pro cvMAE se o honesto não rodou.
  // Persistido tanto no config (headline) quanto no calibration_history
  // (trendline honesta).
  const cvMaeExpected: number | null = expectedPredictor.isStub
    ? null
    : includeQuality
      ? (honestCvMae ?? expectedPredictor.model.cvMAE)
      : expectedPredictor.model.cvMAE

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
      ridge_coefficients: predictor.isStub
        ? null
        : {
            featureNames: predictor.featureNames,
            coefficients: predictor.model.coefficients,
          },
      score_weights_inferred: inferenceSnapshot && !inferenceSnapshot.isStub
        ? {
            suggestions: inferenceSnapshot.suggestions,
            trainSize: inferenceSnapshot.trainSize,
            alpha: inferenceSnapshot.alpha,
            cvMAE: inferenceSnapshot.cvMAE,
          }
        : null,
      mae_expected: maeExpected,
      rmse_expected: rmseExpected,
      mae_expected_baseline: maeExpectedBaseline,
      cv_mae_expected_stage1: cvMaeExpected,
      // Sem treino sequencial: stage2 cvMAE não existe mais; valor de baseline
      // serve de proxy de "quanto o modelo erra sem qualidade" no painel.
      cv_mae_expected_stage2: null,
      expected_stage2_train_size: expectedPredictor.isStub
        ? null
        : expectedPredictor.trainWithPostScores,
      expected_ridge_coefficients: expectedPredictor.isStub
        ? null
        : {
            featureNames: expectedPredictor.featureNames,
            coefficients: expectedPredictor.model.coefficients,
          },
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
    mae_expected: maeExpected,
    cv_mae_expected: cvMaeExpected,
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
  revalidateTag("low-coverage", "max")

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
      maeExpected,
      maeExpectedBaseline,
      rmseCalc: newRmseCalc,
      rmsePredicted: newRmsePredicted,
      rmseFinal: finalCalibration.rmseFinal,
      rmseExpected,
      expectedIsStub: expectedPredictor.isStub,
      expectedTrainSize: expectedPredictor.trainSize,
      expectedTrainWithPostScores: expectedPredictor.trainWithPostScores,
      expectedFeatureNames: expectedPredictor.featureNames,
      expectedCoefficients: expectedPredictor.model.coefficients,
      expectedCvMAE: expectedPredictor.model.cvMAE,
      expectedBaselineIndices: expectedPredictor.baselineIndices,
      expectedQualityIndices: expectedPredictor.qualityIndices,
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

// Coalescing guard compartilhado: vários saves em sequência (ex.: o fluxo
// "Terminei de ler" dispara updateWorkStatus + submitPostReadingAttributes, e o
// usuário pode salvar várias vezes) não devem rodar N recalc-all completos em
// paralelo. Se já há um em voo, marca um rerun e roda UMA vez ao final.
let recalcInFlight = false
let recalcRerunQueued = false

/**
 * Dispara `recalculateAll()` em background via `after()` (não bloqueia a resposta
 * do server action) e coalesce chamadas concorrentes. Use isto em vez de
 * `await recalculateAll()` em qualquer save que só precise que os scores
 * atualizem "logo depois".
 */
export async function recalculateAllInBackground(context: string): Promise<void> {
  after(async () => {
    if (recalcInFlight) {
      recalcRerunQueued = true
      return
    }
    recalcInFlight = true
    try {
      do {
        recalcRerunQueued = false
        await recalculateAll()
      } while (recalcRerunQueued)
    } catch (error) {
      console.error(`[${context}] Failed to recalculate scores`, error)
    } finally {
      recalcInFlight = false
    }
  })
}

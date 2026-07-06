// NÃO é "use server": este módulo exporta funções PURAS síncronas (computeRecalc,
// buildWork) usadas pelo recalc e por diagnósticos — e Server Actions exigem que
// todo export seja async. `recalculateAll` é chamado só server-side (recalc-queue,
// scripts), nunca como Server Action direta de um client; `server-only` garante
// que o módulo nunca entre no bundle do cliente.
import "server-only"

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
  trainExpectedPredictor,
  expectedOutOfFoldPredictions,
  type ExpectedScoreInput,
} from "@/lib/calculations/expected"
import {
  trainChancePredictor,
  CHANCE_LIKED_THRESHOLD,
  type ChanceInput,
} from "@/lib/calculations/chance"
import {
  inferScoreWeights,
  type WeightInferenceInput,
  type CurrentWeight,
  type WeightInferenceResult,
} from "@/lib/ml/weight-inference"
import { computeCalibration } from "@/lib/calculations/calibration"
import {
  criterionAlignment,
  weightedTagOverlap,
  netNameOverlap,
} from "@/lib/ai-recommendation/personal-fit"
import { loadCurrentTasteProfile } from "@/lib/ai-recommendation/taste-profile"
import {
  buildTasteProfileHeuristic,
  buildRatedTagCounts,
  mergeDeclaredTagPreferences,
} from "@/lib/ai-recommendation/taste-profile-heuristic"
import { getDeclaredTagPreferences } from "@/server/queries/tag-preferences"
import type { DeclaredTagPref } from "@/server/queries/tag-preferences"
import type { TasteProfilePayload } from "@/lib/ai-recommendation/types"
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

export interface RawWork {
  id: string
  publication_status_id: number | null
  total_chapters: number | null
  synopsis_quality: string | null
  observation_adjustment: number
  user_score: number | null
  is_archived: boolean
  year: number | null
  year_end: number | null
  original_title: string | null
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
  /** Idade (ano atual − ano de início), duração e origem — features do expected. */
  releaseAge: number | null
  runLength: number | null
  origin: string
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
  /** Nota.Calc sem o nudge de observação — parceiro do blend expected⊕calc. */
  calcScoreNoObs: number
  /** Nota Prevista (single Ridge + blend com Nota.Calc). */
  expectedScore: number | null
  /** Stage 1 puro (baseline a partir do perfil). */
  expectedBaseline: number | null
  /** Stage 2 puro (ajuste de qualidade ±). 0 quando Stage 2 não rodou. */
  expectedQualityAdj: number | null
  expectedIsStub: boolean
  personalFit: number | null
  /** Percentil (0–100) do personalFit dentro da biblioteca (migration 071). */
  personalFitPercentile: number | null
  /** Overlap líquido por NOME (amado − 1.5×evitado) — base do Alinhamento e do
   * desempate intra-tier (substitui o net por group::name a partir de 2026-06-27). */
  netName: number | null
  /** Chance de gostar 0–100 (Força 1 da Bússola). NULL quando o modelo é stub. */
  chanceScore: number | null
  chanceIsStub: boolean
}

const CURRENT_YEAR = new Date().getFullYear()

/**
 * Origem inferida pelo script do título original — feature do expected_score
 * (preferência de mídia): Hangul → "ko" (manhwa) | Kana → "ja" (mangá) | Han
 * sem kana/hangul → "zh" (manhua) | latino/outro → "other" | vazio → "unknown".
 */
function detectOrigin(originalTitle: string | null): string {
  if (!originalTitle) return "unknown"
  if (/[가-힯ᄀ-ᇿ]/.test(originalTitle)) return "ko"
  if (/[぀-ヿ]/.test(originalTitle)) return "ja"
  if (/[一-鿿]/.test(originalTitle)) return "zh"
  return "other"
}

export function buildWork(raw: RawWork, biasMap: AttributeBiasMap): WorkComputed {
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
    releaseAge: raw.year != null ? CURRENT_YEAR - raw.year : null,
    runLength: raw.year != null && raw.year_end != null ? raw.year_end - raw.year : null,
    origin: detectOrigin(raw.original_title),
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
    calcScoreNoObs: 0,
    expectedScore: null,
    expectedBaseline: null,
    expectedQualityAdj: null,
    expectedIsStub: true,
    personalFit: null,
    personalFitPercentile: null,
    netName: null,
    chanceScore: null,
    chanceIsStub: false,
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
    releaseAge: w.releaseAge,
    runLength: w.runLength,
    origin: w.origin,
    postScores: w.postScores,
  }
}

/**
 * MAE CV TRULY honesta da Nota Prevista (expected_score).
 *
 * Diferente do `model.cvMAE` interno do RidgeCV — que é otimista porque (a) o
 * StandardScaler/imputer são fitados em TODAS as rotuladas antes do split do CV
 * e (b) as features de perfil (criterionFit, tag-overlaps, IA(n) calibrado) são
 * computadas uma vez com o perfil+pesos fitados em todas as rotuladas, então a
 * fold held-out já "viu" o próprio rótulo via feature — aqui o perfil de gosto e
 * os pesos auto-inferidos são RECOMPUTADOS dentro de cada fold só com o treino
 * do fold, e o predictor (com seu próprio pré-processamento) é re-treinado por
 * fold. Tipicamente fica ~0.03-0.05 acima do cvMAE vazado.
 *
 * Resíduo conhecido: o offset de bias (categoryScoresCalibrated) é mantido fixo
 * (é offset de atributo da Fase 1.5, não derivado de user_score por obra).
 *
 * Retorna null quando treino < 30 (CV instável) ou tudo vira stub.
 */
function computeHonestExpectedCvMae(
  trainSet: WorkComputed[],
  baseWeights: ScoreWeight[],
  scoreWeightsAuto: boolean,
  includeQuality: boolean,
  /** Peso do blend expected⊕calc — mede o score ENTREGUE, não o Ridge puro. */
  blendWeight = 1,
  k = 5,
  seed = 42,
  /** Tags declaradas (exógenas) — mescladas no perfil de cada fold sem leak. */
  declared: DeclaredTagPref[] = [],
): number | null {
  const n = trainSet.length
  if (n < 30) return null

  const idx = Array.from({ length: n }, (_, i) => i)
  let state = seed
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  // Mesmo critério de folds do trainExpectedPredictor: LOOCV abaixo de 50.
  const effK = n < 50 ? n : k
  const folds: number[][] = Array.from({ length: effK }, () => [])
  idx.forEach((v, i) => folds[i % effK].push(v))

  const knownSlugs = new Set<string>(CRITERION_SLUGS as readonly string[])
  const currentWeights: CurrentWeight[] = baseWeights
    .filter((w): w is ScoreWeight & { slug: CriterionSlug } => knownSlugs.has(w.slug))
    .map((w) => ({ slug: w.slug as CriterionSlug, weight: w.weight }))

  let absSum = 0
  let count = 0
  for (const fold of folds) {
    const testSet = new Set(fold)
    const trainWorks = trainSet.filter((_, i) => !testSet.has(i))
    const testWorks = fold.map((i) => trainSet[i])
    if (trainWorks.length < 20) continue

    // Pesos do fold: re-inferidos só do treino (se auto); senão usa os manuais.
    let foldWeights = baseWeights
    if (scoreWeightsAuto) {
      const inf = inferScoreWeights(
        trainWorks.map((w) => ({
          workId: w.id,
          categoryScores: w.categoryScores,
          userScore: w.userScore as number,
        })),
        currentWeights,
      )
      if (!inf.isStub) {
        const bySlug = new Map<string, number>(
          inf.suggestions.map((s) => [s.slug, s.suggestedWeight]),
        )
        foldWeights = baseWeights.map((w) => ({ ...w, weight: bySlug.get(w.slug) ?? w.weight }))
      }
    }

    // Perfil de gosto do fold: construído só do treino → sem leak na held-out.
    // As tags declaradas são EXÓGENAS (ditas pelo usuário, constantes entre folds,
    // não derivam de rótulo held-out) → incluí-las não vaza e torna o MAE honesto
    // refletir a feature que existe em produção.
    const profile = buildTasteProfileHeuristic(
      trainWorks.map((w) => ({
        id: w.id,
        title: "",
        userScore: w.userScore,
        postScores: {},
        personalStatus: null,
        synopsis: null,
        categoryScores: w.categoryScores,
        tags: w.tags,
      })),
      declared,
    )

    const buildInput = (w: WorkComputed): ExpectedScoreInput => ({
      categoryScores: w.categoryScoresCalibrated,
      iaEvalNormalized: normalizeGPT(calculateGPT(w.categoryScoresCalibrated, foldWeights)),
      platformAvg: w.platformAvg,
      totalVotes: w.totalVotes,
      totalChapters: w.totalChapters,
      synopsisQuality: w.synopsisQuality,
      observationAdjustment: w.observationAdjustment,
      publicationStatus: w.publicationStatus,
      lovedTagOverlap: weightedTagOverlap(w.tags, profile.loved_tags),
      avoidedTagOverlap: weightedTagOverlap(w.tags, profile.avoided_tags),
      criterionFitScore: criterionAlignment(w.categoryScoresCalibrated, profile.criterion_preferences),
      releaseAge: w.releaseAge,
      runLength: w.runLength,
      origin: w.origin,
      postScores: w.postScores,
    })

    const predictor = trainExpectedPredictor(
      trainWorks.map(buildInput),
      trainWorks.map((w) => w.userScore as number),
      includeQuality,
    )
    if (predictor.isStub) continue
    const preds = predictor.predict(testWorks.map(buildInput))
    for (let i = 0; i < testWorks.length; i++) {
      // Mesmo blend que o score entregue: w·ridge + (1-w)·calcNoObs. Mede a
      // precisão do que o usuário vê, não só do Ridge. (Usar o blendWeight global
      // dentro do fold tem otimismo desprezível — é 1 escalar numa curva chata.)
      const blended = blendWeight * preds[i].expected + (1 - blendWeight) * testWorks[i].calcScoreNoObs
      absSum += Math.abs(blended - (testWorks[i].userScore as number))
      count++
    }
  }
  return count > 0 ? absSum / count : null
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
/**
 * Contexto de execução do recálculo. EXPLÍCITO (sem heurística de ambiente):
 *  - "next-runtime": Server Actions/páginas/gatilhos — usa leituras cacheadas
 *    (`unstable_cache`) e invalida o cache (`revalidatePath`/`revalidateTag`);
 *  - "headless": CLI/workers/scripts — usa leituras UNCACHED e PULA a invalidação
 *    de cache (não há request scope; `unstable_cache`/`revalidate*` lançariam
 *    "incrementalCache/static store missing"). Mesmo núcleo matemático e mesmas
 *    escritas funcionais nos dois caminhos.
 */
export type RecalculateExecutionContext = "next-runtime" | "headless"

export async function recalculateAll(ctx: RecalculateExecutionContext = "next-runtime") {
  const headless = ctx === "headless"
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

  const [worksRes, weightsRes, configRes, tasteProfile, declaredTagPrefs] = await Promise.all([
    supabase
      .from("works")
      .select(
        `id, publication_status_id, total_chapters, synopsis_quality,
         observation_adjustment, user_score, is_archived,
         year, year_end, original_title,
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
    getDeclaredTagPreferences(supabase, { headless }),
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

  // Interesse efetivo (manual ⊕ previsto mais recente) por obra — feature do
  // Chance de gostar (Força 1 da Bússola). Chunk pra não estourar o limite do .in().
  const effectiveInterestByWork = new Map<string, string | null>()
  {
    const bestPred = new Map<string, { ver: number; q: string | null }>()
    const workIds = works.map((w) => w.id)
    const chunks: string[][] = []
    for (let i = 0; i < workIds.length; i += 150) chunks.push(workIds.slice(i, i + 150))
    const predResults = await Promise.all(
      chunks.map((chunk) =>
        supabase
          .from("synopsis_quality_predictions")
          .select("work_id, predicted_quality, prompt_version")
          .in("work_id", chunk),
      ),
    )
    for (const res of predResults) {
      for (const r of (res.data ?? []) as Array<{ work_id: string; predicted_quality: string | null; prompt_version: string | null }>) {
        const m = (r.prompt_version ?? "").match(/(\d+)/)
        const ver = m ? parseInt(m[1], 10) : -1
        const prev = bestPred.get(r.work_id)
        if (!prev || ver > prev.ver) bestPred.set(r.work_id, { ver, q: r.predicted_quality ?? null })
      }
    }
    for (const w of works) {
      effectiveInterestByWork.set(w.id, w.synopsisQuality ?? bestPred.get(w.id)?.q ?? null)
    }
  }

  const {
    rows, pseudoVotesNotaM, pseudoVotesBlend, gptMean, gptClampHits, gptClampHitRate,
    gptNegativeActivations, negativeActivationRate, inferenceSnapshot, newMaeCalc, newRmseCalc,
    maeExpected, rmseExpected, maeExpectedBaseline, cvMaeExpected, calcBlendWeight, expectedPredictor,
    cvSig,
  } = computeRecalc({ works, weights, config, tasteProfile, declaredTagPrefs, includeQuality, aiQualityByWork, effectiveInterestByWork })

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

  // ---------- 7) Persistir novo formula_config ----------
  const { error: configUpdateErr } = await supabase
    .from("formula_config")
    .update({
      mae_calc: newMaeCalc,
      // Ramo legado removido — mae/rmse_predicted, distance_p95, stacker e
      // ridge_coefficients zerados (serão dropados em migration de follow-up).
      mae_predicted: null,
      rmse_calc: newRmseCalc,
      rmse_predicted: null,
      pseudo_votes_nota_m: pseudoVotesNotaM,
      pseudo_votes_blend: pseudoVotesBlend,
      // Centro da amplificação GPT.N (média do GPT cru deste recalc). Reusado
      // como `center` em normalizeGPT nos caminhos single-work.
      gpt_mean: gptMean,
      gpt_clamp_hit_rate: gptClampHitRate,
      negative_activation_rate: negativeActivationRate,
      distance_p95: null,
      stacker_coefficients: null,
      ridge_coefficients: null,
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
            // Peso do blend expected⊕calc aplicado ao score entregue (1 = sem blend).
            calcBlendWeight,
            // Assinatura dos inputs da nested-CV (quick-win Q): pula o recompute
            // de ~550ms quando as obras rotuladas não mudaram entre recalcs.
            cvSig: cvSig ?? undefined,
          },
      last_recalculated_at: new Date().toISOString(),
      // Limpa a pendência (migration 096) NO MESMO update — corta 1 round-trip
      // (~450ms no DB remoto) vs o UPDATE separado anterior. 096 está aplicada
      // (recalc_pending é lido pela fila/sonda). Race conhecido e benigno: uma
      // edição entre o load das obras e este UPDATE perde o flag até o próximo
      // trigger (single-user, janela de segundos; a próxima edição re-arma).
      recalc_pending: false,
      recalc_last_edit_at: null,
    })
    .eq("id", config.id)
  if (configUpdateErr) throw new Error(configUpdateErr.message)

  // Snapshot histórico — append-only. Falha aqui não invalida o recálculo;
  // só perde uma entrada do gráfico de tendência.
  const { error: historyErr } = await supabase.from("calibration_history").insert({
    formula_version: config.formula_version,
    stacker_enabled: false,
    mae_loocv_stacker: null,
    mae_final: null,
    mae_calc: newMaeCalc,
    mae_predicted: null,
    mae_expected: maeExpected,
    cv_mae_expected: cvMaeExpected,
    train_size: expectedPredictor.trainSize,
    total_works: works.length,
    stacker_coefficients: null,
  })
  if (historyErr) {
    console.warn("[recalculateAll] calibration_history insert falhou:", historyErr.message)
  }

  // Invalidação de cache só faz sentido (e só funciona) no runtime do Next.
  // Headless (CLI) não tem request scope ⇒ pular (senão lança "static store
  // missing"). O recálculo em si — escritas + limpeza de recalc_pending — já
  // ocorreu acima; o cache do app revalida no próximo page-load/gatilho normal.
  if (!headless) {
    revalidatePath("/titles")
    revalidatePath("/ranking")
    revalidatePath("/settings")
    revalidatePath("/")
    revalidateTag("score-color-thresholds", "max")
    revalidateTag("low-coverage", "max")
  }

  return {
    recalculated: works.length,
    diagnostics: {
      gptClampHits,
      gptClampHitRate,
      negativeActivationCounts: gptNegativeActivations,
      negativeActivationRate,
    },
    calibration: {
      // Campos do ramo legado (Nota.Pr/Final/stacker) zerados — a Nota Prevista
      // agora é o expected_score. Mantidos na shape pra não quebrar consumidores.
      trainSize: expectedPredictor.trainSize,
      isStub: expectedPredictor.isStub,
      alpha: expectedPredictor.model.alpha,
      cvMAE: expectedPredictor.model.cvMAE,
      cvRMSE: expectedPredictor.model.cvRMSE,
      maeCalc: newMaeCalc,
      maePredicted: null,
      maeFinal: null,
      maeExpected,
      maeExpectedBaseline,
      rmseCalc: newRmseCalc,
      rmsePredicted: null,
      rmseFinal: null,
      rmseExpected,
      expectedIsStub: expectedPredictor.isStub,
      expectedTrainSize: expectedPredictor.trainSize,
      expectedTrainWithPostScores: expectedPredictor.trainWithPostScores,
      expectedFeatureNames: expectedPredictor.featureNames,
      expectedCoefficients: expectedPredictor.model.coefficients,
      // cvMAE INTERNO do RidgeCV (só seleção de α por fold) — otimista/vazado.
      // Mantido pra diagnóstico; NÃO usar como vitrine.
      expectedCvMAE: expectedPredictor.model.cvMAE,
      // MAE CV HONESTA (mesmo número da headline cv_mae_expected_stage1):
      // nested-CV (Free) ou held-out com qualidade estimada (Pago). É a que o
      // toast/UI deve reportar. NULL em fallback/stub.
      expectedHonestCvMAE: cvMaeExpected,
      expectedBaselineIndices: expectedPredictor.baselineIndices,
      expectedQualityIndices: expectedPredictor.qualityIndices,
      pseudoVotesNotaM,
      pseudoVotesBlend,
      featureNames: expectedPredictor.featureNames,
      coefficients: expectedPredictor.model.coefficients,
      stacker: null,
    },
  }
}

/** FNV-1a 32-bit → string curta. Determinístico, sem deps. */
function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function stableMap(o: Record<string, unknown> | null | undefined): string {
  if (!o) return ""
  return Object.keys(o).sort().map((k) => `${k}=${o[k]}`).join(",")
}

/**
 * Assinatura FIEL dos inputs da nested-CV honesta (computeHonestExpectedCvMae).
 * A MAE honesta depende SÓ das obras ROTULADAS (ordem + label + features que a CV
 * usa) + pesos-base + flag auto + blend + tags declaradas. Edição de obra NÃO
 * rotulada (a comum) não muda nada disso ⇒ assinatura idêntica ⇒ reusa a MAE
 * persistida e pula os ~550ms da nested-CV. Quando uma obra rotulada (ou os votos
 * globais, via platformAvg) muda, a assinatura muda e a CV recomputa.
 */
function cvInputSignature(
  trainSet: WorkComputed[],
  weights: ScoreWeight[],
  scoreWeightsAuto: boolean,
  calcBlendWeight: number,
  declared: DeclaredTagPref[],
): string {
  const head = [
    `auto:${scoreWeightsAuto}`,
    `blend:${calcBlendWeight.toFixed(4)}`,
    `w:${weights.map((w) => `${w.slug}=${w.weight}`).sort().join("|")}`,
    `decl:${JSON.stringify(declared)}`,
  ]
  const body = trainSet.map((w) =>
    [
      w.id, w.userScore, stableMap(w.categoryScores), stableMap(w.categoryScoresCalibrated),
      w.platformAvg, w.totalVotes, w.totalChapters, w.synopsisQuality, w.observationAdjustment,
      w.publicationStatus, w.releaseAge, w.runLength, w.origin,
      stableMap(w.postScores as Record<string, unknown>),
      w.tags.map((t) => `${t.name}/${t.group ?? ""}`).sort().join(";"),
    ].join("~"),
  )
  return hashString([...head, ...body].join("\n"))
}

export interface RecalcComputeInput {
  works: WorkComputed[]
  weights: ScoreWeight[]
  config: FormulaConfig
  tasteProfile: Awaited<ReturnType<typeof loadCurrentTasteProfile>>
  declaredTagPrefs: DeclaredTagPref[]
  includeQuality: boolean
  aiQualityByWork: Map<string, Record<string, number>>
  /** Interesse efetivo (manual ⊕ previsto) por obra — feature do Chance (Força 1). */
  effectiveInterestByWork?: Map<string, string | null>
  /** Pula a nested-CV honesta (cara). Usado no diagnóstico leave-one-out. */
  fast?: boolean
}

/**
 * Núcleo PURO do recálculo (sem I/O — não lê nem escreve no banco). Recebe os
 * dados já carregados e devolve as linhas de calculated_scores + os agregados
 * pra formula_config. Extraído de recalculateAll pra testabilidade e pro
 * diagnóstico de blast radius (recomputar com 1 obra perturbada, em memória).
 */
export function computeRecalc(input: RecalcComputeInput) {
  const { works, weights, config, tasteProfile, declaredTagPrefs, includeQuality, aiQualityByWork, effectiveInterestByWork = new Map<string, string | null>(), fast = false } = input

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
  // Pass 1: GPT cru de todas — precisamos da média do catálogo antes de normalizar.
  let gptRawSum = 0
  for (const w of works) {
    const { value, diagnostics } = calculateGPTWithDiagnostics(w.categoryScores, effectiveWeights)
    w.iaEvalRaw = value
    gptRawSum += value
    w.chaptersNormalized = normalizeChapters(w.totalChapters)
    if (diagnostics.clampHit) gptClampHits += 1
    for (const [slug, activated] of Object.entries(diagnostics.negativeActivations)) {
      if (!activated) continue
      gptNegativeActivations[slug] = (gptNegativeActivations[slug] ?? 0) + 1
    }
  }
  // Centro da amplificação = média do GPT cru do catálogo (não o fixo 5). Remove
  // o viés sistemático que centrar em 5 introduzia (ver normalizeGPT). Persistido
  // em formula_config.gpt_mean e reusado nos caminhos single-work.
  const gptMean = works.length > 0 ? gptRawSum / works.length : 5
  // Pass 2: normaliza GPT.N com o centro do catálogo.
  for (const w of works) {
    w.iaEvalNormalized = normalizeGPT(w.iaEvalRaw, gptMean)
    // Versão calibrada do mesmo agregado, só pra feature do Ridge. Mantida em
    // center=5 — é indiferente, pois o StandardScaler do Ridge remove centro/escala.
    w.iaEvalNormalizedCalibrated = normalizeGPT(
      calculateGPT(w.categoryScoresCalibrated, effectiveWeights),
    )
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
    // Mesma Nota.Calc sem o nudge manual de observação — parceiro do blend
    // expected⊕calc, pra o obs ser aplicado UMA vez no fim (não duplicado: o
    // calc embute obs internamente e o expected_score reaplica via applyObsAdjustment).
    w.calcScoreNoObs = calculateNotaCalc({
      iaEvalNormalized: w.iaEvalNormalized,
      platformAvg: w.platformAvg,
      totalVotes: w.totalVotes,
      synopsisQuality: w.synopsisQuality,
      observationAdjustment: 0,
      pseudoVotesBlend,
    })
  }

  // ---------- 2b) Perfil efetivo: persistido ⊕ tags declaradas ----------
  // O perfil persistido (heurístico/LLM) é mesclado com as preferências de tag
  // DECLARADAS (amo/evito) via prior com encolhimento (λ=n/(n+k)). Aplicado
  // AQUI (não na geração do perfil) pra as declarações valerem já no próximo
  // recalc, mesmo com o perfil persistido defasado. Idempotente. Item A.
  const ratedTagCounts = buildRatedTagCounts(works.filter((w) => w.userScore != null))
  const baseProfile: TasteProfilePayload = tasteProfile && !tasteProfile.is_stub
    ? tasteProfile.profile
    : {
        loved_tags: [],
        avoided_tags: [],
        loved_themes: [],
        avoided_themes: [],
        criterion_preferences: {},
        narrative_patterns: [],
        summary: "",
      }
  const mergedProfile = mergeDeclaredTagPreferences(baseProfile, declaredTagPrefs, ratedTagCounts)
  // Sem sinal (loved/avoided/prefs vazios) → trata como null (comportamento legado).
  const effectiveProfile: TasteProfilePayload | null =
    mergedProfile.loved_tags.length ||
    mergedProfile.avoided_tags.length ||
    Object.keys(mergedProfile.criterion_preferences).length
      ? mergedProfile
      : null

  // Features derivadas do perfil efetivo pro Ridge. Perfil sem sinal → ficam null
  // e o MedianImputer lida no pipeline. Mesmo perfil usado em personal_fit (5b).
  if (effectiveProfile) {
    for (const w of works) {
      w.lovedTagOverlap = weightedTagOverlap(w.tags, effectiveProfile.loved_tags)
      w.avoidedTagOverlap = weightedTagOverlap(w.tags, effectiveProfile.avoided_tags)
      w.criterionFitScore = criterionAlignment(w.categoryScoresCalibrated, effectiveProfile.criterion_preferences)
    }
  }

  // ---------- 3) Conjunto de treino (obras com user_score) ----------
  // O ramo legado (Nota.Pr/Nota.Final/stacker/kNN) foi removido — a Nota Prevista
  // é o expected_score (single Ridge + blend com Nota.Calc). Mantemos só trainSet
  // e trainTargets, que alimentam o expected.
  const trainSet = works.filter((w) => w.userScore != null)
  const trainTargets = trainSet.map((w) => w.userScore as number)

  // ---------- 3c) Nota Prevista: expected_score (single Ridge + decomposição) ----------
  // UM Ridge com 22 features (14 baseline + 8 quality granulares + Status one-hot)
  // treinado conjuntamente contra user_score. Decomposição "baseline + quality"
  // é computada pós-hoc via atribuição linear (intercept + Σ coef × x por grupo).
  // Mantém precisão do legacy (ratio ~0.98×) E dá interpretabilidade da
  // contribuição de cada axis pra o waterfall.
  const expectedTrainInputs = trainSet.map(buildExpectedInput)
  const expectedAllInputs = works.map(buildExpectedInput)
  const expectedPredictor = trainExpectedPredictor(expectedTrainInputs, trainTargets, includeQuality)
  const expectedPredictions = expectedPredictor.predict(expectedAllInputs)

  // ---------- Blend expected⊕calc ----------
  // O calc_score determinístico é parceiro de ensemble do Ridge: ancora as obras
  // (reduz variância e dá robustez fora-da-distribuição). Mediu-se ~0.596→0.584
  // de MAE honesta com o ótimo em ~0.7-0.75. O peso é fitado em OOF do expected
  // (sem leak: sem OOF o Ridge memoriza o treino e o peso sairia enviesado pro
  // Ridge) por busca 1-D minimizando MAE de w·ridgeOOF + (1-w)·calcNoObs. w=1
  // (sem blend) quando OOF indisponível (treino < 30 ou stub).
  let calcBlendWeight = 1
  if (!expectedPredictor.isStub && trainSet.length >= 30) {
    const expectedOof = expectedOutOfFoldPredictions(expectedTrainInputs, trainTargets, includeQuality)
    if (expectedOof) {
      let bestW = 1
      let bestMae = Infinity
      for (let wgrid = 0; wgrid <= 1.0001; wgrid += 0.05) {
        let sum = 0
        for (let i = 0; i < trainSet.length; i++) {
          const blended = wgrid * expectedOof[i] + (1 - wgrid) * trainSet[i].calcScoreNoObs
          sum += Math.abs(blended - (trainSet[i].userScore as number))
        }
        const mae = sum / trainSet.length
        if (mae < bestMae) {
          bestMae = mae
          bestW = wgrid
        }
      }
      calcBlendWeight = bestW
    }
  }

  for (let i = 0; i < works.length; i++) {
    const p = expectedPredictions[i]
    const w = works[i]
    // Nota Prevista SÓ existe quando os 9 atributos da IA estão presentes. Sem
    // eles, os features dominantes do Ridge (category_scores + IA(n) + criterionFit)
    // são median-imputados e a predição colapsa no calc_score (média do público) →
    // uma nota "parcial" que não reflete previsão nenhuma (ex.: 3.1 numa obra sem
    // avaliação). Nesses casos deixamos expected_score = null: some de todas as
    // telas (badges gateiam em `expected_score != null`; o ranking joga essas
    // obras pro fim via -Infinity). Presença é source-independente (IA/import/manual).
    const hasAiAttributes = CRITERION_SLUGS.every((slug) => w.categoryScores[slug] != null)
    if (!hasAiAttributes) {
      w.expectedScore = null
      w.expectedBaseline = null
      w.expectedQualityAdj = null
      w.expectedIsStub = expectedPredictor.isStub
      continue
    }
    // Blend com o calc determinístico (sem obs), depois aplica obs UMA vez.
    const blendedNoObs = calcBlendWeight * p.expected + (1 - calcBlendWeight) * w.calcScoreNoObs
    // observation_adjustment é um nudge manual DETERMINÍSTICO (±0.30) somado sobre
    // a Nota Esperada — não é feature do Ridge (ver lib/calculations/expected.ts).
    w.expectedScore = applyObsAdjustment(blendedNoObs, w.observationAdjustment)
    // Dobra o blend no baseline pra manter o invariante baseline + qualityAdj ==
    // expected (pré-obs) no waterfall. Em Free qualityAdj=0 → baseline = blendedNoObs.
    // O coef cru do Ridge fica preservado em formula_config.expected_ridge_coefficients.
    w.expectedBaseline = blendedNoObs - p.qualityAdj
    w.expectedQualityAdj = p.qualityAdj
    w.expectedIsStub = expectedPredictor.isStub
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

  // ---------- 4) Calibrar MAE da Nota.Calc ----------
  const calibrationAfterPr = computeCalibration(
    works.map((w) => ({
      workId: w.id,
      userScore: w.userScore,
      calcScore: w.calcScore,
      predictedScore: null,
      finalScore: null,
      totalVotes: w.totalVotes,
    }))
  )
  const newMaeCalc = calibrationAfterPr.maeCalc
  const newRmseCalc = calibrationAfterPr.rmseCalc

  // ---------- 5) Personal fit (determinístico, a partir do TasteProfile) ----------
  // Independente da Nota Prevista — alinhamento de gosto via tags + critérios.
  // Usa o MESMO perfil efetivo das features (persistido ⊕ tags declaradas).
  if (effectiveProfile) {
    // Alinhamento = overlap líquido por NOME (amado − 1.5×evitado). Validado
    // (bootstrap 2026-06-27) como melhor desempate intra-tier que o personal_fit
    // de 3 componentes (que ficava ABAIXO do acaso, ~0.47) e que o net por
    // group::name (~0.51). netName cru → tag_overlap_net (desempate); personalFit
    // = netName normalizado [0,1] (min-max é monotônico → mesmo rank/percentil),
    // preservando o input `fit` 0–1 do Veredito e o filtro por percentil.
    for (const w of works) {
      w.netName = netNameOverlap(w.tags, effectiveProfile.loved_tags, effectiveProfile.avoided_tags)
    }
    const nets = works.map((w) => w.netName).filter((v): v is number => v != null)
    if (nets.length > 0) {
      const minN = Math.min(...nets)
      const rangeN = Math.max(...nets) - minN
      for (const w of works) {
        w.personalFit = w.netName == null ? null : rangeN > 0 ? (w.netName - minN) / rangeN : 0.5
      }
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

  // ---------- 5c) Chance de gostar (Força 1 da Bússola) ----------
  // P(user_score ≥ τ) calibrada, sobre features de fit. Treina nas obras
  // rotuladas, prevê pra todas. As prefs livres (texto) NÃO entram aqui — só
  // chegam via `interesseOrdinal` (o LLM Interesse-na-obra já as ingere).
  // Ver lib/calculations/chance.ts + PLANO-BUSSOLA-3-FORCAS.md.
  const declaredLoveNames = new Set<string>()
  const declaredAvoidNames = new Set<string>()
  for (const p of declaredTagPrefs) {
    const nm = p.name?.toLowerCase()
    if (!nm) continue
    if (p.stance === "love") declaredLoveNames.add(nm)
    else if (p.stance === "avoid") declaredAvoidNames.add(nm)
  }
  const INTEREST_ORDINAL: Record<string, number> = { "♥": 1, "♥♥": 2, "♥♥♥": 3, "♥♥♥♥": 4 }
  const buildChanceInput = (w: WorkComputed): ChanceInput => {
    const nTags = Math.max(w.tags.length, 1)
    let love = 0
    let avoid = 0
    for (const t of w.tags) {
      const nm = t.name.toLowerCase()
      if (declaredLoveNames.has(nm)) love += 1
      else if (declaredAvoidNames.has(nm)) avoid += 1
    }
    const band = effectiveInterestByWork.get(w.id) ?? w.synopsisQuality ?? null
    return {
      categoryScores: w.categoryScores,
      declaredLovedFrac: love / nTags,
      declaredAvoidedFrac: avoid / nTags,
      personalFit: w.personalFit,
      interesseOrdinal: band ? INTEREST_ORDINAL[band] ?? null : null,
    }
  }
  const chanceTrainInputs: ChanceInput[] = []
  const chanceTrainLabels: number[] = []
  for (const w of works) {
    if (w.userScore == null) continue
    chanceTrainInputs.push(buildChanceInput(w))
    chanceTrainLabels.push(w.userScore >= CHANCE_LIKED_THRESHOLD ? 1 : 0)
  }
  const chancePredictor = trainChancePredictor(chanceTrainInputs, chanceTrainLabels)
  const chanceScores = chancePredictor.predictScore(works.map(buildChanceInput))
  works.forEach((w, i) => {
    w.chanceIsStub = chancePredictor.isStub
    w.chanceScore = chancePredictor.isStub ? null : Math.round(chanceScores[i] * 100) / 100
  })

  // ---------- 6) Bulk upsert calculated_scores ----------
  const rows = works.map((w) => ({
    work_id: w.id,
    total_votes: w.totalVotes,
    platform_avg: w.platformAvg,
    ia_eval: w.iaEvalRaw,
    ia_eval_normalized: w.iaEvalNormalized,
    chapters_normalized: w.chaptersNormalized,
    calc_score: w.calcScore,
    expected_score: w.expectedScore,
    expected_baseline: w.expectedBaseline,
    expected_quality_adj: w.expectedQualityAdj,
    expected_is_stub: w.expectedIsStub,
    mae_calc: newMaeCalc,
    rmse_calc: newRmseCalc,
    personal_fit: w.personalFit,
    personal_fit_percentile: w.personalFitPercentile,
    chance_score: w.chanceScore,
    chance_is_stub: w.chanceIsStub,
    // Desempate dentro do tier (migration 116). Desde 2026-06-27: overlap líquido
    // por NOME (amado − 1.5×evitado, `netName`) — valida melhor que o net por
    // group::name no bootstrap. NULL quando o perfil não tem loved/avoided.
    tag_overlap_net: w.netName,
    formula_version: config.formula_version,
    calculated_at: new Date().toISOString(),
  }))

  // Agregar diagnósticos antes do persist
  const negativeActivationRate: Record<string, number> = {}
  for (const [slug, count] of Object.entries(gptNegativeActivations)) {
    negativeActivationRate[slug] = count / works.length
  }
  const gptClampHitRate = gptClampHits / works.length

  // Headline "Precisão da previsão". Free: nested-CV TRULY honesta (perfil+pesos
  // recomputados por fold — sem o leak do model.cvMAE interno). Pago: MAE CV
  // held-out com qualidade estimada pela IA (não-circular). Ambos caem pro
  // model.cvMAE se o honesto não rodar (treino pequeno/erro). Persistido no
  // config (headline) e no calibration_history (trendline).
  // NOTA: a trendline vai mostrar um degrau pra cima vs. entradas antigas — não
  // é regressão, é o número virando honesto (saiu de ~0.55 vazado pra ~0.59 real).
  let honestExpectedCvMae: number | null = null
  // Assinatura dos inputs do CV (cara). Calculada quando o CV é elegível pra
  // (a) decidir reuso e (b) persistir pro próximo recalc. Custo ~ms.
  const cvSig =
    !expectedPredictor.isStub && !includeQuality
      ? cvInputSignature(trainSet, weights, config.score_weights_auto ?? false, calcBlendWeight, declaredTagPrefs)
      : null
  if (!fast && !expectedPredictor.isStub && !includeQuality) {
    const prevSig = config.expected_ridge_coefficients?.cvSig
    const prevMae = config.cv_mae_expected_stage1
    if (cvSig != null && prevSig === cvSig && prevMae != null) {
      // Inputs do CV idênticos ao último recalc → reusa a MAE honesta persistida
      // e PULA a nested-CV (~550ms). É o quick-win "Q": edição de obra não-rotulada
      // não toca o CV, então não há por que re-rodá-lo.
      honestExpectedCvMae = prevMae
    } else {
      try {
        honestExpectedCvMae = computeHonestExpectedCvMae(
          trainSet,
          weights,
          config.score_weights_auto ?? false,
          includeQuality,
          calcBlendWeight,
          5,
          42,
          declaredTagPrefs,
        )
      } catch (err) {
        console.warn(
          "[recalculateAll] computeHonestExpectedCvMae falhou — usando model.cvMAE:",
          err instanceof Error ? err.message : err,
        )
      }
    }
  }
  const cvMaeExpected: number | null = expectedPredictor.isStub
    ? null
    : includeQuality
      ? (honestCvMae ?? expectedPredictor.model.cvMAE)
      : (honestExpectedCvMae ?? expectedPredictor.model.cvMAE)

  return {
    rows, pseudoVotesNotaM, pseudoVotesBlend, gptMean, gptClampHits, gptClampHitRate,
    gptNegativeActivations, negativeActivationRate, inferenceSnapshot, newMaeCalc, newRmseCalc,
    maeExpected, rmseExpected, maeExpectedBaseline, cvMaeExpected, calcBlendWeight, expectedPredictor,
    cvSig,
  }
}

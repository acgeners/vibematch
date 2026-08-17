import { createAdminClient } from "@/lib/supabase/admin"
import { CRITERION_SLUGS, type CriterionSlug } from "@/types/domain"
import type {
  BiasCorrelationEntry,
  BiasResidualExample,
  BiasStatsByCriterion,
  CalibrationMode,
  CalibrationRunRow,
  SuggestionStatus,
} from "@/lib/ai-calibration/types"

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

const BIAS_WORK_SELECT = `
  id,
  title,
  user_score,
  post_story_score,
  post_fl_score,
  post_ml_score,
  post_character_development_score,
  post_pacing_score,
  post_art_visual_score,
  post_impact_immersion_score,
  post_originality_score,
  category_scores(criterion_slug, score),
  calculated_scores(calc_score)
`


interface RawCategoryScoreRow {
  criterion_slug: string
  score: number | null
  source?: string | null
}



function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function pearson(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 5) return 0
  const meanX = xs.reduce((a, b) => a + b, 0) / n
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let denX = 0
  let denY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    num += dx * dy
    denX += dx * dx
    denY += dy * dy
  }
  if (denX === 0 || denY === 0) return 0
  return num / Math.sqrt(denX * denY)
}

export interface BiasInputs {
  stats: BiasStatsByCriterion[]
  residuals: BiasResidualExample[]
  correlations: BiasCorrelationEntry[]
}

export async function loadInputsForBias(): Promise<BiasInputs> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works_owner")
    .select(BIAS_WORK_SELECT)
    .not("user_score", "is", null)
    .eq("is_archived", false)
    .limit(2000)

  if (error) throw new Error(`Falha lendo obras pra bias: ${error.message}`)

  type WorkRow = {
    id: string
    title: string
    user_score: number
    category_scores: RawCategoryScoreRow[] | null
    calculated_scores: { calc_score: number | null } | null
    [key: string]: unknown
  }

  const works = (data ?? []) as unknown as WorkRow[]

  // Stats por critério
  const scoresBySlug = new Map<CriterionSlug, number[]>()
  const scoresWhenHigh = new Map<CriterionSlug, number[]>()
  const scoresWhenLow = new Map<CriterionSlug, number[]>()
  for (const slug of CRITERION_SLUGS) {
    scoresBySlug.set(slug, [])
    scoresWhenHigh.set(slug, [])
    scoresWhenLow.set(slug, [])
  }

  // Pra correlação: arrays alinhados por (work,critério)
  const corrPairs = new Map<string, { xs: number[]; ys: number[] }>()
  const postFields = POST_SCORE_FIELDS as readonly string[]
  for (const post of postFields) {
    for (const slug of CRITERION_SLUGS) {
      corrPairs.set(`${post}|${slug}`, { xs: [], ys: [] })
    }
  }

  // Resíduos
  const residualBuckets: Array<{
    workId: string
    title: string
    userScore: number
    calcScore: number | null
    scoresBySlug: Partial<Record<CriterionSlug, number>>
    residual: number
  }> = []

  for (const w of works) {
    const manual = Number(w.user_score)
    const calc = w.calculated_scores?.calc_score
    const calcNum = calc != null ? Number(calc) : null

    const csBySlug: Partial<Record<CriterionSlug, number>> = {}
    for (const cs of w.category_scores ?? []) {
      if (cs.score == null) continue
      const slug = cs.criterion_slug as CriterionSlug
      if (!CRITERION_SLUGS.includes(slug)) continue
      const val = Number(cs.score)
      csBySlug[slug] = val
      scoresBySlug.get(slug)?.push(val)
      if (manual >= 8) scoresWhenHigh.get(slug)?.push(val)
      if (manual <= 4) scoresWhenLow.get(slug)?.push(val)
    }

    // correlações
    for (const post of postFields) {
      const postVal = w[post]
      if (postVal == null) continue
      const postNum = Number(postVal)
      for (const slug of CRITERION_SLUGS) {
        const csVal = csBySlug[slug]
        if (csVal == null) continue
        const pair = corrPairs.get(`${post}|${slug}`)
        if (!pair) continue
        pair.xs.push(postNum)
        pair.ys.push(csVal)
      }
    }

    if (calcNum != null) {
      residualBuckets.push({
        workId: w.id,
        title: w.title,
        userScore: manual,
        calcScore: calcNum,
        scoresBySlug: csBySlug,
        residual: Math.abs(manual - calcNum),
      })
    }
  }

  const stats: BiasStatsByCriterion[] = CRITERION_SLUGS.map((slug) => {
    const arr = (scoresBySlug.get(slug) ?? []).slice().sort((a, b) => a - b)
    const n = arr.length
    if (n === 0) {
      return {
        slug,
        n: 0,
        mean: 0,
        stdev: 0,
        p25: 0,
        p50: 0,
        p75: 0,
        meanWhenManualHigh: null,
        meanWhenManualLow: null,
      }
    }
    const mean = arr.reduce((a, b) => a + b, 0) / n
    const variance = arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / Math.max(n - 1, 1)
    const stdev = Math.sqrt(variance)
    const high = scoresWhenHigh.get(slug) ?? []
    const low = scoresWhenLow.get(slug) ?? []
    return {
      slug,
      n,
      mean,
      stdev,
      p25: quantile(arr, 0.25),
      p50: quantile(arr, 0.5),
      p75: quantile(arr, 0.75),
      meanWhenManualHigh: high.length ? high.reduce((a, b) => a + b, 0) / high.length : null,
      meanWhenManualLow: low.length ? low.reduce((a, b) => a + b, 0) / low.length : null,
    }
  })

  const correlations: BiasCorrelationEntry[] = []
  for (const [key, pair] of corrPairs) {
    if (pair.xs.length < 10) continue
    const r = pearson(pair.xs, pair.ys)
    if (Math.abs(r) < 0.2) continue
    const [postField, slug] = key.split("|")
    correlations.push({
      criterion: slug as CriterionSlug,
      postField,
      pearson: r,
      n: pair.xs.length,
    })
  }
  correlations.sort((a, b) => Math.abs(b.pearson) - Math.abs(a.pearson))

  const residuals: BiasResidualExample[] = residualBuckets
    .sort((a, b) => b.residual - a.residual)
    .slice(0, 15)
    .map((r) => ({
      workId: r.workId,
      title: r.title,
      userScore: r.userScore,
      calcScore: r.calcScore,
      scoresBySlug: r.scoresBySlug,
    }))

  return { stats, residuals, correlations: correlations.slice(0, 30) }
}

export async function loadLastRun(mode: CalibrationMode): Promise<CalibrationRunRow | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("calibration_runs")
    .select("*")
    .eq("mode", mode)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error("[calibration] erro lendo último run:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    })
    return null
  }
  return (data as unknown as CalibrationRunRow | null) ?? null
}


export interface SuggestionFilters {
  status?: SuggestionStatus | SuggestionStatus[]
  workId?: string
  criterionSlug?: string
  minAbsDelta?: number
  runId?: string
  limit?: number
}




/** Encurta o id do modelo pra exibição ("claude-sonnet-5" → "sonnet-5"). */


/**
 * Procedência de um score que a auditoria reescreveu, por critério.
 *
 * 🔴 Existe porque a nota e a prosa que a explicam moram em tabelas diferentes: o número
 * está em `category_scores`, e a página imprime a justificativa da avaliação VIGENTE
 * (`ai_evaluation_scores`). Quando a auditoria muda a nota, ela não toca na avaliação —
 * então a prosa segue defendendo o número antigo. Medido em 2026-08-16: das 37 notas com
 * `source = 'ai_calibrated'`, **28 exibiam uma justificativa que contradiz a própria nota**,
 * a 1,79 ponto de distância em média, sob o selo de uma avaliação que não as produziu.
 *
 * A sugestão que moveu a nota já traz a justificativa certa — ela só era descartada depois
 * de aplicada. Aqui ela é recuperada por chave natural (obra + critério, a aplicação mais
 * recente), em vez de copiada para outra tabela: a linha da sugestão continua sendo a dona
 * do próprio texto, e não há duas cópias para divergir.
 */
export interface CalibrationProvenance {
  justification: string
  previousScore: number
  appliedScore: number
  appliedAt: string | null
  status: SuggestionStatus
}

export async function getCalibrationProvenanceForWork(
  workId: string,
): Promise<Map<CriterionSlug, CalibrationProvenance>> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("score_calibration_suggestions")
    .select("criterion_slug, justification, previous_score, applied_score, applied_at, status")
    .eq("work_id", workId)
    .in("status", ["auto_applied", "accepted", "edited"])
    .order("applied_at", { ascending: false, nullsFirst: false })
  if (error) {
    // Falha aqui não pode derrubar a página da obra: sem o mapa, o card degrada para o
    // comportamento antigo (prosa da avaliação) em vez de não renderizar.
    console.error("[calibration] erro lendo procedência de calibração:", error.message)
    return new Map()
  }

  const out = new Map<CriterionSlug, CalibrationProvenance>()
  for (const row of data ?? []) {
    const slug = row.criterion_slug as CriterionSlug
    // `order` já veio da mais recente pra mais antiga: a primeira de cada critério é a
    // aplicação que está em vigor.
    if (out.has(slug)) continue
    const applied = row.applied_score == null ? null : Number(row.applied_score)
    if (applied == null || !row.justification) continue
    out.set(slug, {
      justification: row.justification as string,
      previousScore: Number(row.previous_score),
      appliedScore: applied,
      appliedAt: (row.applied_at as string | null) ?? null,
      status: row.status as SuggestionStatus,
    })
  }
  return out
}


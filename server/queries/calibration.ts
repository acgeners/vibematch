import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { getOwnerUserId } from "@/server/queries/current-user"
import { MODEL, PROMPT_VERSION } from "@/lib/ai-calibration/service"
import { pickPrimarySynopsis } from "@/lib/work-derived"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import { CRITERION_SLUGS, type CriterionSlug, type ScoreSource } from "@/types/domain"
import type {
  AuditStaleness,
  AuditStalenessLevel,
  AuditWorkInput,
  BiasCorrelationEntry,
  BiasResidualExample,
  BiasStatsByCriterion,
  CalibrationMode,
  CalibrationRunRow,
  SuggestionRow,
  SuggestionStatus,
  SuggestionWithWork,
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

const AUDIT_WORK_SELECT = `
  id,
  title,
  user_score,
  is_favorite,
  observations,
  post_story_score,
  post_fl_score,
  post_ml_score,
  post_character_development_score,
  post_pacing_score,
  post_art_visual_score,
  post_impact_immersion_score,
  post_originality_score,
  category_scores(criterion_slug, score, source),
  work_tags(tag_id, tags(name, tag_group_id)),
  work_synopses(text, is_primary, position)
`

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

interface RawTagRow {
  tag_id?: string | null
  tags?: { name?: string | null; tag_group_id?: string | null } | null
}

interface RawCategoryScoreRow {
  criterion_slug: string
  score: number | null
  source?: string | null
}

interface RawSynopsisRow {
  text?: string | null
  is_primary?: boolean | null
  position?: number | null
}

function buildTags(rows: RawTagRow[] | null | undefined): Array<{ name: string; group: string | null }> {
  return (rows ?? [])
    .map((wt) => wt.tags)
    .filter((t): t is { name: string; tag_group_id?: string | null } => Boolean(t?.name))
    .map((t) => ({
      name: t.name,
      group: t.tag_group_id ? (TAG_GROUP_ID_TO_NORMALIZED_SLUG[t.tag_group_id] ?? null) : null,
    }))
}

export async function loadWorksForAudit(limit = 1000): Promise<AuditWorkInput[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("works_owner")
    .select(AUDIT_WORK_SELECT)
    .not("user_score", "is", null)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (error) throw new Error(`Falha lendo obras pra audit: ${error.message}`)

  return (data ?? []).map((row) => {
    const work = row as unknown as Record<string, unknown>
    const categoryScores: AuditWorkInput["categoryScores"] = {}
    for (const cs of (work.category_scores as RawCategoryScoreRow[] | null) ?? []) {
      if (cs.score == null) continue
      categoryScores[cs.criterion_slug as CriterionSlug] = {
        score: Number(cs.score),
        source: (cs.source ?? "imported") as ScoreSource,
      }
    }
    const postScores: Partial<Record<string, number>> = {}
    for (const field of POST_SCORE_FIELDS) {
      const v = work[field]
      if (v != null) postScores[field] = Number(v)
    }
    const synopsis = pickPrimarySynopsis(
      (work.work_synopses as RawSynopsisRow[] | undefined)?.map((s) => ({
        text: s.text ?? null,
        is_primary: s.is_primary ?? null,
        position: s.position ?? null,
      })),
    )
    return {
      workId: work.id as string,
      title: work.title as string,
      userScore: Number(work.user_score),
      isFavorite: Boolean(work.is_favorite),
      synopsis,
      observation: (work.observations as string | null) ?? null,
      tags: buildTags(work.work_tags as RawTagRow[] | null),
      categoryScores,
      postScores,
    } satisfies AuditWorkInput
  })
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

export async function loadRunHistory(limit = 20): Promise<CalibrationRunRow[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("calibration_runs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) {
    console.error("[calibration] erro lendo histórico:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    })
    return []
  }
  return (data as unknown as CalibrationRunRow[]) ?? []
}

export interface SuggestionFilters {
  status?: SuggestionStatus | SuggestionStatus[]
  workId?: string
  criterionSlug?: string
  minAbsDelta?: number
  runId?: string
  limit?: number
}

/** Colapsa o array `work_covers` na URL da capa primária (ou a de menor posição). */
function pickPrimaryCoverUrl(
  covers?: Array<{ url?: string | null; is_primary?: boolean | null; position?: number | null }> | null,
): string | null {
  if (!covers || covers.length === 0) return null
  const withUrl = covers.filter((c) => !!c.url)
  if (withUrl.length === 0) return null
  const primary = withUrl.find((c) => c.is_primary)
  if (primary) return primary.url ?? null
  return [...withUrl].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]?.url ?? null
}

export async function loadSuggestions(filters: SuggestionFilters = {}): Promise<SuggestionWithWork[]> {
  const supabase = createAdminClient()
  // Lê o dado PESSOAL do DONO (user_score, is_favorite) → vem do espelho via a view
  // `works_owner`, não da linha compartilhada de `works` (que vai perder essas colunas).
  let query = supabase
    .from("score_calibration_suggestions")
    .select(`
      *,
      works_owner(title, user_score, is_favorite, year, total_chapters, publication_status_id, work_covers(url, is_primary, position))
    `)
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 200)

  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status]
    query = query.in("status", statuses)
  }
  if (filters.workId) query = query.eq("work_id", filters.workId)
  if (filters.criterionSlug) query = query.eq("criterion_slug", filters.criterionSlug)
  if (filters.runId) query = query.eq("run_id", filters.runId)

  const { data, error } = await query
  if (error) {
    console.error("[calibration] erro lendo sugestões:", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    })
    return []
  }

  const rows = (data ?? []) as unknown as Array<
    SuggestionRow & {
      works_owner?: {
        title?: string | null
        user_score?: number | null
        is_favorite?: boolean | null
        year?: number | null
        total_chapters?: number | null
        publication_status_id?: number | null
        work_covers?: Array<{ url?: string | null; is_primary?: boolean | null; position?: number | null }> | null
      } | null
    }
  >
  const filtered = filters.minAbsDelta != null
    ? rows.filter((r) => Math.abs(Number(r.delta)) >= filters.minAbsDelta!)
    : rows
  return filtered.map((row) => ({
    ...row,
    delta: Number(row.delta),
    previous_score: Number(row.previous_score),
    suggested_score: Number(row.suggested_score),
    confidence: Number(row.confidence),
    applied_score: row.applied_score != null ? Number(row.applied_score) : null,
    work_title: row.works_owner?.title ?? "(obra removida)",
    work_cover_url: pickPrimaryCoverUrl(row.works_owner?.work_covers),
    work_user_score: row.works_owner?.user_score != null ? Number(row.works_owner.user_score) : null,
    work_is_favorite: row.works_owner?.is_favorite ?? false,
    work_year: row.works_owner?.year ?? null,
    work_total_chapters: row.works_owner?.total_chapters ?? null,
    work_publication_status_id: row.works_owner?.publication_status_id ?? null,
  }))
}

export async function countPendingSuggestions(): Promise<number> {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from("score_calibration_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
  if (error) return 0
  return count ?? 0
}

// Faixas de materialidade da defasagem (fração da pool avaliada que mudou desde o último
// run). Defaults a calibrar contra o churn real de sugestões — não são lei.
const AUDIT_STALE_FRACTION_REVIEW = 0.1
const AUDIT_STALE_FRACTION_STALE = 0.25

/** Encurta o id do modelo pra exibição ("claude-sonnet-5" → "sonnet-5"). */
function shortModel(m: string): string {
  return m.replace(/^claude-/, "")
}

/**
 * Estima o quão DEFASADAS estão as sugestões aplicadas em relação ao dado que mudou desde a
 * última auditoria — barato (contagens, sem IA). É o sinal pra sugerir "hora de re-rodar".
 *
 * O sinal certo pra "nota pessoal mudou" é `user_work_state.updated_at` (setado a cada gravação
 * em `mirrorOwnerState`), NÃO `works_owner.updated_at` — este último é `works.updated_at`, o
 * timestamp do CATÁLOGO (digest de review, checagem de capítulo), que se move sozinho e choraria
 * lobo. Ver 152_works_owner_view_completa.sql:53.
 *
 * `category_scores` fecha o ponto cego: re-avaliar a IA muda os critérios-base SEM tocar
 * `user_work_state`. Contamos só as fontes que a auditoria PODE reescrever (`imported`,
 * `ai_accepted`): excluir `ai_calibrated` evita auto-referência (o run reescreve com essa
 * fonte), e excluir as travadas (`manual`/`ai_edited`, `LOCKED_SOURCES`) evita marcar como
 * defasada uma obra cujo único delta foi num critério que a auditoria não mexeria de qualquer
 * jeito. É um LIMITE SUPERIOR do valor de re-rodar, não uma promessa: "input mudou" ≠ "a nota
 * vai mudar" (re-eval pode cair no mesmo valor / abaixo do limiar |Δ|≥0.5 da sugestão).
 *
 * ⚠️ Limitação conhecida (v1): `user_work_state.updated_at` também sobe ao marcar capítulo /
 * favoritar, que a auditoria quase não lê → `changedByScore` super-conta um pouco. Aceitável pro
 * nudge; apertar exigiria um timestamp dedicado de "nota mudou".
 */
export async function loadAuditStaleness(): Promise<AuditStaleness> {
  const supabase = createAdminClient()
  const [lastRun, ownerId] = await Promise.all([loadLastRun("audit"), getOwnerUserId(supabase)])

  // Pool: ids das obras avaliadas e não arquivadas do dono (o que a auditoria varreria hoje).
  const poolRows = await fetchAllRows<{ id: string }>(
    (from, to) =>
      supabase
        .from("works_owner")
        .select("id")
        .not("user_score", "is", null)
        .eq("is_archived", false)
        .order("id", { ascending: true })
        .range(from, to),
    "audit-staleness/pool",
  )
  const poolIds = new Set(poolRows.map((r) => r.id))
  const ratedWorks = poolIds.size

  if (!lastRun) {
    return {
      hasRun: false,
      lastRunAt: null,
      ratedWorks,
      changedWorks: ratedWorks,
      changedByScore: ratedWorks,
      changedByCriteria: 0,
      staleFraction: ratedWorks > 0 ? 1 : 0,
      modelDrift: false,
      driftDetail: null,
      level: "never",
    }
  }

  const since = lastRun.completed_at ?? lastRun.created_at

  // C — nota pessoal do dono mudou desde o run.
  const scoreChanged = await fetchAllRows<{ work_id: string }>(
    (from, to) =>
      supabase
        .from("user_work_state")
        .select("work_id")
        .eq("user_id", ownerId)
        .not("user_score", "is", null)
        .gt("updated_at", since)
        .order("work_id", { ascending: true })
        .range(from, to),
    "audit-staleness/score-changed",
  )
  const changedByScore = new Set(scoreChanged.map((r) => r.work_id).filter((id) => poolIds.has(id)))

  // B — critério-base mudou por fonte que a auditoria PODE reescrever (imported/ai_accepted).
  // Exclui as travadas (manual/ai_edited) e a própria auditoria (ai_calibrated) — ver doc acima.
  const criteriaChanged = await fetchAllRows<{ work_id: string }>(
    (from, to) =>
      supabase
        .from("category_scores")
        .select("work_id")
        .gt("updated_at", since)
        .in("source", ["imported", "ai_accepted"])
        .order("work_id", { ascending: true })
        .range(from, to),
    "audit-staleness/criteria-changed",
  )
  const changedByCriteria = new Set(
    criteriaChanged.map((r) => r.work_id).filter((id) => poolIds.has(id)),
  )

  const changedWorks = new Set([...changedByScore, ...changedByCriteria]).size
  const staleFraction = ratedWorks > 0 ? changedWorks / ratedWorks : 0

  // Drift da régua: modelo primeiro (mais material), senão prompt. `driftDetail` é o rótulo
  // curto que o card mostra no chip — o client não importa a constante `MODEL` (é server-only).
  let driftDetail: string | null = null
  if (lastRun.model_name !== MODEL) {
    driftDetail = `modelo ${shortModel(lastRun.model_name)} → ${shortModel(MODEL)}`
  } else if (lastRun.prompt_version !== PROMPT_VERSION) {
    driftDetail = `prompt ${lastRun.prompt_version} → ${PROMPT_VERSION}`
  }
  const modelDrift = driftDetail !== null

  let level: AuditStalenessLevel
  if (modelDrift || staleFraction >= AUDIT_STALE_FRACTION_STALE) level = "stale"
  else if (staleFraction >= AUDIT_STALE_FRACTION_REVIEW) level = "review"
  else level = "fresh"

  return {
    hasRun: true,
    lastRunAt: since,
    ratedWorks,
    changedWorks,
    changedByScore: changedByScore.size,
    changedByCriteria: changedByCriteria.size,
    staleFraction,
    modelDrift,
    driftDetail,
    level,
  }
}

import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/paginate"
import { getOwnerUserId } from "@/server/queries/current-user"
import { MODEL, PROMPT_VERSION } from "@/lib/ai-calibration/service"
import { pickPrimarySynopsis } from "@/lib/work-derived"
import { TAG_GROUP_ID_TO_NORMALIZED_SLUG } from "@/lib/constants/tag-groups-utils"
import { POST_READING_FIELDS, temEvidenciaParaAuditar, temLeituraDoUsuario } from "@/lib/ai-calibration/policy"
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
  CriterionAnchor,
  ReviewDigestForAudit,
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
  review_digest,
  category_scores(criterion_slug, score, source),
  work_tags(tag_id, tags(name, tag_group_id)),
  work_synopses(text, is_primary, position)
`

/** Colunas mínimas pra decidir se a obra entra na pool — literal porque o cliente tipado do
 *  Supabase não analisa template string. As de pós-leitura são `POST_READING_FIELDS`, e o
 *  teste `pool-da-auditoria` confere que as duas listas não divergiram. */
const AUDIT_POOL_SELECT = `
  id,
  review_digest,
  post_story_score,
  post_fl_score,
  post_ml_score,
  post_character_development_score,
  post_pacing_score,
  post_art_visual_score,
  post_impact_immersion_score,
  post_originality_score
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

/**
 * Recorta do `works.review_digest` só o que o auditor precisa julgar: o consenso, a
 * divergência e os traços com eixo. Fora ficam `execution` e os campos de contagem — eles
 * descrevem a QUALIDADE da obra, não a intensidade dos atributos, e cada campo a mais é
 * token pago em toda obra do lote.
 */
function mapDigest(raw: unknown): ReviewDigestForAudit | null {
  if (!raw || typeof raw !== "object") return null
  const d = raw as Record<string, unknown>
  const traits = Array.isArray(d.salient_traits)
    ? (d.salient_traits as Array<Record<string, unknown>>)
        .filter((t) => typeof t?.trait === "string")
        .map((t) => ({
          axis: String(t.axis ?? "geral"),
          trait: String(t.trait),
          polarity: String(t.polarity ?? "mixed"),
        }))
    : []
  const consensus = typeof d.consensus === "string" ? d.consensus : null
  const divergence = typeof d.divergence === "string" ? d.divergence : null
  if (!consensus && !divergence && traits.length === 0) return null
  return { consensus, divergence, traits }
}

function mapAuditRow(row: unknown): AuditWorkInput {
  const work = row as Record<string, unknown>
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
    // Não-nulo por construção: `loadWorksForAudit` descarta quem não tem digest antes de
    // chegar aqui. O `!` seria mentira se algum caller pulasse aquele filtro, então o mapa
    // devolve um vazio inofensivo e o filtro é quem garante.
    digest: mapDigest(work.review_digest) ?? { consensus: null, divergence: null, traits: [] },
  } satisfies AuditWorkInput
}

/**
 * Obras que a auditoria varre. Sem `onlyIds` = pool inteira (varredura completa). Com `onlyIds`
 * = só essas obras (varredura incremental — o conjunto que `changedAuditWorkIdsSince` devolve).
 *
 * ⚠️ `onlyIds` vai em LOTES: `.in("id")` + os embeds (category_scores/work_tags/work_synopses)
 * acima de ~300 ids vira `fetch failed` (o mesmo buraco de `selectByIdsInChunks`).
 */
export interface AuditPool {
  works: AuditWorkInput[]
  /** Obras que entrariam no escopo mas não têm digest — ficam de fora, e a UI diz quantas. */
  semDigest: number
  /** Obras com digest mas sem pós-leitura do usuário — o auditor não teria vantagem nelas. */
  semLeitura: number
}

/**
 * 🔴 Obra SEM digest fica de fora do run (decisão de 2026-08-16).
 *
 * Sem o consenso das reviews o auditor volta a ser o juiz cego que produziu os dois erros de
 * 85% — ele julga com tag e sinopse enquanto contradiz uma evidência que não viu. Auditar
 * assim é pagar por palpite. Medido na pool: **195 das 211 obras têm digest**, então o corte
 * custa 16 obras e compra a evidência nas outras 195.
 *
 * ⚠️ Elas não somem em silêncio: `semDigest` sobe até o resumo do run. Obra sem digest não é
 * um defeito da auditoria — é o piso de 4 reviews úteis do `digest-gate` fazendo o trabalho
 * dele numa obra com pouca evidência.
 */
function comEvidencia(works: AuditWorkInput[]): AuditPool {
  // Duas exigências, e as duas são de EVIDÊNCIA: o consenso das reviews (o que os leitores
  // observaram) e a pós-leitura do usuário (o que quem leu observou, dimensão a dimensão).
  // Sem a segunda o auditor relê a mesma evidência da avaliação; sem a primeira ele julga
  // no escuro. Ver `temLeituraDoUsuario` e `temEvidenciaParaAuditar` em policy.ts.
  const comDigest = works.filter((w) => temEvidenciaParaAuditar(w.digest))
  const out = comDigest.filter((w) => temLeituraDoUsuario(w.postScores))
  return {
    works: out,
    semDigest: works.length - comDigest.length,
    semLeitura: comDigest.length - out.length,
  }
}

export async function loadWorksForAudit(
  opts: { limit?: number; onlyIds?: string[] } = {},
): Promise<AuditPool> {
  const supabase = createAdminClient()

  if (opts.onlyIds) {
    if (opts.onlyIds.length === 0) return { works: [], semDigest: 0, semLeitura: 0 }
    const out: AuditWorkInput[] = []
    for (let i = 0; i < opts.onlyIds.length; i += 150) {
      const idChunk = opts.onlyIds.slice(i, i + 150)
      const { data, error } = await supabase
        .from("works_owner")
        .select(AUDIT_WORK_SELECT)
        .not("user_score", "is", null)
        .eq("is_archived", false)
        .in("id", idChunk)
      if (error) throw new Error(`Falha lendo obras pra audit (incremental): ${error.message}`)
      for (const row of data ?? []) out.push(mapAuditRow(row))
    }
    return comEvidencia(out)
  }

  const { data, error } = await supabase
    .from("works_owner")
    .select(AUDIT_WORK_SELECT)
    .not("user_score", "is", null)
    .eq("is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 1000)

  if (error) throw new Error(`Falha lendo obras pra audit: ${error.message}`)
  return comEvidencia((data ?? []).map(mapAuditRow))
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

type Admin = ReturnType<typeof createAdminClient>

/** Ids da pool que a auditoria varre: obras do dono, avaliadas e não arquivadas. */
async function auditPoolIds(supabase: Admin): Promise<Set<string>> {
  type PoolRow = { id: string; review_digest: unknown } & Partial<Record<string, number | null>>
  const rows = await fetchAllRows<PoolRow>(
    (from, to) =>
      // ⚠️ A MESMA régua do run: só obra que o auditor de fato audita. Contar aqui o que o
      // run descarta faria a barra de defasagem prometer trabalho que não existe — dois
      // critérios pro mesmo fato, com o lado visível sendo o errado.
      supabase
        .from("works_owner")
        .select(AUDIT_POOL_SELECT)
        .not("user_score", "is", null)
        .eq("is_archived", false)
        .order("id", { ascending: true })
        .range(from, to),
    "audit/pool",
  )
  return new Set(
    rows
      .filter((r) => {
        const digest = mapDigest(r.review_digest)
        if (!digest || !temEvidenciaParaAuditar(digest)) return false
        return temLeituraDoUsuario(r)
      })
      .map((r) => r.id),
  )
}

/**
 * Obras (dentro da pool) cujo INPUT da auditoria mudou desde `since`:
 * - `score`: nota pessoal mudou (`user_work_state.updated_at`).
 * - `criteria`: `category_scores` mudou por fonte que a auditoria pode reescrever (imported/ai_accepted).
 * Ver a doc de `loadAuditStaleness` pro porquê de cada escolha. Fonte única da verdade do "mudou":
 * o nudge conta `|score ∪ criteria|` e a auditoria incremental re-varre esse mesmo conjunto.
 */
async function auditChangedSets(
  supabase: Admin,
  ownerId: string,
  since: string,
  poolIds: Set<string>,
): Promise<{ score: Set<string>; criteria: Set<string> }> {
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
    "audit/score-changed",
  )
  const criteriaChanged = await fetchAllRows<{ work_id: string }>(
    (from, to) =>
      supabase
        .from("category_scores")
        .select("work_id")
        .gt("updated_at", since)
        .in("source", ["imported", "ai_accepted"])
        .order("work_id", { ascending: true })
        .range(from, to),
    "audit/criteria-changed",
  )
  return {
    score: new Set(scoreChanged.map((r) => r.work_id).filter((id) => poolIds.has(id))),
    criteria: new Set(criteriaChanged.map((r) => r.work_id).filter((id) => poolIds.has(id))),
  }
}

/**
 * Ids que a auditoria INCREMENTAL deve re-varrer: o MESMO conjunto que o nudge conta
 * (`score ∪ criteria`, dentro da pool). Garante que o "N mudadas" do card seja exatamente o que
 * o run processa. O chamador decide varredura completa quando há drift / nunca rodou.
 */
export async function changedAuditWorkIdsSince(since: string): Promise<string[]> {
  const supabase = createAdminClient()
  const [ownerId, poolIds] = await Promise.all([getOwnerUserId(supabase), auditPoolIds(supabase)])
  const { score, criteria } = await auditChangedSets(supabase, ownerId, since, poolIds)
  return [...new Set([...score, ...criteria])]
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
  const [lastRun, ownerId, poolIds] = await Promise.all([
    loadLastRun("audit"),
    getOwnerUserId(supabase),
    auditPoolIds(supabase),
  ])
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

  const { score: changedByScore, criteria: changedByCriteria } = await auditChangedSets(
    supabase,
    ownerId,
    since,
    poolIds,
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

/**
 * Âncoras de calibração: como cada critério é USADO no catálogo (média, σ, quartis).
 *
 * 🔴 É o reaproveitamento que fecha a Decisão 3 — estes números já eram computados por
 * `loadInputsForBias` e serviam só pra alimentar um relatório de LLM que ninguém consome.
 * Aqui eles viram o contexto que faltava ao auditor: sem saber que `fantasy_nobility` tem
 * mediana 8,0 no catálogo, ele propõe 3,0 pra uma obra com nobreza clara e a empata com as
 * que não têm nada.
 *
 * ⚠️ A distribuição sai da MESMA pool que está sendo auditada (obras com nota pessoal), não
 * do catálogo inteiro — é a régua contra a qual as notas dela serão comparadas. Medir num
 * conjunto e julgar noutro é a família "mesma função, CONJUNTOS diferentes".
 */
export async function loadCriterionAnchors(): Promise<CriterionAnchor[]> {
  const { stats } = await loadInputsForBias()
  return stats
    .filter((s) => s.n > 0)
    .map((s) => ({
      slug: s.slug,
      mean: s.mean,
      stdev: s.stdev,
      p25: s.p25,
      p50: s.p50,
      p75: s.p75,
      n: s.n,
    }))
}

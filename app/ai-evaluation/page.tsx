import { Sparkles } from "lucide-react"
import { createAdminClient } from "@/lib/supabase/admin"
import { Header } from "@/components/layout/header"
import { AiEvaluationPanel } from "@/components/ai-evaluation/ai-evaluation-panel"
import { AiEvaluationFilters } from "@/components/ai-evaluation/ai-evaluation-filters"
import { pickPrimaryCover } from "@/lib/work-derived"
import { MODEL, PROMPT_VERSION, CURRENT_PROMPT_VERSION_NUM, parsePromptVersion } from "@/lib/ai-evaluation/service"
import {
  PUBLICATION_STATUSES_BY_ID,
  PERSONAL_STATUSES_BY_ID,
} from "@/lib/constants/criteria"
import { SYNOPSIS_QUALITIES } from "@/types/domain"
import Link from "next/link"
import { Suspense } from "react"
import { unstable_cache } from "next/cache"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"
import { StaleRerankPanel } from "@/components/ranking/stale-rerank-panel"
import { SynopsisPredictPanel } from "@/components/titles/synopsis-predict-panel"
import { ShadowComparePanel } from "@/components/titles/shadow-compare-panel"
import { PredictionDiagnosticsPopover } from "@/components/titles/prediction-diagnostics-popover"
import { isInterestShadowEnabled } from "@/lib/ai-evaluation/compiled-preferences"
import { getAlignmentQueueWorks, getSynopsisQueueWorks, getSynopsisPredictionVersions, getUntrackedWorks } from "@/server/queries/recommendations"
import type { AlignmentQueueWork, SynopsisQueueWork, UntrackedWork } from "@/server/queries/recommendations"
import { UntrackedStatusPanel } from "@/components/ai-evaluation/untracked-status-panel"
import { getSynopsisPredictionAccuracy, getSynopsisVersionComparison } from "@/server/queries/synopsis-quality"
import type { SynopsisPredictionAccuracy, SynopsisVersionComparison } from "@/server/queries/synopsis-quality"
import { canConsumeAi } from "@/server/queries/current-user"
import { TagsReviewsTab } from "@/components/ai-evaluation/tags-reviews-tab"
import type { TagsReviewsWork } from "@/components/ai-evaluation/tags-reviews-tab"
import { getWorksWithoutReviews } from "@/server/queries/works-without-reviews"
import { getWorksWithoutTags } from "@/server/queries/works-without-tags"
import { getWorkTagReviewCounts } from "@/server/queries/work-card-meta"
import { getReadAckSets, getEvalReadSummary } from "@/server/queries/ai-eval-read"
import type { ReadQueue } from "@/server/queries/ai-eval-read"
import { filterWorkIdsByInterest } from "@/server/queries/interest-filter"
import { MarkReadButton } from "@/components/ai-evaluation/mark-read-button"
import { AiEvalSettingsDialog } from "@/components/ai-evaluation/ai-eval-settings-dialog"
import type { FormulaConfig } from "@/types/domain"

const ALL_FILTERS = ["pending", "review-pending", "low-confidence", "outdated-model", "outdated-reviews"] as const
export type EvaluationFilter = (typeof ALL_FILTERS)[number]

const DEFAULT_FILTERS: EvaluationFilter[] = ["pending", "review-pending"]
const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.8

const PUB_STATUS_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  Object.values(PUBLICATION_STATUSES_BY_ID).map((info) => [info.status, info.id])
)
const PERSONAL_STATUS_NAME_TO_ID: Record<string, number> = Object.fromEntries(
  Object.values(PERSONAL_STATUSES_BY_ID).map((info) => [info.status, info.id])
)

/** Status "de leitura" ocultos por PADRÃO na aba Interesse (obra finalizada/
 *  abandonada/travada não precisa de estimativa de interesse). Escolha explícita
 *  de status no filtro sobrepõe. */
const INTEREST_HIDDEN_PERSONAL_STATUSES = ["Completed", "Dropped", "Stalled"]
const INTEREST_DEFAULT_PERSONAL_NAMES = Object.keys(PERSONAL_STATUS_NAME_TO_ID).filter(
  (s) => !INTEREST_HIDDEN_PERSONAL_STATUSES.includes(s),
)
const INTEREST_DEFAULT_PERSONAL_IDS = INTEREST_DEFAULT_PERSONAL_NAMES
  .map((s) => PERSONAL_STATUS_NAME_TO_ID[s])
  .filter((id): id is number => id != null)

function parseFilters(raw: string | string[] | undefined): EvaluationFilter[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return DEFAULT_FILTERS
  const parts = value.split(",").map((p) => p.trim()).filter(Boolean)
  const valid = parts.filter((p): p is EvaluationFilter =>
    (ALL_FILTERS as readonly string[]).includes(p)
  )
  return valid.length > 0 ? valid : DEFAULT_FILTERS
}

function parseSynopsisQualities(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return []
  // Sentinelas do filtro de Interesse (tratados só na fila tab=sinopse; inofensivos
  // nas outras queries): "none" = "Não avaliada" (synopsis_quality IS NULL);
  // "unknown" = "Desconhecido" (synopsis_quality_source = 'legacy_unknown').
  const valid = new Set<string>([...SYNOPSIS_QUALITIES, "none", "unknown"])
  return value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => valid.has(p))
}

/** Valores previstos pela IA (♥–♥♥♥♥) — filtro "Previsão da IA" da aba sinopse. */
function parsePredictionQualities(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return []
  const valid = new Set<string>(SYNOPSIS_QUALITIES)
  return value.split(",").map((p) => p.trim()).filter((p) => valid.has(p))
}

/** Versões de prompt da previsão (ex.: v3, v2) — filtro "Versão da previsão". */
function parsePredictionVersions(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return []
  return value.split(",").map((p) => p.trim()).filter((p) => /^v\d+$/i.test(p))
}

/** Delta previsto − atual: valores exatos de "-3" a "3" (níveis ♥). */
function parsePredictionDeltas(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return []
  const valid = new Set(["-3", "-2", "-1", "0", "1", "2", "3"])
  return value.split(",").map((p) => p.trim()).filter((p) => valid.has(p))
}

function parseStatusList(
  raw: string | string[] | undefined,
  nameToId: Record<string, number>
): { names: string[]; ids: number[] } {
  const value = Array.isArray(raw) ? raw.join(",") : raw
  if (!value) return { names: [], ids: [] }
  const names = value
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p in nameToId)
  const ids = names.map((n) => nameToId[n])
  return { names, ids }
}

interface EligibleWork {
  id: string
  title: string
  publication_status: string
  publication_status_id: number | null
  personal_status: string
  personal_status_id: number | null
  synopsis_quality: string | null
  cover_url?: string | null
  expected_score: number | null
  /** Hidratados só na aba ativa (cards) — ausentes no caminho do cache de contagens. */
  tagCount?: number | null
  reviewCount?: number | null
  /** Razões pelas quais a obra apareceu (intersecção com os filtros ativos). */
  matchedFilters: EvaluationFilter[]
  evaluation: {
    confidence: number | null
    modelName: string | null
    promptVersion: string | null
    evaluatedAt: string | null
  } | null
}

/**
 * Roda uma query Supabase em chunks de IDs e concatena. Necessário porque
 * `.in("id", [...500+ uuids])` estoura o limite de URL do PostgREST (~16KB)
 * e a request fica pendurada até dar timeout.
 */
async function chunkedInQuery<T>(
  ids: string[],
  chunkSize: number,
  query: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ data: T[]; error: unknown }> {
  if (ids.length === 0) return { data: [], error: null }
  const out: T[] = []
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const { data, error } = await query(chunk)
    if (error) return { data: out, error }
    if (data) out.push(...data)
  }
  return { data: out, error: null }
}

interface LatestEvalRow {
  work_id: string
  confidence: number | null
  model_name: string | null
  prompt_version: string | null
  updated_at: string | null
  created_at: string | null
}

/**
 * Carrega a última avaliação completed por work_id, fazendo a dedup em JS em
 * vez de via view `latest_ai_evaluation_per_work`. Evita o DISTINCT ON do
 * Postgres que ficava no limite do statement timeout sob carga.
 *
 * Usa o índice `idx_ai_evaluations_status` (status='completed'), retorna todas
 * as linhas ordenadas e mantém só a primeira por work_id.
 *
 * ⚠️ Varre a tabela inteira (cresce sem teto — ~1.6k linhas e subindo, várias
 * avals por obra). Só é necessário para os filtros `low-confidence`/
 * `outdated-model`, que precisam olhar TODAS as obras. Para apenas hidratar a
 * metadata de avaliação dos cards exibidos, use `loadLatestEvalsForIds`.
 */
async function loadLatestEvalsMap(
  supabase: ReturnType<typeof createAdminClient>,
): Promise<Map<string, LatestEvalRow>> {
  const { data, error } = await supabase
    .from("ai_evaluations")
    .select("work_id, confidence, model_name, prompt_version, created_at, updated_at")
    .eq("status", "completed")
    .order("created_at", { ascending: false })
  if (error) throw new Error(error.message)

  const latest = new Map<string, LatestEvalRow>()
  for (const row of (data ?? []) as LatestEvalRow[]) {
    if (!latest.has(row.work_id)) latest.set(row.work_id, row)
  }
  return latest
}

/**
 * Versão direcionada de `loadLatestEvalsMap`: carrega a última aval completed só
 * para os `ids` informados (os cards que serão exibidos, ≤500). Evita varrer a
 * tabela inteira no caminho padrão (filtros pending/review-pending), onde a fila
 * tem poucas obras mas a tabela de avaliações é grande.
 *
 * A dedup "primeira por work_id" continua correta mesmo em chunks: cada work_id
 * só aparece dentro do seu próprio chunk (chunks particionam por work_id), então
 * o `order(created_at desc)` por chunk basta.
 */
async function loadLatestEvalsForIds(
  supabase: ReturnType<typeof createAdminClient>,
  ids: string[],
  chunkSize: number,
): Promise<Map<string, LatestEvalRow>> {
  const { data, error } = await chunkedInQuery<LatestEvalRow>(ids, chunkSize, (chunk) =>
    supabase
      .from("ai_evaluations")
      .select("work_id, confidence, model_name, prompt_version, created_at, updated_at")
      .eq("status", "completed")
      .in("work_id", chunk)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => ({ data: (data ?? []) as LatestEvalRow[], error })),
  )
  if (error) throw new Error(String((error as { message?: string }).message ?? error))

  const latest = new Map<string, LatestEvalRow>()
  for (const row of data) {
    if (!latest.has(row.work_id)) latest.set(row.work_id, row)
  }
  return latest
}

async function getEligibleWorks(
  filters: EvaluationFilter[],
  pubStatusIds: number[],
  personalStatusIds: number[],
  synopsisQualities: string[],
  toleranceOverride: number | null
) {
  const supabase = createAdminClient()

  // Carrega tolerância de versão (compartilhada pelo filtro outdated-model
  // e pela UI dos filtros). Default 0 (qualquer divergência conta).
  const { data: configRow } = await supabase
    .from("formula_config")
    .select("prompt_version_tolerance, low_confidence_threshold")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const promptVersionTolerance = toleranceOverride != null
    ? Math.max(0, toleranceOverride)
    : Math.max(0, Number(configRow?.prompt_version_tolerance ?? 0))
  const lowConfidenceThreshold = Math.min(
    1,
    Math.max(0, Number(configRow?.low_confidence_threshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD))
  )

  // Carrega o mapa de últimas avaliações uma vez se algum filtro precisar dele.
  // Bem mais rápido que 3 chamadas separadas à view.
  const needsLatestEvals =
    filters.includes("low-confidence") || filters.includes("outdated-model")
  const latestEvalsPromise = needsLatestEvals ? loadLatestEvalsMap(supabase) : null

  // Os filtros baseados na última avaliação (low-confidence / outdated-model)
  // olham só o registro de avaliação, ignorando o ai_eval_status. Sem isto, uma
  // obra "Pulada" (ai_eval_status="skipped") que tenha uma avaliação antiga de
  // baixa confiança ou modelo desatualizado continuaria reaparecendo na fila.
  // Carregamos o conjunto de obras puladas uma vez pra excluí-las desses filtros.
  const skippedIdsPromise = needsLatestEvals
    ? (async () => {
        const { data, error } = await supabase
          .from("works")
          .select("id")
          .eq("ai_eval_status", "skipped")
        if (error) throw new Error(error.message)
        return new Set((data ?? []).map((w) => w.id))
      })()
    : null

  // Pra cada filtro, descobrimos os work_ids elegíveis e depois unimos.
  // Mais eficiente que um único query com OR complexo (queries simples,
  // índices óbvios). Em paralelo.
  const queries: Promise<{ ids: Set<string>; filter: EvaluationFilter }>[] = []

  if (filters.includes("pending")) {
    queries.push(
      (async () => {
        const { data, error } = await supabase
          .from("works")
          .select("id")
          .eq("ai_eval_status", "pending")
          .eq("is_archived", false)
        if (error) throw new Error(error.message)
        return { filter: "pending" as const, ids: new Set((data ?? []).map((w) => w.id)) }
      })()
    )
  }

  if (filters.includes("review-pending")) {
    queries.push(
      (async () => {
        const { data, error } = await supabase
          .from("works")
          .select("id")
          .eq("ai_eval_status", "review_pending")
          .eq("is_archived", false)
        if (error) throw new Error(error.message)
        return { filter: "review-pending" as const, ids: new Set((data ?? []).map((w) => w.id)) }
      })()
    )
  }

  if (filters.includes("low-confidence")) {
    queries.push(
      (async () => {
        const [latest, skipped] = await Promise.all([latestEvalsPromise!, skippedIdsPromise!])
        const ids = new Set<string>()
        for (const [workId, row] of latest) {
          if (skipped.has(workId)) continue
          if (row.confidence != null && Number(row.confidence) < lowConfidenceThreshold) {
            ids.add(workId)
          }
        }
        return { filter: "low-confidence" as const, ids }
      })()
    )
  }

  if (filters.includes("outdated-reviews")) {
    queries.push(
      (async () => {
        // Avaliação concluída cujo pool de reviews mudou depois (flag mantida por
        // saveWorkReviews — migration 120). Query direta, sem o mapa de avaliações.
        const { data, error } = await supabase
          .from("works")
          .select("id")
          .eq("ai_eval_reviews_stale", true)
          .eq("is_archived", false)
        if (error) throw new Error(error.message)
        return { filter: "outdated-reviews" as const, ids: new Set((data ?? []).map((w) => w.id)) }
      })()
    )
  }

  if (filters.includes("outdated-model")) {
    queries.push(
      (async () => {
        const [latest, skipped] = await Promise.all([latestEvalsPromise!, skippedIdsPromise!])
        const ids = new Set<string>()
        for (const [workId, row] of latest) {
          if (skipped.has(workId)) continue
          const versionNum = parsePromptVersion(row.prompt_version)
          const modelMismatch = row.model_name !== MODEL
          const promptMismatch =
            versionNum == null ||
            CURRENT_PROMPT_VERSION_NUM - versionNum > promptVersionTolerance
          if (modelMismatch || promptMismatch) ids.add(workId)
        }
        return { filter: "outdated-model" as const, ids }
      })()
    )
  }

  const filterResults = await Promise.all(queries)
  const matchedByWork = new Map<string, EvaluationFilter[]>()
  for (const { filter, ids } of filterResults) {
    for (const id of ids) {
      const existing = matchedByWork.get(id) ?? []
      existing.push(filter)
      matchedByWork.set(id, existing)
    }
  }

  if (matchedByWork.size === 0) {
    return {
      works: [] as EligibleWork[],
      totalCount: 0,
      activeFilters: filters,
      promptVersionTolerance,
      lowConfidenceThreshold,
    }
  }

  const eligibleIds = [...matchedByWork.keys()]

  // Chunk size de 100 IDs por request. PostgREST `?id=in.(...)` codifica cada
  // UUID em ~37 chars; 100 IDs ≈ 3.7KB de URL, confortavelmente abaixo de
  // qualquer limite de proxy/cdn (~16KB). Sem chunk, 500+ IDs ultrapassam o
  // limite e a request fica pendurada.
  const CHUNK_SIZE = 100

  type WorkRow = {
    id: string
    title: string
    publication_status_id: number | null
    personal_status_id: number | null
    synopsis_quality: string | null
    total_chapters: number | null
  }
  const worksResult = await chunkedInQuery<WorkRow>(eligibleIds, CHUNK_SIZE, (chunk) => {
    let q = supabase
      .from("works")
      .select("id, title, publication_status_id, personal_status_id, synopsis_quality, total_chapters")
      .in("id", chunk)
      .eq("is_archived", false)
    if (pubStatusIds.length > 0) q = q.in("publication_status_id", pubStatusIds)
    if (personalStatusIds.length > 0) q = q.in("personal_status_id", personalStatusIds)
    if (synopsisQualities.length > 0) q = q.in("synopsis_quality", synopsisQualities)
    return q.then(({ data, error }) => ({ data: (data ?? []) as WorkRow[], error }))
  })
  if (worksResult.error) throw new Error(String((worksResult.error as { message?: string }).message ?? worksResult.error))

  // Ordena por título em JS e limita aos 500 que serão exibidos.
  const displayedWorks = worksResult.data
    .slice()
    .sort((a, b) => String(a.title ?? "").localeCompare(String(b.title ?? "")))
    .slice(0, 500)
  const displayedIds = displayedWorks.map((w) => w.id)

  // Hidrata covers + calculated_scores + última aval em chunks, tudo em paralelo
  // sobre os IDs exibidos. No caminho padrão (pending/review-pending) a aval é
  // carregada direcionada (≤500 IDs) em vez de varrer a tabela inteira; quando os
  // filtros low-confidence/outdated já dispararam o full-load, reusamos o promise.
  type CoverRow = { work_id: string; url: string | null; is_primary: boolean | null; position: number | null }
  type ScoreRow = { work_id: string; expected_score: number | null }
  const [coversResult, scoresResult, latestEvals] = await Promise.all([
    chunkedInQuery<CoverRow>(displayedIds, CHUNK_SIZE, (chunk) =>
      supabase
        .from("work_covers")
        .select("work_id, url, is_primary, position")
        .in("work_id", chunk)
        .then(({ data, error }) => ({ data: (data ?? []) as CoverRow[], error })),
    ),
    chunkedInQuery<ScoreRow>(displayedIds, CHUNK_SIZE, (chunk) =>
      supabase
        .from("calculated_scores")
        .select("work_id, expected_score")
        .in("work_id", chunk)
        .then(({ data, error }) => ({ data: (data ?? []) as ScoreRow[], error })),
    ),
    latestEvalsPromise ?? loadLatestEvalsForIds(supabase, displayedIds, CHUNK_SIZE),
  ])

  const coversByWork = new Map<string, CoverRow[]>()
  for (const c of coversResult.data) {
    const list = coversByWork.get(c.work_id) ?? []
    list.push(c)
    coversByWork.set(c.work_id, list)
  }
  const scoreByWork = new Map<string, ScoreRow>()
  for (const s of scoresResult.data) {
    scoreByWork.set(s.work_id, s)
  }

  const eligibleIdSet = new Set(eligibleIds)
  const evalByWork = new Map(
    [...latestEvals.entries()]
      .filter(([workId]) => eligibleIdSet.has(workId))
      .map(([workId, e]) => [
        workId,
        {
          confidence: e.confidence == null ? null : Number(e.confidence),
          modelName: e.model_name ?? null,
          promptVersion: e.prompt_version ?? null,
          // updated_at reflete a última mudança da avaliação (substituição, edição
          // de scores, etc.). Fallback pra created_at se updated_at faltar.
          evaluatedAt: e.updated_at ?? e.created_at ?? null,
        },
      ])
  )

  const works: EligibleWork[] = displayedWorks.map((w) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = w as any
    return {
      id: row.id,
      title: row.title,
      publication_status: "",
      publication_status_id: row.publication_status_id ?? null,
      personal_status: "",
      personal_status_id: row.personal_status_id ?? null,
      synopsis_quality: row.synopsis_quality ?? null,
      total_chapters: row.total_chapters,
      cover_url: pickPrimaryCover(coversByWork.get(row.id) ?? []),
      expected_score: scoreByWork.get(row.id)?.expected_score ?? null,
      matchedFilters: matchedByWork.get(row.id) ?? [],
      evaluation: evalByWork.get(row.id) ?? null,
    } as EligibleWork
  })

  return {
    works,
    totalCount: works.length,
    activeFilters: filters,
    promptVersionTolerance,
    lowConfidenceThreshold,
  }
}

function EvalTabLink({
  href,
  active,
  dot,
  children,
}: {
  href: string
  active: boolean
  /** Pontinho: a aba tem não-lidas que somam no badge da sidebar (some quando lida). */
  dot?: boolean
  children: ReactNode
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative -mb-px rounded-t-md border-b-2 px-3 py-2 text-sm transition-colors",
        active
          ? "border-primary bg-primary/10 font-semibold text-primary"
          : "border-transparent font-medium text-muted-foreground hover:border-border hover:text-foreground",
      )}
    >
      {dot && (
        <span
          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary/70"
          aria-label="pendências não lidas"
        />
      )}
      {children}
    </Link>
  )
}

/**
 * Aba "IA atributos" — fila de avaliação/revisão das 9 notas por critério.
 * Componente apresentacional: a fila já vem buscada pelo pai (a contagem
 * alimenta o título da aba, então precisa rodar independente da aba ativa).
 */
function IaAttributesTab({
  works,
  readIds,
  activeFilters,
  promptVersionTolerance,
  lowConfidenceThreshold,
  pubStatusNames,
  personalStatusNames,
  synopsisQualities,
  predictionQualities,
}: {
  works: EligibleWork[]
  readIds: string[]
  activeFilters: EvaluationFilter[]
  promptVersionTolerance: number
  lowConfidenceThreshold: number
  pubStatusNames: string[]
  personalStatusNames: string[]
  synopsisQualities: string[]
  predictionQualities: string[]
}) {
  return (
    <div className="space-y-4">
      <AiEvaluationFilters
        activeFilters={activeFilters}
        currentModel={MODEL}
        currentPromptVersion={PROMPT_VERSION}
        currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        promptVersionTolerance={promptVersionTolerance}
        lowConfidenceThreshold={lowConfidenceThreshold}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={personalStatusNames}
        activeSynopsisQualities={synopsisQualities}
        activePredictionQualities={predictionQualities}
      />
      <AiEvaluationPanel pendingWorks={works} readIds={readIds} />
    </div>
  )
}

/**
 * Aba "Untracked" — obras com status de leitura = Untracked. Permite atribuir um
 * status de leitura a VÁRIAS de uma vez (multi-seleção + aplicar). Reusa o filtro
 * de Publicação + Interesse (esconde "Leitura": todas são Untracked).
 */
function UntrackedTab({
  works,
  readIds,
  pubStatusNames,
  synopsisQualities,
  predictionQualities,
}: {
  works: (UntrackedWork & {
    tagCount: number
    reviewCount: number
  })[]
  readIds: string[]
  pubStatusNames: string[]
  synopsisQualities: string[]
  predictionQualities: string[]
}) {
  return (
    <div className="space-y-4">
      <AiEvaluationFilters
        activeFilters={[]}
        currentModel={MODEL}
        currentPromptVersion={PROMPT_VERSION}
        currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        promptVersionTolerance={0}
        lowConfidenceThreshold={DEFAULT_LOW_CONFIDENCE_THRESHOLD}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={[]}
        activeSynopsisQualities={synopsisQualities}
        activePredictionQualities={predictionQualities}
        showEvalState={false}
        showPersonalStatus={false}
      />
      <UntrackedStatusPanel works={works} readIds={readIds} />
    </div>
  )
}

const IA_RK_STATES = ["stale", "unranked"] as const
type IaRkState = (typeof IA_RK_STATES)[number]

function parseIaRkStates(raw: string | string[] | undefined): IaRkState[] {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value == null) return ["stale"] // default: só "Desatualizado"
  if (value === "none") return []
  const parts = value.split(",").map((p) => p.trim())
  return IA_RK_STATES.filter((s) => parts.includes(s))
}

const SYNOPSIS_STATES = ["stale", "unpredicted", "predicted"] as const
type SynopsisState = (typeof SYNOPSIS_STATES)[number]

function parseSynopsisStates(raw: string | string[] | undefined): SynopsisState[] {
  const value = Array.isArray(raw) ? raw[0] : raw
  // Default da fila de ação: só "não previsto" (sem "stale" nem "predicted").
  if (value == null) return ["unpredicted"]
  if (value === "none") return []
  const parts = value.split(",").map((p) => p.trim())
  return SYNOPSIS_STATES.filter((s) => parts.includes(s))
}

/**
 * Aba "Veredito IA" — fila de re-rank: obras com Veredito IA desatualizado E/OU não avaliado
 * (sem Veredito IA ainda). Recebe a fila já buscada pelo pai (mesma query do badge, pra
 * o contador da aba bater com a lista). Compartilha os filtros de Status com a aba
 * de atributos; troca "Estado da avaliação" por "Estado do Veredito IA". Sort é no painel.
 */
function IaRkTab({
  works,
  readIds,
  pubStatusNames,
  personalStatusNames,
  synopsisQualities,
  predictionQualities,
  states,
  isPaid,
}: {
  works: AlignmentQueueWork[]
  readIds: string[]
  pubStatusNames: string[]
  personalStatusNames: string[]
  synopsisQualities: string[]
  predictionQualities: string[]
  states: IaRkState[]
  isPaid: boolean
}) {
  return (
    <div className="space-y-4">
      <AiEvaluationFilters
        activeFilters={[]}
        currentModel={MODEL}
        currentPromptVersion={PROMPT_VERSION}
        currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        promptVersionTolerance={0}
        lowConfidenceThreshold={DEFAULT_LOW_CONFIDENCE_THRESHOLD}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={personalStatusNames}
        activeSynopsisQualities={synopsisQualities}
        activePredictionQualities={predictionQualities}
        showEvalState={false}
        showIaRkState
        activeIaRkStates={states}
      />
      <StaleRerankPanel works={works} readIds={readIds} isPaid={isPaid} />
    </div>
  )
}

/**
 * Aba "Interesse na Obra" — fila de obras com sinopse canônica que precisam de
 * estimativa IA (desatualizada ou não prevista). Mesmo formato de cards da aba
 * Veredito IA. Compartilha os filtros de Status; só os de estado da avaliação não se
 * aplicam. Além de estimar, permite APLICAR a previsão em fila (preenche o
 * Interesse manual das obras sem rótulo).
 */
function SynopsisTab({
  works,
  readIds,
  accuracy,
  comparison,
  pubStatusNames,
  personalStatusNames,
  synopsisQualities,
  states,
  predictionVersions,
  predictionQualities,
  predictionDeltas,
  predictionVersionOptions,
  minTags,
  maxTags,
  minReviews,
  maxReviews,
  defaultPersonalStatuses,
  isPaid,
}: {
  works: SynopsisQueueWork[]
  readIds: string[]
  accuracy: SynopsisPredictionAccuracy
  comparison: SynopsisVersionComparison | null
  pubStatusNames: string[]
  personalStatusNames: string[]
  synopsisQualities: string[]
  states: SynopsisState[]
  predictionVersions: string[]
  predictionQualities: string[]
  predictionDeltas: string[]
  predictionVersionOptions: string[]
  minTags: number
  maxTags: number
  minReviews: number
  maxReviews: number
  defaultPersonalStatuses: string[]
  isPaid: boolean
}) {
  return (
    <div className="space-y-4">
      {/* Diagnóstico da previsão (confiança/versões/Shadow A/B) fora do topo: pílula
          discreta que abre um popover. O Shadow é server-only → passado como prop. */}
      <div className="flex justify-start">
        <PredictionDiagnosticsPopover
          accuracy={accuracy}
          comparison={comparison}
          shadow={isInterestShadowEnabled() ? <ShadowComparePanel comparison={comparison} /> : null}
        />
      </div>
      <AiEvaluationFilters
        activeFilters={[]}
        currentModel={MODEL}
        currentPromptVersion={PROMPT_VERSION}
        currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
        promptVersionTolerance={0}
        lowConfidenceThreshold={DEFAULT_LOW_CONFIDENCE_THRESHOLD}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={personalStatusNames}
        activeSynopsisQualities={synopsisQualities}
        showEvalState={false}
        showSynopsisState
        showDataFilters
        activeMinTags={minTags}
        activeMaxTags={maxTags}
        activeMinReviews={minReviews}
        activeMaxReviews={maxReviews}
        defaultPersonalStatuses={defaultPersonalStatuses}
        activeSynopsisStates={states}
        activePredictionVersions={predictionVersions}
        activePredictionQualities={predictionQualities}
        activePredictionDeltas={predictionDeltas}
        predictionVersionOptions={predictionVersionOptions}
      />
      <SynopsisPredictPanel works={works} readIds={readIds} isPaid={isPaid} />
    </div>
  )
}

function toParam(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined
  return Array.isArray(v) ? v.join(",") : v
}

interface TabHrefs {
  attr: string
  rk: string
  syn: string
  tagsReviews: string
  untracked: string
}

/** Barra de abas. `counts=null` (fallback do Suspense) mostra "(…)" enquanto os
 *  contadores carregam — não bloqueia o render do conteúdo da aba ativa. */
function EvalTabBar({
  activeTab,
  hrefs,
  counts,
}: {
  activeTab: string
  hrefs: TabHrefs
  counts: TabCounts | null
}) {
  const n = (v: number | undefined) => (counts ? ` (${v ?? 0})` : " (…)")
  return (
    <div className="flex items-center gap-1 border-b border-border/60">
      <EvalTabLink href={hrefs.attr} active={activeTab === "atributos"} dot={(counts?.attr ?? 0) > 0}>IA atributos{n(counts?.attr)}</EvalTabLink>
      <EvalTabLink href={hrefs.rk} active={activeTab === "ia-rk"} dot={(counts?.iaRk ?? 0) > 0}>Veredito IA{n(counts?.iaRk)}</EvalTabLink>
      <EvalTabLink href={hrefs.syn} active={activeTab === "sinopse"} dot={(counts?.syn ?? 0) > 0}>Interesse na Obra{n(counts?.syn)}</EvalTabLink>
      <EvalTabLink href={hrefs.tagsReviews} active={activeTab === "tags-reviews"}>Tags &amp; Reviews{n(counts?.tagsReviews)}</EvalTabLink>
      <EvalTabLink href={hrefs.untracked} active={activeTab === "untracked"}>Untracked{n(counts?.untracked)}</EvalTabLink>
    </div>
  )
}

interface CountArgs {
  activeFilters: EvaluationFilter[]
  pubStatusIds: number[]
  personalStatusIds: number[]
  synopsisQualities: string[]
  toleranceOverride: number | null
  iaRkStates: IaRkState[]
  synopsisStates: SynopsisState[]
  predictionVersions: string[]
  predictionQualities: string[]
  predictionDeltas: string[]
  minReviews: number
  maxReviews: number
  minTags: number
  maxTags: number
}

interface TabCounts {
  attr: number
  iaRk: number
  syn: number
  tagsReviews: number
  untracked: number
}

/**
 * Contagens das 5 abas, cacheadas por combinação de filtros (`unstable_cache`).
 * As 5 queries são full scans pesados que antes rodavam em TODA navegação (trocar
 * de aba, aplicar filtro, qualquer ação). Cacheadas, navegações com os mesmos
 * filtros (ex.: ir-e-voltar entre abas) servem do cache em vez de bater no banco
 * (Ohio, ~300ms/round-trip). TTL curto (60s) + invalidação por tag
 * `ai-eval-tab-counts` nas mutações da fila — badge de fila tolera leve staleness,
 * e a aba ATIVA é sempre sobrescrita pelo valor fresco em `TabCountsBar`.
 *
 * A chave do cache inclui os argumentos serializados (todos os filtros), então
 * cada combinação de filtros tem sua própria entrada.
 */
const getAiEvalTabCounts = unstable_cache(
  async (args: CountArgs): Promise<TabCounts> => {
    const [attr, iaRk, syn, revC, tagsC, untracked, ackSets] = await Promise.all([
      getEligibleWorks(args.activeFilters, args.pubStatusIds, args.personalStatusIds, [], args.toleranceOverride),
      getAlignmentQueueWorks({ states: args.iaRkStates, pubStatusIds: args.pubStatusIds, personalStatusIds: args.personalStatusIds }),
      getSynopsisQueueWorks({ states: args.synopsisStates, pubStatusIds: args.pubStatusIds, personalStatusIds: args.personalStatusIds, synopsisQualities: args.synopsisQualities, predictionVersions: args.predictionVersions, predictionQualities: args.predictionQualities, predictionDeltas: args.predictionDeltas, missingManual: args.synopsisQualities.includes("none"), countOnly: true }),
      getWorksWithoutReviews({ pubStatusIds: args.pubStatusIds, personalStatusIds: args.personalStatusIds, minReviews: args.minReviews, maxReviews: args.maxReviews }, { countOnly: true }),
      getWorksWithoutTags({ pubStatusIds: args.pubStatusIds, personalStatusIds: args.personalStatusIds, minTags: args.minTags, maxTags: args.maxTags }, { countOnly: true }),
      getUntrackedWorks({ pubStatusIds: args.pubStatusIds }),
      getReadAckSets(),
    ])
    // Contadores = NÃO-LIDAS: subtrai as obras marcadas como lidas em cada fila.
    const ackAttr = ackSets.get("attr")!
    const ackVer = ackSets.get("veredito")!
    const ackInt = ackSets.get("interesse")!
    const ackTR = ackSets.get("tags_reviews")!
    const ackUn = ackSets.get("untracked")!
    // Interesse (manual + Previsão da IA) filtrado uniformemente pós-fetch nas 4
    // filas cujas queries não filtram por isso (a aba Interesse já filtra internamente).
    // No-op barato quando nenhum filtro de interesse está ativo.
    const attrIds = attr.works.map((w) => w.id)
    const verIds = iaRk.map((w) => w.id)
    const unIds = untracked.map((w) => w.id)
    // "Tags & Reviews" = união dos universos (obra com faixa de reviews OU faixa de
    // tags). Conta ids distintos (não soma, pra não duplicar quem falta ambos).
    const trIds = [...new Set([...(revC.ids ?? []), ...(tagsC.ids ?? [])])]
    const [keepAttr, keepVer, keepUn, keepTR] = await Promise.all([
      filterWorkIdsByInterest(attrIds, args.synopsisQualities, args.predictionQualities),
      filterWorkIdsByInterest(verIds, args.synopsisQualities, args.predictionQualities),
      filterWorkIdsByInterest(unIds, args.synopsisQualities, args.predictionQualities),
      filterWorkIdsByInterest(trIds, args.synopsisQualities, args.predictionQualities),
    ])
    return {
      attr: attrIds.filter((id) => keepAttr.has(id) && !ackAttr.has(id)).length,
      iaRk: verIds.filter((id) => keepVer.has(id) && !ackVer.has(id)).length,
      syn: syn.filter((w) => !ackInt.has(w.id)).length,
      tagsReviews: trIds.filter((id) => keepTR.has(id) && !ackTR.has(id)).length,
      untracked: unIds.filter((id) => keepUn.has(id) && !ackUn.has(id)).length,
    }
  },
  ["ai-eval-tab-counts-v4"],
  { revalidate: 60, tags: ["ai-eval-tab-counts"] },
)

const ACTIVE_TAB_COUNT_KEY: Record<string, keyof TabCounts> = {
  atributos: "attr",
  "ia-rk": "iaRk",
  sinopse: "syn",
  "tags-reviews": "tagsReviews",
  untracked: "untracked",
}

/**
 * Contadores das 5 abas — async, renderizado dentro de um <Suspense> para NÃO
 * bloquear o conteúdo da aba ativa. As contagens vêm do cache (`getAiEvalTabCounts`),
 * então fazem streaming: a aba ativa aparece rápido e os números chegam logo depois.
 *
 * `activeCount` é a contagem fresca da aba ATIVA (a fila já foi buscada no corpo da
 * página) — sobrescreve o valor possivelmente cacheado, garantindo que o badge da
 * aba aberta nunca fique stale e bata exatamente com a lista exibida.
 */
async function TabCountsBar({ activeTab, hrefs, args, activeCount }: { activeTab: string; hrefs: TabHrefs; args: CountArgs; activeCount: number }) {
  const counts = await getAiEvalTabCounts(args)
  const merged: TabCounts = { ...counts, [ACTIVE_TAB_COUNT_KEY[activeTab] ?? "attr"]: activeCount }
  return <EvalTabBar activeTab={activeTab} hrefs={hrefs} counts={merged} />
}

/**
 * Estado do toggle "Marcar tudo como lido" (defaults das 5 filas). Cacheado
 * (60s + tag `ai-eval-tab-counts`, invalidada nas mutações de leitura) pra não
 * re-varrer as filas a cada navegação. Renderiza no slot de ações do Header.
 */
const getEvalReadSummaryCached = unstable_cache(
  async () => getEvalReadSummary(),
  ["ai-eval-read-summary-v1"],
  { revalidate: 60, tags: ["ai-eval-tab-counts"] },
)

async function MarkReadControl() {
  const summary = await getEvalReadSummaryCached()
  // Nada pendente nem lido ⇒ nada a fazer: esconde o botão.
  if (!summary.hasAnyRead && summary.totalUnread === 0) return null
  return <MarkReadButton allRead={summary.allRead} />
}

// Config dos filtros da fila (tolerância de versão + limiar de confiança). Veio das
// Preferências pra cá, onde os knobs de fato agem. Busca a config e abre num diálogo.
async function AiEvalSettingsControl() {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("formula_config")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
  const config = data?.[0] as FormulaConfig | undefined
  if (!config) return null
  return (
    <AiEvalSettingsDialog
      config={config}
      currentPromptVersion={PROMPT_VERSION}
      currentPromptVersionNum={CURRENT_PROMPT_VERSION_NUM}
    />
  )
}

export default async function AiEvaluationPage({
  searchParams,
}: {
  searchParams: Promise<{
    filter?: string | string[]
    pub?: string | string[]
    personal?: string | string[]
    synopsis_q?: string | string[]
    tolerance?: string | string[]
    tab?: string | string[]
    rk?: string | string[]
    sq?: string | string[]
    pv?: string | string[]
    pq?: string | string[]
    pd?: string | string[]
    maxrev?: string | string[]
    maxtags?: string | string[]
    minrev?: string | string[]
    mintags?: string | string[]
  }>
}) {
  const params = await searchParams
  const tabRaw = Array.isArray(params.tab) ? params.tab[0] : params.tab
  const activeTab: "atributos" | "ia-rk" | "sinopse" | "tags-reviews" | "untracked" =
    tabRaw === "ia-rk" ? "ia-rk"
    : tabRaw === "sinopse" ? "sinopse"
    // "sem-reviews"/"sem-tags" (URLs antigas) redirecionam pra aba unificada.
    : tabRaw === "tags-reviews" || tabRaw === "sem-reviews" || tabRaw === "sem-tags" ? "tags-reviews"
    : tabRaw === "untracked" ? "untracked"
    : "atributos"

  const parseMax = (v: string | string[] | undefined): number => {
    const raw = Array.isArray(v) ? v[0] : v
    const n = raw != null && /^\d+$/.test(raw) ? parseInt(raw, 10) : 0
    return Math.max(0, n)
  }
  const maxReviews = parseMax(params.maxrev)
  const maxTags = parseMax(params.maxtags)
  const minReviews = parseMax(params.minrev)
  const minTags = parseMax(params.mintags)

  // Filtros de Status + interesse compartilhados pelas 2 abas.
  const { names: pubStatusNames, ids: pubStatusIds } = parseStatusList(params.pub, PUB_STATUS_NAME_TO_ID)
  const { names: personalStatusNames, ids: personalStatusIds } = parseStatusList(
    params.personal,
    PERSONAL_STATUS_NAME_TO_ID,
  )
  const synopsisQualities = parseSynopsisQualities(params.synopsis_q)
  const iaRkStates = parseIaRkStates(params.rk)
  const synopsisStates = parseSynopsisStates(params.sq)
  const predictionVersions = parsePredictionVersions(params.pv)
  const predictionQualities = parsePredictionQualities(params.pq)
  const predictionDeltas = parsePredictionDeltas(params.pd)

  // Filtros específicos da aba de atributos.
  const activeFilters = parseFilters(params.filter)
  const toleranceRaw = Array.isArray(params.tolerance) ? params.tolerance[0] : params.tolerance
  const toleranceOverride = toleranceRaw != null && /^\d+$/.test(toleranceRaw)
    ? parseInt(toleranceRaw, 10)
    : null

  // Adiar contadores (Suspense): busca SÓ os dados da aba ATIVA (render rápido).
  // Os contadores das 5 abas rodam num <Suspense> separado (TabCountsBar), sem
  // bloquear — a lista da aba ativa aparece e os números chegam depois (streaming).
  // Plano só é usado nas abas com features pagas (sinopse / ia-rk). Buscado em
  // paralelo com a query da aba (dentro do Promise.all do branch) pra não somar um
  // round-trip serial ao DB de Ohio no caminho crítico do conteúdo.
  const needsPlan = activeTab === "sinopse" || activeTab === "ia-rk"
  const canAiPromise = needsPlan ? canConsumeAi() : null

  // Obras marcadas como "lidas" por fila (silenciadas). Os cards exibem o selo
  // "Lida" e o activeCount abaixo desconta as lidas (bate com o contador da aba).
  const ackSets = await getReadAckSets()
  // IDs lidos (interseção com as obras exibidas) da fila da aba ativa — passados
  // ao painel pra pintar o selo "Lida". Array (props RSC não serializam Set).
  const readIdsFor = (queue: ReadQueue, works: { id: string }[]): string[] => {
    const set = ackSets.get(queue)!
    return works.filter((w) => set.has(w.id)).map((w) => w.id)
  }

  let activeContent: ReactNode = null
  // Contagem fresca da aba ativa — sobrescreve o valor cacheado no TabCountsBar
  // (badge da aba aberta nunca stale, bate com a lista exibida).
  let activeCount = 0
  if (activeTab === "sinopse") {
    // Default da aba: quando o usuário NÃO escolheu status, mostra todos MENOS
    // Completed/Dropped/Stalled (o filtro exibe esses selecionados). Escolha
    // explícita de status sobrepõe.
    const sinopseUsesDefaultPersonal = personalStatusNames.length === 0
    const sinopsePersonalNames = sinopseUsesDefaultPersonal ? INTEREST_DEFAULT_PERSONAL_NAMES : personalStatusNames
    const sinopsePersonalIds = sinopseUsesDefaultPersonal ? INTEREST_DEFAULT_PERSONAL_IDS : personalStatusIds
    const [synopsisQueue, predictionVersionOptions, synopsisAccuracy, synopsisComparison, canAi] = await Promise.all([
      getSynopsisQueueWorks({ states: synopsisStates, pubStatusIds, personalStatusIds: sinopsePersonalIds, synopsisQualities, predictionVersions, predictionQualities, predictionDeltas, missingManual: synopsisQualities.includes("none") }),
      getSynopsisPredictionVersions(),
      getSynopsisPredictionAccuracy(),
      getSynopsisVersionComparison(),
      canAiPromise ?? canConsumeAi(),
    ])
    const isPaidPlan = canAi
    // Só as contagens 🏷/💬 (badge + filtro de faixa) entram no crítico. Os inputs
    // pesados do popover (sinopse/tags/digest) carregam sob demanda ao abrir.
    const idsToHydrate = synopsisQueue.map((w) => w.id)
    const counts = await getWorkTagReviewCounts(idsToHydrate)
    let works = synopsisQueue.map((w) => {
      const c = counts.get(w.id)
      return {
        ...w,
        tagCount: c?.tagCount ?? 0,
        reviewCount: c?.reviewCount ?? 0,
      }
    })
    // Filtro "Dados (nº)": faixa mín–máx de tags/reviews (aba sinopse), pós-hidratação
    // dos counts. O activeCount reflete o pós-filtro pra o badge da aba bater com a lista.
    if (minTags > 0) works = works.filter((w) => (w.tagCount ?? 0) >= minTags)
    if (maxTags > 0) works = works.filter((w) => (w.tagCount ?? 0) <= maxTags)
    if (minReviews > 0) works = works.filter((w) => (w.reviewCount ?? 0) >= minReviews)
    if (maxReviews > 0) works = works.filter((w) => (w.reviewCount ?? 0) <= maxReviews)
    const readIds = readIdsFor("interesse", works)
    activeCount = works.length - readIds.length
    activeContent = (
      <SynopsisTab
        works={works}
        readIds={readIds}
        accuracy={synopsisAccuracy}
        comparison={synopsisComparison}
        pubStatusNames={pubStatusNames}
        personalStatusNames={sinopsePersonalNames}
        defaultPersonalStatuses={INTEREST_DEFAULT_PERSONAL_NAMES}
        synopsisQualities={synopsisQualities}
        states={synopsisStates}
        predictionVersions={predictionVersions}
        predictionQualities={predictionQualities}
        predictionDeltas={predictionDeltas}
        predictionVersionOptions={predictionVersionOptions}
        minTags={minTags}
        maxTags={maxTags}
        minReviews={minReviews}
        maxReviews={maxReviews}
        isPaid={isPaidPlan}
      />
    )
  } else if (activeTab === "tags-reviews") {
    // Fusão "Tags & Reviews": roda os dois universos (sem reviews / sem tags) em
    // paralelo e UNE por id, marcando de qual eixo cada obra veio.
    const [revRes, tagRes] = await Promise.all([
      getWorksWithoutReviews({ pubStatusIds, personalStatusIds, minReviews, maxReviews }),
      getWorksWithoutTags({ pubStatusIds, personalStatusIds, minTags, maxTags }),
    ])
    const merged = new Map<string, TagsReviewsWork>()
    const base = (w: { id: string; title: string; coverUrl: string | null; publicationStatusId?: number | null; personalStatusId?: number | null; interest: string | null; canonicalPresent: boolean; inGolden: boolean; expectedScore: number | null }) => ({
      id: w.id,
      title: w.title,
      coverUrl: w.coverUrl,
      publicationStatusId: w.publicationStatusId ?? null,
      personalStatusId: w.personalStatusId ?? null,
      interest: w.interest,
      canonicalPresent: w.canonicalPresent,
      inGolden: w.inGolden,
      expectedScore: w.expectedScore,
      tagCount: 0,
      reviewCount: 0,
    })
    for (const w of revRes.works) merged.set(w.id, { ...base(w), reviewGap: true, tagGap: false })
    for (const w of tagRes.works) {
      const ex = merged.get(w.id)
      if (ex) {
        ex.tagGap = true
        ex.readiness = w.readiness
      } else {
        merged.set(w.id, { ...base(w), reviewGap: false, tagGap: true, readiness: w.readiness })
      }
    }
    const mergedAll = [...merged.values()]
    // Filtro de Interesse (manual + Previsão da IA) pós-fetch, uniforme.
    const keep = await filterWorkIdsByInterest(mergedAll.map((w) => w.id), synopsisQualities, predictionQualities)
    const mergedWorks = mergedAll.filter((w) => keep.has(w.id))
    // Reaproveita as contagens JÁ computadas nos scans de getWorksWithout* (mapas de
    // TODAS as obras) — evita re-varrer work_tags/work_reviews aqui (getWorkTagReviewCounts).
    const tagCounts = tagRes.tagCountByWork ?? new Map<string, number>()
    const revCounts = revRes.usefulCountByWork ?? new Map<string, number>()
    for (const w of mergedWorks) {
      w.tagCount = tagCounts.get(w.id) ?? 0
      w.reviewCount = revCounts.get(w.id) ?? 0
    }
    const readIds = readIdsFor("tags_reviews", mergedWorks)
    activeCount = mergedWorks.length - readIds.length
    activeContent = (
      <TagsReviewsTab
        works={mergedWorks}
        readIds={readIds}
        activePubStatuses={pubStatusNames}
        activePersonalStatuses={personalStatusNames}
        activeInterest={synopsisQualities}
        activePredictionQualities={predictionQualities}
        minReviews={minReviews}
        maxReviews={maxReviews}
        minTags={minTags}
        maxTags={maxTags}
      />
    )
  } else if (activeTab === "ia-rk") {
    const [iaRkQueue, canAi] = await Promise.all([
      getAlignmentQueueWorks({ states: iaRkStates, pubStatusIds, personalStatusIds }),
      canAiPromise ?? canConsumeAi(),
    ])
    const isPaidPlan = canAi
    const keep = await filterWorkIdsByInterest(iaRkQueue.map((w) => w.id), synopsisQualities, predictionQualities)
    const members = iaRkQueue.filter((w) => keep.has(w.id))
    const counts = await getWorkTagReviewCounts(members.map((w) => w.id))
    const works = members.map((w) => ({
      ...w,
      tagCount: counts.get(w.id)?.tagCount ?? 0,
      reviewCount: counts.get(w.id)?.reviewCount ?? 0,
    }))
    const readIds = readIdsFor("veredito", works)
    activeCount = works.length - readIds.length
    activeContent = (
      <IaRkTab
        works={works}
        readIds={readIds}
        pubStatusNames={pubStatusNames}
        personalStatusNames={personalStatusNames}
        synopsisQualities={synopsisQualities}
        predictionQualities={predictionQualities}
        states={iaRkStates}
        isPaid={isPaidPlan}
      />
    )
  } else if (activeTab === "untracked") {
    const untrackedAll = await getUntrackedWorks({ pubStatusIds })
    const keep = await filterWorkIdsByInterest(untrackedAll.map((w) => w.id), synopsisQualities, predictionQualities)
    const untrackedWorks = untrackedAll.filter((w) => keep.has(w.id))
    // Inputs do popover carregam sob demanda (getSynopsisInputsAction) — só as
    // contagens 🏷/💬 entram no crítico.
    const idsToHydrate = untrackedWorks.map((w) => w.id)
    const counts = await getWorkTagReviewCounts(idsToHydrate)
    const works = untrackedWorks.map((w) => {
      const c = counts.get(w.id)
      return {
        ...w,
        tagCount: c?.tagCount ?? 0,
        reviewCount: c?.reviewCount ?? 0,
      }
    })
    const readIds = readIdsFor("untracked", works)
    activeCount = works.length - readIds.length
    activeContent = (
      <UntrackedTab
        works={works}
        readIds={readIds}
        pubStatusNames={pubStatusNames}
        synopsisQualities={synopsisQualities}
        predictionQualities={predictionQualities}
      />
    )
  } else {
    // Interesse (manual + Previsão da IA) filtrado uniformemente pós-fetch (não no
    // getEligibleWorks) — cobre ♥/none/unknown + previsão em todas as abas.
    const attrResult = await getEligibleWorks(activeFilters, pubStatusIds, personalStatusIds, [], toleranceOverride)
    const keep = await filterWorkIdsByInterest(attrResult.works.map((w) => w.id), synopsisQualities, predictionQualities)
    const members = attrResult.works.filter((w) => keep.has(w.id))
    const counts = await getWorkTagReviewCounts(members.map((w) => w.id))
    const works = members.map((w) => ({
      ...w,
      tagCount: counts.get(w.id)?.tagCount ?? 0,
      reviewCount: counts.get(w.id)?.reviewCount ?? 0,
    }))
    const readIds = readIdsFor("attr", works)
    activeCount = works.length - readIds.length
    activeContent = (
      <IaAttributesTab
        works={works}
        readIds={readIds}
        activeFilters={activeFilters}
        promptVersionTolerance={attrResult.promptVersionTolerance}
        lowConfidenceThreshold={attrResult.lowConfidenceThreshold}
        pubStatusNames={pubStatusNames}
        personalStatusNames={personalStatusNames}
        synopsisQualities={synopsisQualities}
        predictionQualities={predictionQualities}
      />
    )
  }

  // Preserva os filtros ao trocar de aba.
  const filter = toParam(params.filter)
  const pub = toParam(params.pub)
  const personal = toParam(params.personal)
  const tolerance = toParam(params.tolerance)
  const synq = toParam(params.synopsis_q)
  const rk = toParam(params.rk)
  const sq = toParam(params.sq)
  const pv = toParam(params.pv)
  const pq = toParam(params.pq)
  const pd = toParam(params.pd)

  const attrParams = new URLSearchParams()
  if (filter) attrParams.set("filter", filter)
  if (pub) attrParams.set("pub", pub)
  if (personal) attrParams.set("personal", personal)
  if (synq) attrParams.set("synopsis_q", synq)
  if (tolerance) attrParams.set("tolerance", tolerance)
  const attrHref = attrParams.toString() ? `/ai-evaluation?${attrParams}` : "/ai-evaluation"

  const rkParams = new URLSearchParams({ tab: "ia-rk" })
  if (pub) rkParams.set("pub", pub)
  if (personal) rkParams.set("personal", personal)
  if (synq) rkParams.set("synopsis_q", synq)
  if (rk) rkParams.set("rk", rk)
  const rkHref = `/ai-evaluation?${rkParams}`

  const synParams = new URLSearchParams({ tab: "sinopse" })
  if (pub) synParams.set("pub", pub)
  if (personal) synParams.set("personal", personal)
  if (synq) synParams.set("synopsis_q", synq)
  if (sq) synParams.set("sq", sq)
  if (pv) synParams.set("pv", pv)
  if (pq) synParams.set("pq", pq)
  if (pd) synParams.set("pd", pd)
  const synHref = `/ai-evaluation?${synParams}`

  const tagsReviewsParams = new URLSearchParams({ tab: "tags-reviews" })
  if (pub) tagsReviewsParams.set("pub", pub)
  if (personal) tagsReviewsParams.set("personal", personal)
  if (synq) tagsReviewsParams.set("synopsis_q", synq)
  if (minReviews > 0) tagsReviewsParams.set("minrev", String(minReviews))
  if (maxReviews > 0) tagsReviewsParams.set("maxrev", String(maxReviews))
  if (minTags > 0) tagsReviewsParams.set("mintags", String(minTags))
  if (maxTags > 0) tagsReviewsParams.set("maxtags", String(maxTags))
  const tagsReviewsHref = `/ai-evaluation?${tagsReviewsParams}`

  const untrackedParams = new URLSearchParams({ tab: "untracked" })
  if (pub) untrackedParams.set("pub", pub)
  if (synq) untrackedParams.set("synopsis_q", synq)
  const untrackedHref = `/ai-evaluation?${untrackedParams}`

  const hrefs: TabHrefs = { attr: attrHref, rk: rkHref, syn: synHref, tagsReviews: tagsReviewsHref, untracked: untrackedHref }
  const countArgs: CountArgs = {
    activeFilters,
    pubStatusIds,
    personalStatusIds,
    synopsisQualities,
    toleranceOverride,
    iaRkStates,
    synopsisStates,
    predictionVersions,
    predictionQualities,
    predictionDeltas,
    minReviews,
    maxReviews,
    minTags,
    maxTags,
  }

  return (
    <div className="space-y-4">
      <Header
        kicker="Avaliação"
        title="Avaliação IA"
        description="Fila de avaliação/revisão das notas por IA (atributos) e de re-rank (Veredito IA) desatualizado ou não avaliado."
        icon={<Sparkles />}
        actions={
          <>
            <Suspense fallback={null}>
              <AiEvalSettingsControl />
            </Suspense>
            <Suspense fallback={null}>
              <MarkReadControl />
            </Suspense>
          </>
        }
      />

      <Suspense fallback={<EvalTabBar activeTab={activeTab} hrefs={hrefs} counts={null} />}>
        <TabCountsBar activeTab={activeTab} hrefs={hrefs} args={countArgs} activeCount={activeCount} />
      </Suspense>

      {activeContent}
    </div>
  )
}
